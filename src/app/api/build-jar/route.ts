import { NextResponse } from "next/server";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { writeAssembledProject, slugify } from "@/lib/assemble-project";
import { runGradleBuild, findBuiltJar } from "@/lib/gradle-runner";
import { applyAiFixToProject } from "@/lib/fix-build-ai";

export const maxDuration = 900;
export const dynamic = "force-dynamic";

const SERVER_BUILD = process.env.CODEXMC_ENABLE_SERVER_BUILD === "true";
const GRADLE_TIMEOUT_MS = Number(process.env.CODEXMC_GRADLE_TIMEOUT_MS || 600_000);
/** Number of AI repair rounds after a failed build (each round = one fix + one rebuild). */
const AI_FIX_ROUNDS = Math.min(5, Math.max(0, Number(process.env.CODEXMC_BUILD_AI_FIX_ROUNDS ?? 2)));

export async function POST(req: Request) {
  if (!SERVER_BUILD) {
    return NextResponse.json(
      {
        error:
          "Server-side Gradle build is disabled. On the machine running CodexMC, set CODEXMC_ENABLE_SERVER_BUILD=true, install JDK 17 or 21 (JAVA_HOME or CODEXMC_BUILD_JAVA_HOME), and restart PM2.",
        buildLog: "",
      },
      { status: 503 }
    );
  }

  let body: { markdown?: string; projectName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", buildLog: "" }, { status: 400 });
  }

  const markdown = body.markdown;
  const projectName = body.projectName || "project";
  if (!markdown || typeof markdown !== "string") {
    return NextResponse.json({ error: "markdown required", buildLog: "" }, { status: 400 });
  }

  const root = await mkdtemp(path.join(tmpdir(), "codexmc-build-"));
  let combinedLog = "";

  try {
    await writeAssembledProject(root, markdown, projectName);

    let success = false;
    for (let round = 0; round <= AI_FIX_ROUNDS; round++) {
      const result = await runGradleBuild(root, GRADLE_TIMEOUT_MS);
      combinedLog += `\n\n--- Gradle attempt ${round + 1} ---\n${result.log}`;
      if (result.ok) {
        success = true;
        break;
      }
      if (round === AI_FIX_ROUNDS) break;
      const applied = await applyAiFixToProject(root, result.log);
      if (!applied) {
        combinedLog += "\n\n[AI fix skipped: no API key or model produced no files]\n";
        break;
      }
    }

    if (!success) {
      return NextResponse.json(
        {
          error: "Gradle build failed (see buildLog). The model attempted automatic fixes if OPENROUTER_API_KEY was set.",
          buildLog: combinedLog.slice(-120_000),
        },
        { status: 422 }
      );
    }

    const jarPath = findBuiltJar(root);
    if (!jarPath) {
      return NextResponse.json(
        {
          error: "Build finished but no suitable .jar was found under build/libs/",
          buildLog: combinedLog.slice(-80_000),
        },
        { status: 422 }
      );
    }

    const buf = await readFile(jarPath);
    const slug = slugify(projectName);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/java-archive",
        "Content-Disposition": `attachment; filename="${slug}.jar"`,
        "X-CodexMC-Build-Log-Bytes": String(Buffer.byteLength(combinedLog, "utf8")),
      },
    });
  } catch (e) {
    console.error("[build-jar]", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Server build crashed",
        buildLog: combinedLog,
      },
      { status: 500 }
    );
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
