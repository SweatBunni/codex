/**
 * API Routes
 * Version management, mod generation, and system endpoints
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('../services/versions');
const { generateMod } = require('../services/generator');
const rateLimiter = require('../middleware/rateLimiter');
const { optionalAuth } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const config = require('../config');

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: {
      nodeEnv: config.server.nodeEnv,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      version: require('../../package.json').version
    },
    ai: {
      provider: config.ai.provider,
      model: config.ai.model
    },
    features: {
      conversations: true,
      streaming: true,
      authentication: true,
      rateLimiting: true
    }
  });
});

// Version lists
router.get('/versions/:loader', async (req, res) => {
  try {
    const { loader } = req.params;
    let versions;

    switch (loader.toLowerCase()) {
      case 'forge':
        versions = await getForgeVersions();
        break;
      case 'fabric':
        versions = await getFabricVersions();
        break;
      case 'neoforge':
        versions = await getNeoForgeVersions();
        break;
      default:
        return res.status(400).json({ error: 'Unknown loader. Use: forge, fabric, or neoforge' });
    }

    res.json({
      loader,
      versions: versions.slice(0, 20), // Limit to latest 20 versions
      count: versions.length
    });
  } catch (error) {
    logger.error('Failed to get versions', { loader: req.params.loader, error: error.message });
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

// Generate mod (legacy endpoint, still supported)
router.post('/generate', optionalAuth, rateLimiter.createMiddleware({ maxRequests: 10 }), async (req, res) => {
  try {
    let { prompt, loader, mcVersion, loaderVersion, thinkingLevel, sessionId } = req.body;

    logger.info('Mod generation request', { 
      loader, 
      mcVersion, 
      thinkingLevel, 
      promptLength: prompt?.length || 0,
      userId: req.user?.id 
    });

    // Validate required fields
    if (!prompt || !loader || !mcVersion) {
      return res.status(400).json({ 
        error: 'Missing required fields: prompt, loader, mcVersion' 
      });
    }

    // Set defaults
    if (!sessionId) sessionId = uuidv4();
    if (!loaderVersion) loaderVersion = 'latest';
    if (!thinkingLevel || !['low', 'medium', 'high'].includes(thinkingLevel)) {
      thinkingLevel = 'medium';
    }

    // Validate prompt length
    if (prompt.length > config.limits.maxPromptLength) {
      return res.status(400).json({ 
        error: `Prompt too long. Maximum ${config.limits.maxPromptLength} characters allowed.` 
      });
    }

    // Respond immediately - generation streams via WebSocket
    res.json({ 
      status: 'generating', 
      sessionId,
      estimatedTime: '2-5 minutes'
    });

    // Start generation in background
    generateMod(
      { prompt, loader, mcVersion, loaderVersion, thinkingLevel, sessionId },
      (event) => {
        // Events are handled via WebSocket service
        logger.debug('Generation event', { sessionId, type: event.type });
      }
    )
    .then(result => {
      logger.info('Mod generation completed', { sessionId });
    })
    .catch(err => {
      logger.error('Mod generation failed', { sessionId, error: err.message });
    });

  } catch (error) {
    logger.error('Generation request failed', { error: error.message });
    res.status(500).json({ error: 'Failed to start generation' });
  }
});

// Download endpoints (legacy support)
router.get('/download/source/:workId', async (req, res) => {
  try {
    const { workId } = req.params;
    
    if (!/^[\w-]+$/.test(workId)) {
      return res.status(400).json({ error: 'Invalid workId format' });
    }

    const workspaceDir = config.workspace.dir;
    const zipPath = require('path').join(workspaceDir, workId, 'source.zip');
    const fs = require('fs-extra');

    if (!(await fs.pathExists(zipPath))) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    res.download(zipPath, `codexmc-source-${workId.slice(0, 8)}.zip`);
  } catch (error) {
    logger.error('Source download failed', { workId: req.params.workId, error: error.message });
    res.status(500).json({ error: 'Download failed' });
  }
});

router.get('/download/jar/:workId', async (req, res) => {
  try {
    const { workId } = req.params;
    
    if (!/^[\w-]+$/.test(workId)) {
      return res.status(400).json({ error: 'Invalid workId format' });
    }

    const workspaceDir = config.workspace.dir;
    const libsDir = require('path').join(workspaceDir, workId, 'build', 'libs');
    const fs = require('fs-extra');

    if (!(await fs.pathExists(libsDir))) {
      return res.status(404).json({ error: 'Build directory not found' });
    }

    const files = await fs.readdir(libsDir);
    const jar = files.find(f => 
      f.endsWith('.jar') && 
      !f.includes('sources') && 
      !f.includes('javadoc')
    );

    if (!jar) {
      return res.status(404).json({ error: 'No JAR file found. Build may have failed.' });
    }

    res.download(require('path').join(libsDir, jar), jar);
  } catch (error) {
    logger.error('JAR download failed', { workId: req.params.workId, error: error.message });
    res.status(500).json({ error: 'Download failed' });
  }
});

// System information
router.get('/system/info', optionalAuth, async (req, res) => {
  try {
    const db = require('../utils/database');
    const websocketService = require('../services/websocket');
    
    // Get basic system stats
    const stats = {
      server: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform
      },
      activeConnections: websocketService.getSessionStats(),
      rateLimit: {
        maxRequestsPerHour: config.limits.maxRequestsPerHour,
        maxSessionLength: config.limits.maxSessionLength
      },
      ai: {
        provider: config.ai.provider,
        model: config.ai.model,
        maxTokens: config.ai.maxTokens
      }
    };

    // Add database stats if available
    try {
      const userCount = await db.get('SELECT COUNT(*) as count FROM users');
      const sessionCount = await db.get('SELECT COUNT(*) as count FROM sessions');
      
      stats.database = {
        users: userCount.count,
        sessions: sessionCount.count,
        type: config.database.type
      };
    } catch (dbError) {
      stats.database = { error: 'Database not available' };
    }

    res.json(stats);
  } catch (error) {
    logger.error('System info failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get system information' });
  }
});

// API documentation endpoint
router.get('/docs', (req, res) => {
  const docs = {
    title: 'CodexMC API Documentation',
    version: '2.0.0',
    baseUrl: `${config.server.siteUrl}/api`,
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
        'GET /versions/:loader': 'Get available mod loader versions',
        'POST /generate': 'Generate mod (legacy endpoint)',
        'GET /download/source/:workId': 'Download source code',
        'GET /download/jar/:workId': 'Download compiled JAR'
      },
      system: {
        'GET /health': 'Health check',
        'GET /system/info': 'System information and stats'
      },
      websocket: {
        'WS /ws/:sessionId': 'WebSocket connection for real-time chat and generation'
      }
    },
    features: [
      'Real-time streaming responses',
      'Conversation history and context management',
      'Message editing and regeneration',
      'User authentication and guest sessions',
      'Rate limiting and security',
      'Comprehensive logging and monitoring'
    ]
  };

  res.json(docs);
});

module.exports = router;
