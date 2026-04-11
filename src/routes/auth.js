/**
 * Authentication Routes
 * User registration, login, and session management
 */

const express = require('express');
const { authService } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { logger } = require('../utils/logger');

const router = express.Router();

// User registration
router.post('/register', rateLimiter.createMiddleware({ maxRequests: 5 }), async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const result = await authService.register(username, email, password);
    
    logger.info('User registered successfully', { userId: result.user.id, username });
    
    res.status(201).json({
      message: 'User registered successfully',
      user: result.user,
      token: result.token
    });
  } catch (error) {
    logger.warn('Registration failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// User login
router.post('/login', rateLimiter.createMiddleware({ maxRequests: 10 }), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authService.login(username, password);
    
    logger.info('User logged in successfully', { userId: result.user.id, username });
    
    res.json({
      message: 'Login successful',
      user: result.user,
      token: result.token
    });
  } catch (error) {
    logger.warn('Login failed', { error: error.message });
    res.status(401).json({ error: error.message });
  }
});

// Create guest session
router.post('/guest', rateLimiter.createMiddleware({ maxRequests: 20 }), async (req, res) => {
  try {
    const result = await authService.createGuestSession();
    
    logger.debug('Guest session created', { sessionId: result.sessionId });
    
    res.json({
      message: 'Guest session created',
      sessionId: result.sessionId,
      sessionToken: result.sessionToken
    });
  } catch (error) {
    logger.error('Guest session creation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to create guest session' });
  }
});

// Verify token
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const user = await authService.getUserFromToken(token);
    
    res.json({
      valid: true,
      user
    });
  } catch (error) {
    res.json({
      valid: false,
      error: error.message
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token is required' });
    }

    const token = authHeader.slice(7);
    const user = await authService.getUserFromToken(token);
    const newToken = authService.generateToken(user.id);
    
    logger.info('Token refreshed', { userId: user.id });
    
    res.json({
      message: 'Token refreshed successfully',
      token: newToken
    });
  } catch (error) {
    logger.warn('Token refresh failed', { error: error.message });
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
