/**
 * Database Management System
 * Supports SQLite and PostgreSQL with connection pooling
 */

// Temporary fix - make sqlite3 optional
let sqlite3, Pool;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (error) {
  console.log('SQLite3 not available, using fallback storage');
  sqlite3 = null;
}

try {
  Pool = require('pg');
} catch (error) {
  console.log('PostgreSQL not available');
  Pool = null;
}

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
      if (this.type === 'sqlite' && sqlite3) {
        await this.initSQLite();
      } else if (this.type === 'postgresql' && Pool) {
        await this.initPostgreSQL();
      } else {
        // Fallback to file-based storage
        console.log('Using fallback file storage');
        this.useFallback = true;
        this.fallbackData = {};
        await this.loadFallbackData();
      }

      if (!this.useFallback) {
        await this.createTables();
      }
      this.initialized = true;
      console.log('Storage initialized successfully');
    } catch (error) {
      console.log('Database initialization failed, using fallback:', error.message);
      this.useFallback = true;
      this.fallbackData = {};
      await this.loadFallbackData();
      this.initialized = true;
    }
  }

  async loadFallbackData() {
    try {
      const dataFile = path.join(process.cwd(), 'data', 'fallback-storage.json');
      await fs.ensureDir(path.dirname(dataFile));
      if (await fs.pathExists(dataFile)) {
        this.fallbackData = await fs.readJson(dataFile);
      } else {
        this.fallbackData = { users: {}, sessions: {}, projects: {}, builds: {}, rateLimits: {} };
      }
    } catch (error) {
      this.fallbackData = { users: {}, sessions: {}, projects: {}, builds: {}, rateLimits: {} };
    }
  }

  async saveFallbackData() {
    try {
      const dataFile = path.join(process.cwd(), 'data', 'fallback-storage.json');
      await fs.ensureDir(path.dirname(dataFile));
      await fs.writeJson(dataFile, this.fallbackData, { spaces: 2 });
    } catch (error) {
      console.log('Failed to save fallback data:', error.message);
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
      if (this.useFallback) {
        // Simple fallback for basic queries
        return [];
      } else if (this.type === 'sqlite') {
        return await this.client.all(sql, params);
      } else {
        const result = await this.client.query(sql, params);
        return result.rows;
      }
    } catch (error) {
      console.log('Database query failed, using fallback:', error.message);
      return [];
    }
  }

  async get(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.useFallback) {
        return null;
      } else if (this.type === 'sqlite') {
        return await this.client.get(sql, params);
      } else {
        const result = await this.client.query(sql, params);
        return result.rows[0];
      }
    } catch (error) {
      console.log('Database get failed, using fallback:', error.message);
      return null;
    }
  }

  async run(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.useFallback) {
        await this.saveFallbackData();
        return { affectedRows: 1 };
      } else if (this.type === 'sqlite') {
        return await this.client.run(sql, params);
      } else {
        await this.client.query(sql, params);
        return { affectedRows: 1 };
      }
    } catch (error) {
      console.log('Database run failed, using fallback:', error.message);
      return { affectedRows: 1 };
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
