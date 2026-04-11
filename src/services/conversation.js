/**
 * Conversation Management Service
 * ChatGPT-like conversation handling with context and history
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const { logger } = require('../utils/logger');
const config = require('../config');

class ConversationService {
  constructor() {
    this.maxMessages = config.limits.maxSessionLength;
    this.maxPromptLength = config.limits.maxPromptLength;
  }

  async createSession(userId = null) {
    const sessionId = uuidv4();
    const sessionData = {
      id: sessionId,
      user_id: userId,
      messages: JSON.stringify([]),
      metadata: JSON.stringify({
        created: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      })
    };

    await db.run(
      `INSERT INTO sessions (id, user_id, messages, metadata) VALUES (?, ?, ?, ?)`,
      [sessionId, userId, sessionData.messages, sessionData.metadata]
    );

    logger.info('New session created', { sessionId, userId });
    return sessionId;
  }

  async getSession(sessionId) {
    const session = await db.get(
      `SELECT * FROM sessions WHERE id = ?`,
      [sessionId]
    );

    if (!session) {
      throw new Error('Session not found');
    }

    return {
      ...session,
      messages: JSON.parse(session.messages || '[]'),
      metadata: JSON.parse(session.metadata || '{}')
    };
  }

  async addMessage(sessionId, message) {
    const session = await this.getSession(sessionId);
    const messages = session.messages;

    // Validate message
    if (message.content && message.content.length > this.maxPromptLength) {
      throw new Error(`Message too long. Maximum ${this.maxPromptLength} characters allowed.`);
    }

    // Add timestamp and ID
    const messageWithMeta = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...message
    };

    messages.push(messageWithMeta);

    // Trim messages if too long
    if (messages.length > this.maxMessages) {
      messages.splice(0, messages.length - this.maxMessages);
    }

    // Update session
    await db.run(
      `UPDATE sessions SET messages = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(messages), sessionId]
    );

    logger.debug('Message added to session', { sessionId, messageId: messageWithMeta.id });
    return messageWithMeta;
  }

  async getConversationHistory(sessionId, limit = 50) {
    const session = await this.getSession(sessionId);
    const messages = session.messages;

    // Return last N messages
    const startIndex = Math.max(0, messages.length - limit);
    return messages.slice(startIndex);
  }

  async getContextWindow(sessionId, maxTokens = 8000) {
    const messages = await this.getConversationHistory(sessionId);
    const context = [];
    let currentTokens = 0;

    // Rough estimation: 1 token ~ 4 characters
    const estimateTokens = (text) => Math.ceil(text.length / 4);

    // Add messages from oldest to newest until token limit
    for (const message of messages.reverse()) {
      const messageTokens = estimateTokens(
        `${message.role}: ${message.content || ''}`
      );

      if (currentTokens + messageTokens > maxTokens) {
        break;
      }

      context.unshift(message);
      currentTokens += messageTokens;
    }

    return context;
  }

  async clearSession(sessionId) {
    await db.run(
      `UPDATE sessions SET messages = ?, metadata = ? WHERE id = ?`,
      [
        JSON.stringify([]),
        JSON.stringify({
          cleared: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        }),
        sessionId
      ]
    );

    logger.info('Session cleared', { sessionId });
  }

  async deleteSession(sessionId) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    logger.info('Session deleted', { sessionId });
  }

  async updateSessionMetadata(sessionId, metadata) {
    const session = await this.getSession(sessionId);
    const updatedMetadata = { ...session.metadata, ...metadata };

    await db.run(
      `UPDATE sessions SET metadata = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(updatedMetadata), sessionId]
    );

    return updatedMetadata;
  }

  async searchSessions(userId, query) {
    const sessions = await db.query(
      `SELECT id, created_at, last_active, metadata 
       FROM sessions 
       WHERE user_id = ? 
       ORDER BY last_active DESC`,
      [userId]
    );

    // Simple text search in metadata
    const results = sessions.filter(session => {
      const metadata = JSON.parse(session.metadata || '{}');
      const searchText = JSON.stringify(metadata).toLowerCase();
      return searchText.includes(query.toLowerCase());
    });

    return results;
  }

  async getSessionStats(sessionId) {
    const session = await this.getSession(sessionId);
    const messages = session.messages;

    const stats = {
      totalMessages: messages.length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length,
      systemMessages: messages.filter(m => m.role === 'system').length,
      totalCharacters: messages.reduce((sum, m) => sum + (m.content?.length || 0), 0),
      averageMessageLength: 0,
      firstMessageTime: messages[0]?.timestamp,
      lastMessageTime: messages[messages.length - 1]?.timestamp
    };

    if (messages.length > 0) {
      stats.averageMessageLength = Math.round(stats.totalCharacters / messages.length);
    }

    return stats;
  }

  // ChatGPT-like conversation features
  async generateResponse(sessionId, prompt, aiService) {
    // Add user message
    await this.addMessage(sessionId, {
      role: 'user',
      content: prompt
    });

    // Get context for AI
    const context = await this.getContextWindow(sessionId);
    
    // Generate response using AI service
    const response = await aiService.generateResponse(context);

    // Add assistant response
    await this.addMessage(sessionId, {
      role: 'assistant',
      content: response.content,
      metadata: response.metadata
    });

    return response;
  }

  async regenerateResponse(sessionId, messageId, aiService) {
    const session = await this.getSession(sessionId);
    const messages = session.messages;
    
    // Find the message to regenerate
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      throw new Error('Message not found');
    }

    const messageToRegenerate = messages[messageIndex];
    if (messageToRegenerate.role !== 'assistant') {
      throw new Error('Can only regenerate assistant messages');
    }

    // Get context up to the message before this one
    const contextMessages = messages.slice(0, messageIndex);
    
    // Generate new response
    const response = await aiService.generateResponse(contextMessages);

    // Replace the old message
    messages[messageIndex] = {
      ...messageToRegenerate,
      content: response.content,
      metadata: response.metadata,
      regenerated: true,
      regeneratedAt: new Date().toISOString()
    };

    // Update session
    await db.run(
      `UPDATE sessions SET messages = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(messages), sessionId]
    );

    return response;
  }

  async editMessage(sessionId, messageId, newContent) {
    const session = await this.getSession(sessionId);
    const messages = session.messages;
    
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      throw new Error('Message not found');
    }

    // Store original content
    const originalContent = messages[messageIndex].content;
    
    // Update message
    messages[messageIndex] = {
      ...messages[messageIndex],
      content: newContent,
      edited: true,
      editedAt: new Date().toISOString(),
      originalContent
    };

    // Update session
    await db.run(
      `UPDATE sessions SET messages = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(messages), sessionId]
    );

    logger.info('Message edited', { sessionId, messageId });
    return messages[messageIndex];
  }
}

module.exports = new ConversationService();
