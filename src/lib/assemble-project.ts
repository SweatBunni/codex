import { mkdir, writeFile, copyFile, chmod } from "fs/promises";
import path from "path";
import { parseProjectFilesFromMarkdown, sanitizeZipPath } from "@/lib/project-parser";

export function slugify(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "codexmc-project"
  );
}

const wrapperRoot = path.join(process.cwd(), "public", "templates", "gradle-wrapper");

/** Write parsed markdown + Gradle wrapper into an existing directory (no trailing slash required). */
export async function writeAssembledProject(root: string, markdown: string, projectName: string): Promise<void> {
  const slug = slugify(projectName);
  const parsed = parseProjectFilesFromMarkdown(markdown);
  const relPaths = new Set<string>();

  for (const f of parsed) {
    const sp = sanitizeZipPath(f.path);
    if (!sp) continue;
    const dest = path.join(root, sp);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
    relPaths.add(sp);
  }

  const hasSettings = Array.from(relPaths).some(
    (p) => p.endsWith("settings.gradle") || p.endsWith("settings.gradle.kts")
  );
  if (!hasSettings) {
    await writeFile(path.join(root, "settings.gradle"), `rootProject.name = "${slug.replace(/-/g, "_")}"\n`, "utf8");
  }

  await copyGradleWrapperInto(root);
}

async function copyGradleWrapperInto(root: string) {
  await copyFile(path.join(wrapperRoot, "gradlew"), path.join(root, "gradlew"));
  await copyFile(path.join(wrapperRoot, "gradlew.bat"), path.join(root, "gradlew.bat"));
  await mkdir(path.join(root, "gradle", "wrapper"), { recursive: true });
  await copyFile(
    path.join(wrapperRoot, "gradle", "wrapper", "gradle-wrapper.jar"),
    path.join(root, "gradle", "wrapper", "gradle-wrapper.jar")
  );
  await copyFile(
    path.join(wrapperRoot, "gradle", "wrapper", "gradle-wrapper.properties"),
    path.join(root, "gradle", "wrapper", "gradle-wrapper.properties")
  );
  try {
    await chmod(path.join(root, "gradlew"), 0o755);
  } catch {
    /* windows */
  }
}
