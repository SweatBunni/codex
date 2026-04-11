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

const CHAT_SYSTEM_PROMPT = `You are CodexMC, a helpful AI assistant specialized in Minecraft modding.
You can help with:
- Explaining modding concepts (Fabric, Forge, NeoForge)
- Debugging mod issues
- Explaining Minecraft APIs and mixins
- Recommending mod structures and design patterns
- Helping with build configs (Gradle)
- Explaining game events, registries, and data packs

Be concise, technical, and friendly. Use code examples when helpful.`;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-r1:free";

  const result = await streamText({
    model: openrouter(model),
    system: CHAT_SYSTEM_PROMPT,
    messages,
    temperature: 0.6,
    maxTokens: 2048,
  });

  return result.toDataStreamResponse();
}
