const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class SqlitePool {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(dbPath);
    this.initialized = this.initSchema();
  }

  async initSchema() {
    // Enable foreign keys
    await new Promise((resolve, reject) => {
      this.db.run('PRAGMA foreign_keys = ON;', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      let schemaSql = fs.readFileSync(schemaPath, 'utf8');

      // Convert MySQL schema to SQLite schema
      schemaSql = schemaSql
        .replace(/CREATE DATABASE[\s\S]*?;/g, '')
        .replace(/USE smart_fitness_tracker;/g, '')
        .replace(/INT AUTO_INCREMENT PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/ENUM\([^)]+\)/gi, 'TEXT')
        .replace(/DECIMAL\([^)]+\)/gi, 'NUMERIC');

      // Execute each statement
      const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        await new Promise((resolve, reject) => {
          this.db.run(statement, (err) => {
            if (err) {
              console.error('Error executing schema statement:', statement, err.message);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
    }
  }

  async query(sql, params) {
    await this.initialized;

    // Translate query on-the-fly
    let sqliteSql = sql;

    // Translate 1: INFORMATION_SCHEMA.COLUMNS
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      const columns = await new Promise((resolve, reject) => {
        this.db.all(`PRAGMA table_info(users)`, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      const matching = columns
        .filter(c => ['email', 'password_hash'].includes(c.name))
        .map(c => ({ COLUMN_NAME: c.name }));
      return [matching, []];
    }

    // Translate 2: ALTER TABLE users ADD COLUMN ... AFTER ...
    if (sqliteSql.includes('ALTER TABLE users ADD COLUMN')) {
      sqliteSql = sqliteSql.replace(/\s+AFTER\s+\w+/gi, '');
    }

    // Translate 3: CONCAT
    if (sqliteSql.includes('CONCAT(')) {
      // Simple translation for CONCAT('legacy', id, '@example.com')
      sqliteSql = sqliteSql.replace(/CONCAT\('legacy',\s*id,\s*'@example.com'\)/gi, "'legacy' || id || '@example.com'");
    }

    // Translate 4: ADD UNIQUE KEY uq_users_email (email)
    if (sqliteSql.includes('ALTER TABLE users ADD UNIQUE KEY')) {
      sqliteSql = "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email)";
    }

    // Prepare parameters for sqlite3 (prefix keys with :)
    let sqliteParams = {};
    if (params) {
      if (Array.isArray(params)) {
        sqliteParams = params;
      } else {
        for (const [key, value] of Object.entries(params)) {
          sqliteParams[`:${key}`] = value;
        }
      }
    }

    // Determine query type (SELECT vs INSERT/UPDATE/DELETE)
    const cleanSql = sqliteSql.trim().toUpperCase();
    const isSelect = cleanSql.startsWith('SELECT') || cleanSql.startsWith('PRAGMA');

    if (isSelect) {
      return new Promise((resolve, reject) => {
        this.db.all(sqliteSql, sqliteParams, (err, rows) => {
          if (err) reject(err);
          else resolve([rows, []]);
        });
      });
    } else {
      return new Promise((resolve, reject) => {
        this.db.run(sqliteSql, sqliteParams, function (err) {
          if (err) reject(err);
          else resolve([{ insertId: this.lastID, affectedRows: this.changes }, []]);
        });
      });
    }
  }

  async end() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

function createPool(config) {
  const dbPath = path.join(__dirname, 'db', 'smart_fitness_tracker.sqlite');
  console.log(`Using SQLite fallback database at: ${dbPath}`);
  return new SqlitePool(dbPath);
}

module.exports = { createPool };
