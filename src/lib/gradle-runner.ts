import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export function findBuiltJar(projectRoot: string): string | null {
  const libs = path.join(projectRoot, "build", "libs");
  if (!existsSync(libs)) return null;
  const jars = readdirSync(libs).filter((f) => f.endsWith(".jar"));
  const filtered = jars.filter(
    (f) =>
      !f.endsWith("-sources.jar") &&
      !f.endsWith("-javadoc.jar") &&
      !f.includes("-dev.jar") &&
      !f.includes("-dev-shadow")
  );
  if (!filtered.length) return null;
  let best = filtered[0]!;
  let bestSize = 0;
  for (const f of filtered) {
    const s = statSync(path.join(libs, f)).size;
    if (s > bestSize) {
      bestSize = s;
      best = f;
    }
  }
  return path.join(libs, best);
}

export function runGradleBuild(projectRoot: string, timeoutMs: number): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "gradlew.bat" : "./gradlew";
    const args = ["build", "--no-daemon", "--warning-mode", "all"];
    const env = {
      ...process.env,
      JAVA_HOME: process.env.CODEXMC_BUILD_JAVA_HOME || process.env.JAVA_HOME || "",
      GRADLE_OPTS: process.env.GRADLE_OPTS || "-Dfile.encoding=UTF-8",
    };
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      env,
      shell: isWin,
    });
    let log = "";
    const append = (d: Buffer) => {
      log += d.toString();
      if (log.length > 500_000) log = log.slice(-400_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, log: log + `\n\n[Gradle killed after ${timeoutMs}ms timeout]\n` });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, log: log + `\n\n[spawn error] ${err.message}\n` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, log });
    });
  });
}

/** Read key project files to send to the fixer model (size-capped). */
export function collectProjectSnippetForAiFix(projectRoot: string, maxChars = 48_000): string {
  const chunks: string[] = [];
  const tryFile = (rel: string) => {
    const p = path.join(projectRoot, rel);
    if (!existsSync(p)) return;
    chunks.push(`\n### ${rel}\n`, readFileSync(p, "utf8"));
  };
  for (const rel of [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.properties",
    "gradle/libs.versions.toml",
  ]) {
    tryFile(rel);
  }
  const srcMain = path.join(projectRoot, "src", "main");
  function walk(dir: string, depth: number) {
    if (depth > 6 || chunks.join("").length > maxChars) return;
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full, depth + 1);
      else if (/\.(java|kt|kts|json|toml|yml|yaml|xml|properties)$/.test(name.name)) {
        try {
          const raw = readFileSync(full, "utf8");
          const body = raw.length > 32_000 ? raw.slice(0, 32_000) + "\n[…truncated…]\n" : raw;
          const rel = path.relative(projectRoot, full).replace(/\\/g, "/");
          chunks.push(`\n### ${rel}\n`, body);
        } catch {
          /* ignore */
        }
      }
      if (chunks.join("").length > maxChars) return;
    }
  }
  walk(srcMain, 0);
  let out = chunks.join("");
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n\n[…truncated…]\n";
  return out;
}
