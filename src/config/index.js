require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    siteUrl: process.env.SITE_URL || 'http://localhost:3000',
  },
  puter: {
    apiToken: process.env.PUTER_API_TOKEN || '',
    model: process.env.PUTER_MODEL || 'claude-sonnet-4-5',
    fastModel: process.env.PUTER_FAST_MODEL || process.env.PUTER_MODEL || 'claude-sonnet-4-5',
    maxTokens: 8000,
    temperature: 0.2,
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
