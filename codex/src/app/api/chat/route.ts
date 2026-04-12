import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type CoreMessage } from "ai";
import { buildStudioSystemPrompt } from "@/lib/codex-system-prompt";
import { OPENROUTER_MODEL_FALLBACKS } from "@/lib/openrouter-models";

export const maxDuration = 120;

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
  headers: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "X-Title": "CodexMC",
  },
});

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const messages = body.messages as CoreMessage[];
  const mcVersion = (body.mcVersion as string) || "1.20.1";
  const loader = (body.loader as string) || "Fabric";
  const projectKind = (body.projectKind as "mod" | "plugin") || "mod";
  const generationMode = (body.generationMode as "simple" | "advanced") || "simple";

  const system = buildStudioSystemPrompt({ mcVersion, loader, projectKind, generationMode });

  let lastErr: unknown;
  for (const modelId of OPENROUTER_MODEL_FALLBACKS) {
    try {
      const result = await streamText({
        // @ai-sdk/openai + ai minor version skew — runtime is compatible with OpenRouter
        model: openrouter(modelId) as Parameters<typeof streamText>[0]["model"],
        system,
        messages,
        temperature: generationMode === "simple" ? 0.18 : 0.24,
        maxTokens: 8192,
        maxRetries: 0,
      });
      return result.toDataStreamResponse();
    } catch (e) {
      lastErr = e;
      console.error(`[CodexMC] Model failed: ${modelId}`, e);
    }
  }

  return new Response(
    JSON.stringify({
      error: "All OpenRouter models failed",
      detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
    }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
