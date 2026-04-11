/**
 * Authentication & Authorization Middleware
 * JWT-based auth with session management
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const { logger } = require('../utils/logger');
const config = require('../config');

class AuthService {
  constructor() {
    this.jwtSecret = config.security.jwtSecret;
    this.sessionSecret = config.security.sessionSecret;
    this.tokenExpiry = '24h';
  }

  async hashPassword(password) {
    return await bcrypt.hash(password, config.security.bcryptRounds);
  }

  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  generateToken(userId) {
    return jwt.sign(
      { userId, type: 'auth' },
      this.jwtSecret,
      { expiresIn: this.tokenExpiry }
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  generateSessionToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  async register(username, email, password) {
    // Check if user already exists
    const existingUser = await db.get(
      `SELECT id FROM users WHERE username = ? OR email = ?`,
      [username, email]
    );

    if (existingUser) {
      throw new Error('User already exists');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);
    const userId = uuidv4();

    // Create user
    await db.run(
      `INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)`,
      [userId, username, email, passwordHash]
    );

    logger.info('User registered', { userId, username });
    
    // Generate token
    const token = this.generateToken(userId);
    
    return {
      user: { id: userId, username, email },
      token
    };
  }

  async login(username, password) {
    // Find user
    const user = await db.get(
      `SELECT * FROM users WHERE username = ? OR email = ?`,
      [username, username]
    );

    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Update last active
    await db.run(
      `UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?`,
      [user.id]
    );

    logger.info('User logged in', { userId: user.id, username: user.username });

    // Generate token
    const token = this.generateToken(user.id);
    
    return {
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        preferences: JSON.parse(user.preferences || '{}')
      },
      token
    };
  }

  async getUserFromToken(token) {
    const decoded = this.verifyToken(token);
    
    const user = await db.get(
      `SELECT id, username, email, preferences, is_active FROM users WHERE id = ?`,
      [decoded.userId]
    );

    if (!user || !user.is_active) {
      throw new Error('User not found or inactive');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      preferences: JSON.parse(user.preferences || '{}')
    };
  }

  async updateUserPreferences(userId, preferences) {
    await db.run(
      `UPDATE users SET preferences = ? WHERE id = ?`,
      [JSON.stringify(preferences), userId]
    );
  }

  async createGuestSession() {
    const sessionId = uuidv4();
    const sessionToken = this.generateSessionToken();
    
    // Store guest session
    await db.run(
      `INSERT INTO sessions (id, metadata) VALUES (?, ?)`,
      [sessionId, JSON.stringify({ 
        type: 'guest',
        token: sessionToken,
        created: new Date().toISOString()
      })]
    );

    return { sessionId, sessionToken };
  }

  async validateGuestSession(sessionId, sessionToken) {
    const session = await db.get(
      `SELECT metadata FROM sessions WHERE id = ?`,
      [sessionId]
    );

    if (!session) {
      throw new Error('Session not found');
    }

    const metadata = JSON.parse(session.metadata || '{}');
    if (metadata.type !== 'guest' || metadata.token !== sessionToken) {
      throw new Error('Invalid session');
    }

    return true;
  }
}

// Middleware functions
const authService = new AuthService();

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const user = await authService.getUserFromToken(token);
    
    req.user = user;
    next();
  } catch (error) {
    logger.warn('Authentication failed', { error: error.message });
    return res.status(401).json({ error: 'Invalid authentication' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const user = await authService.getUserFromToken(token);
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Continue without auth for optional endpoints
    next();
  }
};

const requireGuestSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const sessionToken = req.headers['x-session-token'];
    
    if (!sessionId || !sessionToken) {
      return res.status(401).json({ error: 'Session credentials required' });
    }

    await authService.validateGuestSession(sessionId, sessionToken);
    req.sessionId = sessionId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid session' });
  }
};

// Rate limiting for authenticated users (higher limits)
const authRateLimit = (maxRequests = 100) => {
  return async (req, res, next) => {
    if (req.user) {
      // Authenticated users get higher limits
      req.rateLimitMultiplier = 5;
    }
    next();
  };
};

module.exports = {
  authService,
  requireAuth,
  optionalAuth,
  requireGuestSession,
  authRateLimit
};
