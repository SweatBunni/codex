/**
 * CodexMC Server v2.0
 * Modern modular backend with ChatGPT-like features
 * - Real-time conversations with streaming
 * - User authentication and sessions
 * - Advanced rate limiting and security
 * - Comprehensive logging and monitoring
 */

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// Import configuration and utilities
const config = require('./config');
const db = require('./utils/database');
const { logger } = require('./utils/logger');

// Import services
const websocketService = require('./services/websocket');
const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('./services/versions');
const { generateMod } = require('./services/generator');

// Import routes
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversation');
const apiRoutes = require('./routes/api');

// Import middleware
const rateLimiter = require('./middleware/rateLimiter');

const app = express();
expressWs(app);

// Ensure required directories exist
fs.ensureDirSync(path.join(__dirname, '..', 'data'));
fs.ensureDirSync(config.workspace.dir);

// Middleware setup
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logging middleware
app.use((req, res, next) => {
  logger.request(req, `${req.method} ${req.url}`);
  next();
});

// Apply rate limiting to all API routes
app.use('/api', rateLimiter.middleware());
app.use('/conversation', rateLimiter.middleware());

// Health check endpoint (no rate limiting)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: {
      nodeEnv: config.server.nodeEnv,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      version: require('../package.json').version
    },
    ai: {
      provider: config.ai.provider,
      model: config.ai.model
    },
    features: {
      conversations: true,
      streaming: true,
      authentication: true,
      rateLimiting: true,
      websocket: true
    }
  });
});

// API routes
app.use('/auth', authRoutes);
app.use('/conversation', conversationRoutes);
app.use('/api', apiRoutes);

// WebSocket endpoint
app.ws('/ws/:sessionId', (ws, req) => {
  websocketService.handleConnection(ws, req);
});

// Legacy WebSocket support (backward compatibility)
app.ws('/ws', (ws, req) => {
  const sessionId = require('crypto').randomUUID();
  req.params = { sessionId };
  websocketService.handleConnection(ws, req);
});

// API documentation
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'CodexMC API Documentation v2.0',
    version: '2.0.0',
    baseUrl: `${config.server.siteUrl}/api`,
    features: [
      'Real-time streaming responses',
      'Conversation history and context management',
      'Message editing and regeneration',
      'User authentication and guest sessions',
      'Advanced rate limiting and security',
      'Comprehensive logging and monitoring',
      'WebSocket support for real-time communication'
    ],
    endpoints: {
      authentication: {
        'POST /auth/register': 'Register new user',
        'POST /auth/login': 'Login user',
        'POST /auth/guest': 'Create guest session',
        'POST /auth/verify': 'Verify JWT token',
        'POST /auth/refresh': 'Refresh JWT token'
      },
      conversations: {
        'POST /conversation/sessions': 'Create new conversation session',
        'GET /conversation/sessions/:sessionId/history': 'Get conversation history',
        'POST /conversation/sessions/:sessionId/chat': 'Send message and get response',
        'POST /conversation/sessions/:sessionId/chat/stream': 'Streaming chat (SSE)',
        'POST /conversation/sessions/:sessionId/regenerate': 'Regenerate last response',
        'PUT /conversation/sessions/:sessionId/messages/:messageId': 'Edit message',
        'DELETE /conversation/sessions/:sessionId/messages': 'Clear conversation',
        'GET /conversation/sessions/:sessionId/stats': 'Get session statistics',
        'DELETE /conversation/sessions/:sessionId': 'Delete session'
      },
      modGeneration: {
        'GET /api/versions/:loader': 'Get available mod loader versions',
        'POST /api/generate': 'Generate mod (legacy endpoint)',
        'GET /api/download/source/:workId': 'Download source code',
        'GET /api/download/jar/:workId': 'Download compiled JAR'
      },
      system: {
        'GET /api/health': 'Health check',
        'GET /api/system/info': 'System information and stats',
        'GET /api/docs': 'This API documentation'
      },
      websocket: {
        'WS /ws/:sessionId': 'WebSocket connection for real-time chat and generation',
        'WS /ws': 'Legacy WebSocket endpoint (auto-generates session ID)'
      }
    }
  });
});

// SPA fallback for frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal server error',
    message: config.server.nodeEnv === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.url} not found`
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await db.close();
    logger.info('Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await db.close();
    logger.info('Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

// Start server
async function startServer() {
  try {
    // Initialize database
    await db.initialize();
    logger.info('Database initialized successfully');

    // Start listening
    const PORT = config.server.port;
    const HOST = config.server.host;

    app.listen(PORT, HOST, () => {
      logger.info('CodexMC server started', {
        port: PORT,
        host: HOST,
        environment: config.server.nodeEnv,
        aiProvider: config.ai.provider,
        aiModel: config.ai.model
      });

      console.log(`\n\x1b[32m\x1b[1m=== CodexMC Server v2.0 Started ===\x1b[0m`);
      console.log(`\x1b[36mServer:\x1b[0m http://${HOST}:${PORT}`);
      console.log(`\x1b[36mAPI Docs:\x1b[0m http://${HOST}:${PORT}/api/docs`);
      console.log(`\x1b[36mHealth Check:\x1b[0m http://${HOST}:${PORT}/api/health`);
      console.log(`\x1b[36mAI Provider:\x1b[0m ${config.ai.provider} (${config.ai.model})`);
      console.log(`\x1b[36mEnvironment:\x1b[0m ${config.server.nodeEnv}`);
      console.log(`\x1b[32m=== Features Enabled ===\x1b[0m`);
      console.log(`\x1b[32m\u2713 Real-time conversations\x1b[0m`);
      console.log(`\x1b[32m\u2713 Streaming responses\x1b[0m`);
      console.log(`\x1b[32m\u2713 User authentication\x1b[0m`);
      console.log(`\x1b[32m\u2713 Rate limiting\x1b[0m`);
      console.log(`\x1b[32m\u2713 WebSocket support\x1b[0m`);
      console.log(`\x1b[32m\u2713 Comprehensive logging\x1b[0m`);
      console.log(`\n`);
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;
