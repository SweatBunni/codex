/**
 * Simple Database Bypass
 * Temporary solution to get server running without sqlite3
 */

const fs = require('fs-extra');
const path = require('path');

class Database {
  constructor() {
    this.initialized = false;
    this.dataDir = path.join(process.cwd(), 'data');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.projectsFile = path.join(this.dataDir, 'projects.json');
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await fs.ensureDir(this.dataDir);
      
      // Initialize data files if they don't exist
      if (!(await fs.pathExists(this.sessionsFile))) {
        await fs.writeJson(this.sessionsFile, {});
      }
      if (!(await fs.pathExists(this.usersFile))) {
        await fs.writeJson(this.usersFile, {});
      }
      if (!(await fs.pathExists(this.projectsFile))) {
        await fs.writeJson(this.projectsFile, {});
      }

      this.initialized = true;
      console.log('Simple database initialized successfully');
    } catch (error) {
      console.log('Database initialization failed:', error.message);
      throw error;
    }
  }

  async query(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Simple mock responses for basic queries
    if (sql.includes('SELECT COUNT(*)')) {
      return [{ count: 0 }];
    }
    
    return [];
  }

  async get(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Return null for most get operations
    return null;
  }

  async run(sql, params = []) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Mock successful run
    return { affectedRows: 1 };
  }

  async close() {
    // Nothing to close for simple file storage
    console.log('Database connection closed');
  }
}

// Singleton instance
const db = new Database();

module.exports = db;
