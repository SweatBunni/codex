/**
 * WebSocket Service
 * Real-time communication for chat and mod generation
 */

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const config = require('../config');
const conversationService = require('./conversation');
const aiService = require('./ai');

class WebSocketService {
  constructor() {
    this.connections = new Map(); // sessionId -> WebSocket connection
    this.userConnections = new Map(); // userId -> Set of sessionIds
    this.heartbeatIntervals = new Map(); // sessionId -> interval
  }

  handleConnection(ws, req) {
    const sessionId = req.params.sessionId;
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    logger.info('WebSocket connection attempt', { sessionId, hasToken: !!token });

    // Store connection
    this.connections.set(sessionId, ws);
    
    // Send initial connection message
    this.sendToSession(sessionId, {
      type: 'connected',
      data: {
        sessionId,
        message: 'Connected to CodexMC WebSocket',
        timestamp: new Date().toISOString()
      }
    });

    // Start heartbeat
    this.startHeartbeat(sessionId, ws);

    // Handle messages from client
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(sessionId, message, ws);
      } catch (error) {
        logger.error('WebSocket message error', { sessionId, error: error.message });
        this.sendToSession(sessionId, {
          type: 'error',
          data: { message: 'Invalid message format' }
        });
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnection(sessionId);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error', { sessionId, error: error.message });
    });
  }

  async handleMessage(sessionId, message, ws) {
    const { type, data } = message;
    
    logger.debug('WebSocket message received', { sessionId, type });

    switch (type) {
      case 'chat':
        await this.handleChatMessage(sessionId, data, ws);
        break;
        
      case 'ping':
        this.sendToSession(sessionId, {
          type: 'pong',
          data: { timestamp: new Date().toISOString() }
        });
        break;
        
      case 'typing':
        this.broadcastToUser(sessionId, {
          type: 'user_typing',
          data: { sessionId, isTyping: data.isTyping }
        });
        break;
        
      case 'generate_mod':
        await this.handleModGeneration(sessionId, data, ws);
        break;
        
      default:
        logger.warn('Unknown WebSocket message type', { sessionId, type });
    }
  }

  async handleChatMessage(sessionId, data, ws) {
    try {
      const { message, options = {} } = data;
      
      if (!message || typeof message !== 'string') {
        return this.sendToSession(sessionId, {
          type: 'error',
          data: { message: 'Message content is required' }
        });
      }

      // Add user message
      await conversationService.addMessage(sessionId, {
        role: 'user',
        content: message
      });

      // Send user message confirmation
      this.sendToSession(sessionId, {
        type: 'message_added',
        data: {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        }
      });

      // Get context and generate streaming response
      const context = await conversationService.getContextWindow(sessionId);
      
      let fullResponse = '';
      
      await aiService.generateStreamingResponse(
        context,
        sessionId,
        (chunk) => {
          if (chunk.type === 'chunk') {
            // Stream chunk to client
            this.sendToSession(sessionId, {
              type: 'chat_chunk',
              data: {
                chunk: chunk.data,
                timestamp: new Date().toISOString()
              }
            });
            fullResponse += chunk.data;
          } else if (chunk.type === 'complete') {
            // Add complete response to conversation
            conversationService.addMessage(sessionId, {
              role: 'assistant',
              content: chunk.data.content,
              metadata: chunk.data.metadata
            });
            
            this.sendToSession(sessionId, {
              type: 'chat_complete',
              data: {
                content: chunk.data.content,
                metadata: chunk.data.metadata,
                timestamp: new Date().toISOString()
              }
            });
          } else if (chunk.type === 'error') {
            this.sendToSession(sessionId, {
              type: 'error',
              data: { message: chunk.error }
            });
          }
        }
      );

    } catch (error) {
      logger.error('Chat message handling failed', { sessionId, error: error.message });
      this.sendToSession(sessionId, {
        type: 'error',
        data: { message: 'Failed to process message' }
      });
    }
  }

  async handleModGeneration(sessionId, data, ws) {
    try {
      const { prompt, loader, mcVersion, loaderVersion, options = {} } = data;
      
      // Import the existing mod generator
      const { generateMod } = require('../generator');
      
      // Send generation started message
      this.sendToSession(sessionId, {
        type: 'generation_started',
        data: {
          prompt,
          loader,
          mcVersion,
          timestamp: new Date().toISOString()
        }
      });

      // Start mod generation with streaming updates
      generateMod(
        { prompt, loader, mcVersion, loaderVersion, sessionId },
        (event) => {
          this.sendToSession(sessionId, {
            type: 'generation_event',
            data: event
          });
        }
      )
      .then(result => {
        this.sendToSession(sessionId, {
          type: 'generation_complete',
          data: result
        });
      })
      .catch(err => {
        this.sendToSession(sessionId, {
          type: 'generation_error',
          data: { message: err.message }
        });
      });

    } catch (error) {
      logger.error('Mod generation handling failed', { sessionId, error: error.message });
      this.sendToSession(sessionId, {
        type: 'error',
        data: { message: 'Failed to start mod generation' }
      });
    }
  }

  sendToSession(sessionId, message) {
    const ws = this.connections.get(sessionId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Failed to send WebSocket message', { sessionId, error: error.message });
      }
    }
  }

  broadcastToUser(sessionId, message) {
    // Find all sessions for the same user and broadcast
    const ws = this.connections.get(sessionId);
    if (ws) {
      this.sendToSession(sessionId, message);
    }
  }

  startHeartbeat(sessionId, ws) {
    const interval = setInterval(() => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.ping();
      } else {
        clearInterval(interval);
        this.heartbeatIntervals.delete(sessionId);
      }
    }, 30000); // 30 seconds

    this.heartbeatIntervals.set(sessionId, interval);
  }

  handleDisconnection(sessionId) {
    logger.info('WebSocket disconnected', { sessionId });
    
    // Clean up connection
    this.connections.delete(sessionId);
    
    // Clear heartbeat
    const interval = this.heartbeatIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(sessionId);
    }
    
    // Notify other sessions if needed
    this.broadcastToUser(sessionId, {
      type: 'user_disconnected',
      data: { sessionId, timestamp: new Date().toISOString() }
    });
  }

  getSessionStats() {
    return {
      activeConnections: this.connections.size,
      heartbeatIntervals: this.heartbeatIntervals.size
    };
  }

  // Force disconnect a session
  disconnectSession(sessionId) {
    const ws = this.connections.get(sessionId);
    if (ws) {
      ws.close();
      this.handleDisconnection(sessionId);
    }
  }

  // Broadcast to all connected sessions
  broadcast(message) {
    for (const [sessionId, ws] of this.connections) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          logger.error('Broadcast failed for session', { sessionId, error: error.message });
        }
      }
    }
  }
}

module.exports = new WebSocketService();
