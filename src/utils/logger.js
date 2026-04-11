/**
 * Advanced Logging System
 * Structured logging with multiple levels and outputs
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');

// Ensure log directory exists
fs.ensureDirSync(path.dirname(config.logging.file));

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, sessionId, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]`;
    if (service) log += ` [${service}]`;
    if (sessionId) log += ` [${sessionId}]`;
    log += `: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: customFormat,
  defaultMeta: { service: 'codexmc' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    }),
    
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(path.dirname(config.logging.file), 'error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    })
  ]
});

// Add console transport in development
if (config.server.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Helper methods for structured logging
const structuredLogger = {
  // Session-specific logging
  session: (sessionId) => ({
    info: (message, meta = {}) => logger.info(message, { sessionId, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { sessionId, ...meta }),
    error: (message, meta = {}) => logger.error(message, { sessionId, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { sessionId, ...meta })
  }),

  // Service-specific logging
  service: (serviceName) => ({
    info: (message, meta = {}) => logger.info(message, { service: serviceName, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { service: serviceName, ...meta }),
    error: (message, meta = {}) => logger.error(message, { service: serviceName, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { service: serviceName, ...meta })
  }),

  // Request logging
  request: (req, message, meta = {}) => {
    logger.info(message, {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      ...meta
    });
  },

  // Performance logging
  performance: (operation, duration, meta = {}) => {
    logger.info(`Performance: ${operation} completed in ${duration}ms`, {
      operation,
      duration,
      ...meta
    });
  }
};

module.exports = {
  logger,
  ...structuredLogger
};
