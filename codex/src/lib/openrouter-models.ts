/** Ordered fallback chain — prioritize free coding models on OpenRouter. */
export const OPENROUTER_MODEL_FALLBACKS = [
  process.env.OPENROUTER_MODEL_PRIMARY || "deepseek/deepseek-coder:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
  "openai/gpt-4o-mini",
] as const;
