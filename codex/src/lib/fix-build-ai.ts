import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { parseProjectFilesFromMarkdown, sanitizeZipPath } from "@/lib/project-parser";
import { OPENROUTER_MODEL_FALLBACKS } from "@/lib/openrouter-models";
import { collectProjectSnippetForAiFix } from "@/lib/gradle-runner";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
  headers: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "X-Title": "CodexMC-build-fix",
  },
});

const FIX_SYSTEM = `You are CodexMC build repair. A Gradle build failed for a Minecraft mod/plugin project.

You MUST output ONLY complete replacement files as markdown fenced blocks. First line of each fence: language then path, e.g.
\`\`\`gradle build.gradle
(full file)
\`\`\`
\`\`\`java src/main/java/.../Thing.java
(full file)
\`\`\`

Rules:
- Fix compilation / Gradle errors. Do not leave TODOs or placeholder comments for required behavior.
- Only include files that need to change; if you must touch many files, include all of them in full.
- Use valid APIs for the Minecraft + loader implied by the project (Fabric/Forge/Paper as appropriate).`;

export async function applyAiFixToProject(projectRoot: string, buildLog: string): Promise<boolean> {
  if (!process.env.OPENROUTER_API_KEY) return false;

  const snippet = collectProjectSnippetForAiFix(projectRoot);
  const userPrompt = `## Gradle build log\n\`\`\`\n${buildLog.slice(-24_000)}\n\`\`\`\n\n## Current project files\n${snippet}\n\nOutput the fixed files as described in the system message.`;

  let text = "";
  for (const modelId of OPENROUTER_MODEL_FALLBACKS) {
    try {
      const out = await generateText({
        model: openrouter(modelId) as never,
        system: FIX_SYSTEM,
        prompt: userPrompt,
        temperature: 0.2,
        maxTokens: 16_384,
        maxRetries: 0,
      });
      text = out.text;
      if (text.length > 500) break;
    } catch (e) {
      console.error("[fix-build-ai] model failed", modelId, e);
    }
  }
  if (!text.trim()) return false;

  const parsed = parseProjectFilesFromMarkdown(text);
  if (!parsed.length) return false;

  for (const f of parsed) {
    const sp = sanitizeZipPath(f.path);
    if (!sp) continue;
    const dest = path.join(projectRoot, sp);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
  }
  return true;
}
