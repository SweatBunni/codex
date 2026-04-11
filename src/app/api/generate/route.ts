import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export const maxDuration = 60;

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  headers: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://codexmc.app",
    "X-Title": "CodexMC",
  },
});

const MOD_SYSTEM_PROMPT = `You are CodexMC, an expert Minecraft mod developer specializing in Fabric and Forge mods.

When generating Minecraft mods:
1. Always produce complete, working Java code
2. Include proper mod metadata (fabric.mod.json or mods.toml)
3. Follow modern Minecraft modding conventions
4. Add clear comments explaining what each section does
5. Include build.gradle/gradle.properties if needed
6. Structure your response as:
   - Brief description of what the mod does
   - File structure overview
   - Complete source files (each in a clearly labeled code block)
   - Installation/build instructions

Format code blocks as: \`\`\`java filename.java
... code ...
\`\`\`

Be thorough, complete, and production-ready.`;

export async function POST(req: Request) {
  const { messages, modType, mcVersion, loader } = await req.json();

  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-r1:free";

  const systemMessage = `${MOD_SYSTEM_PROMPT}

Current context:
- Minecraft Version: ${mcVersion || "1.20.1"}
- Mod Loader: ${loader || "Fabric"}
- Mod Type: ${modType || "General"}`;

  const result = await streamText({
    model: openrouter(model),
    system: systemMessage,
    messages,
    temperature: 0.7,
    maxTokens: 4096,
  });

  return result.toDataStreamResponse();
}
