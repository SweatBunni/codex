export type ParsedProjectFile = { path: string; language: string; content: string };

/**
 * Parses markdown fenced blocks with optional path after language:
 * ```java src/main/java/Example.java
 */
export function parseProjectFilesFromMarkdown(raw: string): ParsedProjectFile[] {
  const files: ParsedProjectFile[] = [];
  const re = /```([\w.-]+)?\s+([^\n`]+)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const lang = (m[1] || "text").trim();
    const rest = m[2]?.trim() || "";
    const code = (m[3] || "").replace(/\n$/, "");
    const looksLikePath =
      rest.includes("/") ||
      rest.endsWith(".java") ||
      rest.endsWith(".kt") ||
      rest.endsWith(".gradle") ||
      rest.endsWith(".kts") ||
      rest.endsWith(".json") ||
      rest.endsWith(".toml") ||
      rest.endsWith(".yml") ||
      rest.endsWith(".yaml") ||
      rest.endsWith(".xml") ||
      rest.endsWith(".properties") ||
      rest.endsWith(".mcmeta") ||
      rest.endsWith(".md");
    if (!looksLikePath) continue;
    const normalized = rest.replace(/^\/+/, "").replace(/\\/g, "/");
    if (normalized.includes("..")) continue;
    files.push({ path: normalized, language: lang, content: code });
  }
  return files;
}

export function sanitizeZipPath(p: string): string | null {
  const n = p.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!n || n.includes("..")) return null;
  return n;
}
