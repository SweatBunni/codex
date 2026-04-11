require('dotenv').config();

function parseList(value, fallback) {
  if (!value) return fallback;
  const items = value.split(',').map(item => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

const codingPrimaryModel = process.env.OPENROUTER_CODING_MODEL || 'qwen/qwen3-coder:free';
const codingFallbackModel = process.env.OPENROUTER_CODING_FALLBACK_MODEL || 'openai/gpt-oss-120b:free';
const defaultModelCandidates = [
  codingPrimaryModel,
  codingFallbackModel,
  'qwen/qwen3.6-plus-preview:free',
  'openai/gpt-oss-20b:free',
];

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    siteUrl: process.env.SITE_URL || 'http://localhost:3000',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    primaryModel: process.env.OPENROUTER_MODEL || 'qwen/qwen3.6-plus-preview:free',
    fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL || 'qwen/qwen3-coder:free',
    model: process.env.OPENROUTER_MODEL || 'qwen/qwen3.6-plus-preview:free',
    codingPrimaryModel,
    codingFallbackModel,
    modelCandidates: parseList(process.env.OPENROUTER_MODEL_CANDIDATES, defaultModelCandidates),
    maxTokens: 32768,
    temperature: 0.4,
    reasoningEffort: process.env.OPENROUTER_REASONING_EFFORT || 'medium',
  },
  workspace: {
    dir: process.env.WORKSPACE_DIR || './data/workspaces',
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_BUILDS) || 3,
    buildTimeout: parseInt(process.env.BUILD_TIMEOUT_MS) || 300000,
  },
  rateLimit: {
    maxPerHour: parseInt(process.env.MAX_REQUESTS_PER_HOUR) || 5,
  },
};
