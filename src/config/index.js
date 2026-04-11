/**
 * Configuration Management System
 * Centralized config with validation and environment-specific settings
 */

require('dotenv').config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    siteUrl: process.env.SITE_URL || 'http://localhost:3000',
    corsOrigin: process.env.CORS_ORIGIN || '*'
  },

  // Database Configuration
  database: {
    type: process.env.DB_TYPE || 'sqlite',
    url: process.env.DATABASE_URL || './data/codexmc.db',
    redis: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  // AI Configuration
  ai: {
    provider: process.env.AI_PROVIDER || 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.AI_MODEL || 'mistralai/mistral-7b-instruct',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 4000,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7
  },

  // Workspace Configuration
  workspace: {
    dir: process.env.WORKSPACE_DIR || './data/workspaces',
    templateDir: process.env.TEMPLATE_GRADLE_DIR || './templates',
    maxConcurrentBuilds: parseInt(process.env.MAX_CONCURRENT_BUILDS) || 3,
    buildTimeout: parseInt(process.env.BUILD_TIMEOUT_MS) || 300000
  },

  // Java Configuration
  java: {
    jdk8: process.env.JDK_8_PATH,
    jdk17: process.env.JDK_17_PATH,
    jdk21: process.env.JDK_21_PATH,
    jdk25: process.env.JDK_25_PATH
  },

  // Rate Limiting
  limits: {
    maxRequestsPerHour: parseInt(process.env.MAX_REQUESTS_PER_HOUR) || 20,
    maxSessionLength: parseInt(process.env.MAX_SESSION_LENGTH) || 100,
    maxPromptLength: parseInt(process.env.MAX_PROMPT_LENGTH) || 5000
  },

  // Security
  security: {
    sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
    jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
  }
};

// Validate required configuration
function validateConfig() {
  const required = ['ai.apiKey'];
  const missing = required.filter(key => {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    return !value;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

// Initialize configuration
try {
  validateConfig();
} catch (error) {
  console.error('Configuration validation failed:', error.message);
  process.exit(1);
}

module.exports = config;
