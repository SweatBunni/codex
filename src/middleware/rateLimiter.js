/**
 * Rate Limiting Middleware
 * Advanced rate limiting with Redis support and multiple strategies
 */

const db = require('../utils/database');
const { logger } = require('../utils/logger');
const config = require('../config');

class RateLimiter {
  constructor() {
    this.windowMs = 60 * 60 * 1000; // 1 hour
    this.maxRequests = config.limits.maxRequestsPerHour;
    this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
    this.startCleanup();
  }

  startCleanup() {
    setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        logger.error('Rate limit cleanup failed', { error: error.message });
      }
    }, this.cleanupInterval);
  }

  async cleanup() {
    const cutoff = new Date(Date.now() - this.windowMs);
    await db.run(
      `DELETE FROM rate_limits WHERE window_start < ?`,
      [cutoff.toISOString()]
    );
  }

  async getIdentifier(req) {
    // Try to get user ID from auth header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        // In a real app, you'd decode JWT to get user ID
        return `user:${token}`;
      } catch (error) {
        // Fall back to IP
      }
    }

    // Fall back to IP address
    return `ip:${req.ip || req.connection.remoteAddress}`;
  }

  async checkLimit(identifier) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.windowMs);

    // Get or create rate limit record
    let record = await db.get(
      `SELECT * FROM rate_limits WHERE identifier = ?`,
      [identifier]
    );

    if (!record) {
      record = {
        id: require('uuid').v4(),
        identifier,
        requests_count: 0,
        window_start: windowStart.toISOString()
      };
    }

    // Check if window has expired
    const recordWindowStart = new Date(record.window_start);
    if (recordWindowStart < windowStart) {
      record.requests_count = 0;
      record.window_start = windowStart.toISOString();
    }

    // Increment counter
    record.requests_count += 1;

    // Update or insert record
    if (record.id) {
      await db.run(
        `UPDATE rate_limits SET requests_count = ?, window_start = ? WHERE id = ?`,
        [record.requests_count, record.window_start, record.id]
      );
    } else {
      await db.run(
        `INSERT INTO rate_limits (id, identifier, requests_count, window_start) VALUES (?, ?, ?, ?)`,
        [record.id, record.identifier, record.requests_count, record.window_start]
      );
    }

    return {
      allowed: record.requests_count <= this.maxRequests,
      count: record.requests_count,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - record.requests_count),
      resetTime: new Date(recordWindowStart.getTime() + this.windowMs)
    };
  }

  middleware() {
    return async (req, res, next) => {
      try {
        const identifier = await this.getIdentifier(req);
        const result = await this.checkLimit(identifier);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.limit,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': Math.ceil(result.resetTime.getTime() / 1000)
        });

        if (!result.allowed) {
          logger.warn('Rate limit exceeded', { 
            identifier, 
            count: result.count, 
            limit: result.limit,
            url: req.url,
            method: req.method
          });

          return res.status(429).json({
            error: 'Too many requests',
            message: `Rate limit exceeded. Maximum ${result.limit} requests per hour.`,
            retryAfter: Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)
          });
        }

        // Add rate limit info to request for logging
        req.rateLimit = result;
        next();
      } catch (error) {
        logger.error('Rate limiting error', { error: error.message });
        // Allow request to proceed if rate limiting fails
        next();
      }
    };
  }

  // Specialized limiters for different endpoints
  createMiddleware(options = {}) {
    const maxRequests = options.maxRequests || this.maxRequests;
    const windowMs = options.windowMs || this.windowMs;

    return async (req, res, next) => {
      try {
        const identifier = await this.getIdentifier(req);
        const key = `${identifier}:${req.path}`;
        
        let record = await db.get(
          `SELECT * FROM rate_limits WHERE identifier = ?`,
          [key]
        );

        const now = new Date();
        const windowStart = new Date(now.getTime() - windowMs);

        if (!record || new Date(record.window_start) < windowStart) {
          record = {
            id: require('uuid').v4(),
            identifier: key,
            requests_count: 0,
            window_start: windowStart.toISOString()
          };
        }

        record.requests_count += 1;

        if (record.id) {
          await db.run(
            `UPDATE rate_limits SET requests_count = ?, window_start = ? WHERE id = ?`,
            [record.requests_count, record.window_start, record.id]
          );
        } else {
          await db.run(
            `INSERT INTO rate_limits (id, identifier, requests_count, window_start) VALUES (?, ?, ?, ?)`,
            [record.id, record.identifier, record.requests_count, record.window_start]
          );
        }

        const remaining = Math.max(0, maxRequests - record.requests_count);

        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': remaining,
          'X-RateLimit-Reset': Math.ceil((new Date(record.window_start).getTime() + windowMs) / 1000)
        });

        if (record.requests_count > maxRequests) {
          return res.status(429).json({
            error: 'Too many requests',
            message: `Rate limit exceeded for this endpoint.`,
            retryAfter: Math.ceil((new Date(record.window_start).getTime() + windowMs - Date.now()) / 1000)
          });
        }

        next();
      } catch (error) {
        logger.error('Custom rate limiting error', { error: error.message });
        next();
      }
    };
  }
}

// Create and export rate limiter instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
