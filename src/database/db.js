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

    // Auto-run schema migrations on MySQL
    (async () => {
      const migrations = [
        'ALTER TABLE emails ADD COLUMN is_important INT DEFAULT 0',
        "ALTER TABLE emails ADD COLUMN folder VARCHAR(50) DEFAULT 'INBOX'",
        'ALTER TABLE emails ADD COLUMN is_starred INT DEFAULT 0',
        'ALTER TABLE emails ADD COLUMN has_replied INT DEFAULT 0',
        'ALTER TABLE emails ADD COLUMN reply_to_id VARCHAR(64)',
        'ALTER TABLE users ADD COLUMN language VARCHAR(10) DEFAULT "en"',
        'ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)',
        'ALTER TABLE conversation_participants MODIFY COLUMN phone_number VARCHAR(191)',
        'ALTER TABLE conversations MODIFY COLUMN participant_phone VARCHAR(191)'
      ];
      for (const m of migrations) {
        try {
          await mysqlPool.execute(m);
          console.log(`✅ [MySQL Migration] Executed: ${m}`);
        } catch (e) {
          // ignore ER_DUP_FIELDNAME (1060) or existing columns
        }
      }
    })().catch(e => console.warn('MySQL schema check notice:', e.message));
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
    try {
      db.run("ALTER TABLE emails ADD COLUMN folder VARCHAR(50) DEFAULT 'INBOX';");
    } catch (e) {}
    try {
      db.run('ALTER TABLE emails ADD COLUMN is_starred INT DEFAULT 0;');
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
        console.warn('Notice: MySQL query warning:', err.message);
        const colMatch = (err.message || '').match(/Unknown column '([^']+)'/i);
        if (colMatch && colMatch[1]) {
          const col = colMatch[1];
          try {
            let typeDef = 'INT DEFAULT 0';
            if (col === 'folder') typeDef = "VARCHAR(50) DEFAULT 'INBOX'";
            if (col === 'reply_to_id') typeDef = 'VARCHAR(64) DEFAULT NULL';
            if (col === 'avatar_url') typeDef = 'VARCHAR(255) DEFAULT NULL';
            if (col === 'language') typeDef = "VARCHAR(10) DEFAULT 'en'";
            await mysqlPool.execute(`ALTER TABLE emails ADD COLUMN \`${col}\` ${typeDef}`);
            console.log(`✅ [MySQL Auto-Heal] Added missing column \`${col}\` to emails table`);
            const [retryRows] = await mysqlPool.execute(sql, params);
            return retryRows;
          } catch (mErr) {
            if (col === 'is_important') {
              try {
                const fallbackSql = sql.replace(/is_important DESC,\s*/gi, '').replace(/\s*AND\s+is_important\s*=\s*\d+/gi, '');
                const [fallbackRows] = await mysqlPool.execute(fallbackSql, params);
                return fallbackRows;
              } catch (fErr) {}
            }
          }
        }
        if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
          console.warn('⚠️ [MySQL] Connection lost, switching to local SQLite');
          mysqlPool = null;
        } else {
          // Keep using MySQL pool - do NOT fall back to empty SQLite on SQL errors
          return [];
        }
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
        console.warn('Notice: MySQL execute warning:', err.message);
        const colMatch = (err.message || '').match(/Unknown column '([^']+)'/i);
        if (colMatch && colMatch[1]) {
          const col = colMatch[1];
          try {
            let typeDef = 'INT DEFAULT 0';
            if (col === 'folder') typeDef = "VARCHAR(50) DEFAULT 'INBOX'";
            if (col === 'reply_to_id') typeDef = 'VARCHAR(64) DEFAULT NULL';
            await mysqlPool.execute(`ALTER TABLE emails ADD COLUMN \`${col}\` ${typeDef}`);
            console.log(`✅ [MySQL Auto-Heal] Added missing column \`${col}\` to emails table`);
            const [retryResult] = await mysqlPool.execute(sql, params);
            return { changes: retryResult.affectedRows };
          } catch (mErr) {}
        }
        if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
          console.warn('⚠️ [MySQL] Connection lost, switching to local SQLite');
          mysqlPool = null;
        } else {
          return { changes: 0, error: err.message };
        }
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
