const fs = require('fs');
const path = require('path');
const { MemoryPool } = require('./memory-pool');

let sqlite3 = null;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (err) {
  console.warn('sqlite3 native addon not available, using MemoryPool:', err.message);
}

class SqlitePool {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.fallback = null;
    try {
      this.db = new sqlite3.Database(dbPath);
      this.initialized = this.initSchema();
    } catch (e) {
      console.warn('Failed to open SQLite database, falling back to MemoryPool:', e.message);
      this.fallback = new MemoryPool();
      this.initialized = Promise.resolve();
    }
  }

  async initSchema() {
    if (this.fallback) return;

    try {
      // Enable foreign keys
      await new Promise((resolve, reject) => {
        this.db.run('PRAGMA foreign_keys = ON;', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const defaultSchema = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          age INTEGER NULL,
          gender TEXT NULL,
          height_cm NUMERIC NULL,
          weight_kg NUMERIC NULL,
          goal TEXT NULL,
          calorie_goal INTEGER NULL DEFAULT NULL,
          protein_goal INTEGER NULL DEFAULT NULL,
          water_goal_ml INTEGER NULL DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS meals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          meal_date TEXT NOT NULL,
          meal_type TEXT NOT NULL,
          food_name TEXT NOT NULL,
          calories INTEGER NOT NULL,
          protein_g NUMERIC NOT NULL DEFAULT 0,
          carbs_g NUMERIC NOT NULL DEFAULT 0,
          fats_g NUMERIC NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          workout_date TEXT NOT NULL,
          activity TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          calories_burned INTEGER NOT NULL,
          intensity TEXT NOT NULL DEFAULT 'Medium',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS water_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          log_date TEXT NOT NULL,
          amount_ml INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `;

      let schemaSql = defaultSchema;
      const schemaPath = path.join(__dirname, 'db', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        try {
          const fileSql = fs.readFileSync(schemaPath, 'utf8')
            .replace(/CREATE DATABASE[\s\S]*?;/g, '')
            .replace(/USE smart_fitness_tracker;/g, '')
            .replace(/INT AUTO_INCREMENT PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
            .replace(/ENUM\([^)]+\)/gi, 'TEXT')
            .replace(/DECIMAL\([^)]+\)/gi, 'NUMERIC');
          if (fileSql.trim()) schemaSql = fileSql;
        } catch (e) {
          console.warn('Could not read schema.sql, using built-in schema:', e.message);
        }
      }

      const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        await new Promise((resolve, reject) => {
          this.db.run(statement, (err) => {
            if (err) {
              console.warn('Warning executing schema statement:', err.message);
              resolve(); // Don't reject entire setup on individual statement warnings
            } else {
              resolve();
            }
          });
        });
      }
    } catch (err) {
      console.warn('SQLite initSchema encountered error, switching to MemoryPool:', err.message);
      this.fallback = new MemoryPool();
    }
  }

  async query(sql, params) {
    await this.initialized;
    if (this.fallback) {
      return this.fallback.query(sql, params);
    }

    try {
      // Translate query on-the-fly
      let sqliteSql = sql;

      // Translate 1: INFORMATION_SCHEMA.COLUMNS
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        const columns = await new Promise((resolve, reject) => {
          this.db.all(`PRAGMA table_info(users)`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
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

      const cleanSql = sqliteSql.trim().toUpperCase();
      const isSelect = cleanSql.startsWith('SELECT') || cleanSql.startsWith('PRAGMA');

      if (isSelect) {
        return await new Promise((resolve, reject) => {
          this.db.all(sqliteSql, sqliteParams, (err, rows) => {
            if (err) reject(err);
            else resolve([rows || [], []]);
          });
        });
      } else {
        return await new Promise((resolve, reject) => {
          this.db.run(sqliteSql, sqliteParams, function (err) {
            if (err) reject(err);
            else resolve([{ insertId: this.lastID, affectedRows: this.changes }, []]);
          });
        });
      }
    } catch (err) {
      console.warn('SQLite query failed, falling back to MemoryPool:', err.message);
      if (!this.fallback) this.fallback = new MemoryPool();
      return this.fallback.query(sql, params);
    }
  }

  async end() {
    if (this.fallback) return this.fallback.end();
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      this.db.close(() => resolve());
    });
  }
}

function createPool(config) {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (!sqlite3) {
    console.log('Using MemoryPool database fallback');
    return new MemoryPool();
  }

  try {
    const dbPath = isServerless
      ? path.join('/tmp', 'smart_fitness_tracker.sqlite')
      : path.join(__dirname, 'db', 'smart_fitness_tracker.sqlite');

    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log(`Using SQLite database at: ${dbPath}`);
    return new SqlitePool(dbPath);
  } catch (err) {
    console.warn('Could not initialize SQLite, using MemoryPool:', err.message);
    return new MemoryPool();
  }
}

module.exports = { createPool };
