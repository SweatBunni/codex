/**
 * Database Management System
 * Supports SQLite and PostgreSQL with connection pooling
 */

const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const { logger } = require('./logger');

class Database {
  constructor() {
    this.client = null;
    this.type = config.database.type;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      if (this.type === 'sqlite') {
        await this.initSQLite();
      } else if (this.type === 'postgresql') {
        await this.initPostgreSQL();
      } else {
        throw new Error(`Unsupported database type: ${this.type}`);
      }

      await this.createTables();
      this.initialized = true;
      logger.info('Database initialized successfully', { type: this.type });
    } catch (error) {
      logger.error('Database initialization failed', { error: error.message });
      throw error;
    }
  }

  async initSQLite() {
    const dbPath = path.resolve(config.database.url);
    await fs.ensureDir(path.dirname(dbPath));
    
    this.client = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error('SQLite connection failed', { error: err.message });
        throw err;
      }
    });

    // Promisify SQLite methods
    this.client.run = (...args) => new Promise((resolve, reject) => {
      this.client.db.run(...args, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });

    this.client.get = (...args) => new Promise((resolve, reject) => {
      this.client.db.get(...args, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    this.client.all = (...args) => new Promise((resolve, reject) => {
      this.client.db.all(...args, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async initPostgreSQL() {
    this.client = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    await this.client.query('SELECT NOW()');
  }

  async createTables() {
    const tables = {
      users: `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password_hash TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          preferences TEXT -- JSON
        )
      `,
      sessions: `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          messages TEXT, -- JSON array
          metadata TEXT, -- JSON object
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `,
      projects: `
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          loader TEXT NOT NULL,
          minecraft_version TEXT NOT NULL,
          loader_version TEXT,
          status TEXT DEFAULT 'created', -- created, generating, building, completed, failed
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          files TEXT, -- JSON array of generated files
          build_output TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
      `,
      builds: `
        CREATE TABLE IF NOT EXISTS builds (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending', -- pending, building, completed, failed
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          build_log TEXT,
          jar_path TEXT,
          source_zip_path TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `,
      rate_limits: `
        CREATE TABLE IF NOT EXISTS rate_limits (
          id TEXT PRIMARY KEY,
          identifier TEXT NOT NULL, -- IP or user ID
          requests_count INTEGER DEFAULT 0,
          window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `
    };

    for (const [name, sql] of Object.entries(tables)) {
      try {
        await this.query(sql);
        logger.debug('Table created/verified', { table: name });
      } catch (error) {
        logger.error('Failed to create table', { table: name, error: error.message });
        throw error;
      }
    }
  }

  async query(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.type === 'sqlite') {
        return await this.client.all(sql, params);
      } else {
        const result = await this.client.query(sql, params);
        return result.rows;
      }
    } catch (error) {
      logger.error('Database query failed', { sql, params, error: error.message });
      throw error;
    }
  }

  async get(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.type === 'sqlite') {
        return await this.client.get(sql, params);
      } else {
        const result = await this.client.query(sql, params);
        return result.rows[0];
      }
    } catch (error) {
      logger.error('Database get failed', { sql, params, error: error.message });
      throw error;
    }
  }

  async run(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.type === 'sqlite') {
        return await this.client.run(sql, params);
      } else {
        await this.client.query(sql, params);
        return { affectedRows: 1 };
      }
    } catch (error) {
      logger.error('Database run failed', { sql, params, error: error.message });
      throw error;
    }
  }

  async close() {
    if (this.type === 'sqlite' && this.client) {
      this.client.close();
    } else if (this.type === 'postgresql' && this.client) {
      await this.client.end();
    }
  }
}

// Singleton instance
const db = new Database();

module.exports = db;
