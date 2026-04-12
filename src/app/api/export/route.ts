import { NextResponse } from "next/server";
import JSZip from "jszip";
import { readFile } from "fs/promises";
import path from "path";
import { parseProjectFilesFromMarkdown, sanitizeZipPath } from "@/lib/project-parser";

const wrapperRoot = path.join(process.cwd(), "public", "templates", "gradle-wrapper");

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "codexmc-project";
}

async function addGradleWrapper(zip: JSZip) {
  const files = [
    ["gradlew", await readFile(path.join(wrapperRoot, "gradlew"))],
    ["gradlew.bat", await readFile(path.join(wrapperRoot, "gradlew.bat"))],
    ["gradle/wrapper/gradle-wrapper.jar", await readFile(path.join(wrapperRoot, "gradle/wrapper/gradle-wrapper.jar"))],
    [
      "gradle/wrapper/gradle-wrapper.properties",
      await readFile(path.join(wrapperRoot, "gradle/wrapper/gradle-wrapper.properties")),
    ],
  ] as const;
  for (const [p, buf] of files) {
    if (!zip.file(p)) zip.file(p, buf, p === "gradlew" ? { unixPermissions: 0o755 } : undefined);
  }
}

const JAR_BUILD_README = `# How to get your .jar

This ZIP is the **Gradle source project**. CodexMC does not run a compiler on the server—the runnable artifact is produced on **your machine**.

## Steps

1. Unzip the project folder.
2. Open a terminal in that folder.
3. Run:
   - Linux / macOS: \`chmod +x gradlew && ./gradlew build\`
   - Windows: \`gradlew.bat build\`
4. Open \`build/libs/\`. The mod or plugin **JAR** is the file ending in \`.jar\` that is **not** \`-sources.jar\`, \`-javadoc.jar\`, or (for some setups) \`-dev.jar\` / \`-dev-shadow.jar\`.

If \`gradlew\` fails, install **JDK 17 or 21** (match what the generated \`build.gradle\` expects) and try again.

`;

export async function POST(req: Request) {
  try {
    const { markdown, projectName, includeJarGuide } = (await req.json()) as {
      markdown?: string;
      projectName?: string;
      includeJarGuide?: boolean;
    };
    if (!markdown || typeof markdown !== "string") {
      return NextResponse.json({ error: "markdown required" }, { status: 400 });
    }
    const slug = slugify(projectName || "codexmc-project");
    const zip = new JSZip();
    const parsed = parseProjectFilesFromMarkdown(markdown);
    const paths = new Set<string>();

    for (const f of parsed) {
      const sp = sanitizeZipPath(f.path);
      if (!sp) continue;
      zip.file(sp, f.content);
      paths.add(sp);
    }

    const hasSettings = Array.from(paths).some(
      (p) => p.endsWith("settings.gradle") || p.endsWith("settings.gradle.kts")
    );
    if (!hasSettings) {
      zip.file("settings.gradle", `rootProject.name = "${slug.replace(/-/g, "_")}"\n`);
    }

    await addGradleWrapper(zip);

    if (includeJarGuide) {
      zip.file("HOW_TO_BUILD_YOUR_JAR.md", JAR_BUILD_README);
    }

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}.zip"`,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
