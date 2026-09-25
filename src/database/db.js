import initSqlJs from 'sql.js';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mysqlPool = null;
const useMysql = Boolean(config.db.name && config.db.user);

if (useMysql) {
  try {
    mysqlPool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    console.log(`🔌 [MySQL] Connection pool created for database: ${config.db.name}`);
  } catch (err) {
    console.error('❌ [MySQL Pool Creation Error]:', err.message);
    mysqlPool = null;
  }
}

// Fallback SQLite (WebAssembly) lazy initialization - ZERO top-level await for LiteSpeed lsnode.js
let db = null;
let SQL = null;
const dbPath = path.resolve(config.dbPath.endsWith('.db') ? config.dbPath.replace('.db', '.sqlite') : config.dbPath);
const dbDir = path.dirname(dbPath);

function saveToDisk() {
  if (mysqlPool || !db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    // Non-fatal warning if container disk is read-only
  }
}

async function getSqliteDb() {
  if (db) return db;
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Notice: Could not create persistent DB directory:', err.message);
  }

  try {
    if (!SQL) {
      SQL = await initSqlJs();
    }
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    db.run(schemaSql);
    try {
      db.run('ALTER TABLE emails ADD COLUMN is_important INT DEFAULT 0;');
    } catch (e) {}
    saveToDisk();
  } catch (err) {
    console.warn('Notice: SQLite initialization warning:', err.message);
  }
  return db;
}

// Database abstraction layer (supports both MySQL and SQLite seamlessly with graceful fallback)
export const dbOps = {
  async queryAll(sql, params = []) {
    if (mysqlPool) {
      try {
        const [rows] = await mysqlPool.execute(sql, params);
        return rows;
      } catch (err) {
        console.warn('Notice: MySQL query failed, falling back to local SQLite:', err.message);
        mysqlPool = null;
      }
    }
    const sqliteDb = await getSqliteDb();
    if (!sqliteDb) return [];
    const stmt = sqliteDb.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  async queryOne(sql, params = []) {
    const all = await this.queryAll(sql, params);
    return all.length > 0 ? all[0] : null;
  },

  async execute(sql, params = []) {
    if (mysqlPool) {
      try {
        const [result] = await mysqlPool.execute(sql, params);
        return { changes: result.affectedRows };
      } catch (err) {
        console.warn('Notice: MySQL execute failed, falling back to local SQLite:', err.message);
        mysqlPool = null;
      }
    }
    const sqliteDb = await getSqliteDb();
    if (sqliteDb) {
      sqliteDb.run(sql, params);
      saveToDisk();
    }
    return { changes: 1 };
  },

  async logTelephony(phoneNumber, type, content, provider = 'SYSTEM_SMS', status = 'DELIVERED') {
    const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await this.execute(
      `INSERT INTO telephony_logs (id, phone_number, type, content, provider, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, phoneNumber, type, content, provider, status]
    );
    return id;
  },

  async pruneDuplicateEmails() {
    try {
      const all = await this.queryAll('SELECT id, sender_email, subject, body_text FROM emails ORDER BY created_at ASC, id ASC');
      const seen = new Set();
      const duplicates = [];
      for (const row of all) {
        const sSub = String(row.subject || '').trim().toLowerCase();
        const sBody = String(row.body_text || '').replace(/\s+/g, ' ').trim().toLowerCase().substring(0, 60);
        const sSender = String(row.sender_email || '').trim().toLowerCase();
        const key = `${sSender}___${sSub}___${sBody}`;
        if (seen.has(key)) {
          duplicates.push(row.id);
        } else {
          seen.add(key);
        }
      }
      for (const dupId of duplicates) {
        await this.execute('DELETE FROM emails WHERE id = ?', [dupId]);
      }
      if (duplicates.length > 0) {
        console.log(`🧹 [CLEANUP] Pruned ${duplicates.length} duplicate email(s) from database.`);
      }
      return duplicates.length;
    } catch (err) {
      console.warn('Notice: Duplicate email pruning exception:', err.message);
      return 0;
    }
  }
};

export { db, mysqlPool };
