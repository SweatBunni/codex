/**
 * Conversation Routes
 * ChatGPT-like conversation endpoints
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const conversationService = require('../services/conversation');
const aiService = require('../services/ai');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { session: sessionLogger } = require('../utils/logger');

const router = express.Router();

// Create new conversation session
router.post('/sessions', optionalAuth, rateLimiter.createMiddleware({ maxRequests: 10 }), async (req, res) => {
  try {
    const userId = req.user?.id;
    const sessionId = await conversationService.createSession(userId);
    
    sessionLogger(sessionId).info('Session created', { userId });
    
    res.json({ 
      sessionId,
      userId: userId || null,
      message: 'Session created successfully'
    });
  } catch (error) {
    sessionLogger(req.body.sessionId).error('Failed to create session', { error: error.message });
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get conversation history
router.get('/sessions/:sessionId/history', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;
    
    const history = await conversationService.getConversationHistory(sessionId, parseInt(limit));
    
    res.json({ 
      sessionId,
      messages: history,
      count: history.length
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Failed to get history', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

// Send message and get AI response
router.post('/sessions/:sessionId/chat', optionalAuth, rateLimiter.createMiddleware({ maxRequests: 30 }), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, options = {} } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    sessionLogger(sessionId).info('Chat message received', { 
      messageLength: message.length,
      userId: req.user?.id 
    });

    // Generate response
    const response = await conversationService.generateResponse(sessionId, message, aiService);
    
    sessionLogger(sessionId).info('AI response generated', { 
      responseLength: response.content.length 
    });

    res.json({
      sessionId,
      response: {
        content: response.content,
        metadata: response.metadata
      }
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Chat failed', { error: error.message });
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Streaming chat endpoint
router.post('/sessions/:sessionId/chat/stream', optionalAuth, rateLimiter.createMiddleware({ maxRequests: 30 }), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, options = {} } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    sessionLogger(sessionId).info('Streaming chat started', { 
      messageLength: message.length 
    });

    // Add user message
    await conversationService.addMessage(sessionId, {
      role: 'user',
      content: message
    });

    // Get context and stream response
    const context = await conversationService.getContextWindow(sessionId);
    
    await aiService.generateStreamingResponse(
      context,
      sessionId,
      (chunk) => {
        if (chunk.type === 'chunk') {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (chunk.type === 'complete') {
          // Add assistant response to conversation
          conversationService.addMessage(sessionId, {
            role: 'assistant',
            content: chunk.data.content,
            metadata: chunk.data.metadata
          });
          
          res.write(`data: ${JSON.stringify({ type: 'done', data: chunk.data })}\n\n`);
          res.end();
        } else if (chunk.type === 'error') {
          res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
          res.end();
        }
      }
    );

  } catch (error) {
    sessionLogger(req.params.sessionId).error('Streaming chat failed', { error: error.message });
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// Regenerate last response
router.post('/sessions/:sessionId/regenerate', optionalAuth, rateLimiter.createMiddleware({ maxRequests: 10 }), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageId } = req.body;
    
    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    sessionLogger(sessionId).info('Regenerating response', { messageId });

    const response = await conversationService.regenerateResponse(sessionId, messageId, aiService);
    
    res.json({
      sessionId,
      response: {
        content: response.content,
        metadata: response.metadata
      }
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Regeneration failed', { error: error.message });
    res.status(500).json({ error: 'Failed to regenerate response' });
  }
});

// Edit message
router.put('/sessions/:sessionId/messages/:messageId', optionalAuth, async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const { content } = req.body;
    
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }

    sessionLogger(sessionId).info('Message edited', { messageId });

    const updatedMessage = await conversationService.editMessage(sessionId, messageId, content);
    
    res.json({
      sessionId,
      message: updatedMessage
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Edit failed', { error: error.message });
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Clear conversation
router.delete('/sessions/:sessionId/messages', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    await conversationService.clearSession(sessionId);
    
    sessionLogger(sessionId).info('Conversation cleared');
    
    res.json({
      sessionId,
      message: 'Conversation cleared successfully'
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear conversation' });
  }
});

// Get session statistics
router.get('/sessions/:sessionId/stats', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const stats = await conversationService.getSessionStats(sessionId);
    
    res.json({
      sessionId,
      stats
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Stats failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get session statistics' });
  }
});

// Delete session
router.delete('/sessions/:sessionId', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    await conversationService.deleteSession(sessionId);
    
    sessionLogger(sessionId).info('Session deleted');
    
    res.json({
      message: 'Session deleted successfully'
    });
  } catch (error) {
    sessionLogger(req.params.sessionId).error('Delete failed', { error: error.message });
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Search sessions (for authenticated users)
router.get('/sessions/search', requireAuth, async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const results = await conversationService.searchSessions(req.user.id, query);
    
    res.json({
      query,
      results,
      count: results.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
