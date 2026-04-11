require('dotenv').config();

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
