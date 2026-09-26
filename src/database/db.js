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
        'ALTER TABLE conversations MODIFY COLUMN participant_phone VARCHAR(191)',
        'ALTER TABLE users ADD COLUMN bio TEXT'
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
    try {
      db.run('ALTER TABLE emails ADD COLUMN read_at DATETIME DEFAULT NULL;');
    } catch (e) {}
    try {
      db.run('ALTER TABLE users ADD COLUMN bio TEXT;');
    } catch (e) {}
    try {
      db.run('ALTER TABLE users ADD COLUMN read_receipts_enabled INT DEFAULT 1;');
    } catch (e) {}
    try {
      db.run(`CREATE TABLE IF NOT EXISTS deleted_email_signatures (
        signature VARCHAR(255) PRIMARY KEY,
        message_id VARCHAR(255),
        sender VARCHAR(255),
        subject VARCHAR(255),
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
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
            if (col === 'read_at') typeDef = 'DATETIME DEFAULT NULL';
            if (col === 'read_receipts_enabled') typeDef = 'INT DEFAULT 1';
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
            if (col === 'read_at') typeDef = 'DATETIME DEFAULT NULL';
            if (col === 'read_receipts_enabled') typeDef = 'INT DEFAULT 1';
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

  async recordDeletedEmail(email) {
    if (!email) return;
    try {
      const sender = String(email.sender_email || '').toLowerCase().trim();
      const subject = String(email.subject || '').trim().toLowerCase();
      const sig = `${sender}___${subject}`;
      if (mysqlPool) {
        try {
          await mysqlPool.execute(`
            INSERT INTO deleted_email_signatures (signature, message_id, sender, subject)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP
          `, [sig, email.id || null, email.sender_email || null, email.subject || null]);
          return;
        } catch(mErr) {}
      }
      const sqliteDb = await getSqliteDb();
      if (sqliteDb) {
        sqliteDb.run(`
          INSERT OR REPLACE INTO deleted_email_signatures (signature, message_id, sender, subject, deleted_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [sig, email.id || null, email.sender_email || null, email.subject || null]);
        saveToDisk();
      }
    } catch (e) {
      console.warn('Notice: recordDeletedEmail note:', e.message);
    }
  },

  async isEmailDeleted(sender, subject) {
    try {
      const sSender = String(sender || '').toLowerCase().trim();
      const sSub = String(subject || '').trim().toLowerCase();
      const sig = `${sSender}___${sSub}`;
      const row = await this.queryOne(`
        SELECT signature FROM deleted_email_signatures 
        WHERE signature = ? OR (sender = ? AND subject = ?)
        LIMIT 1
      `, [sig, sSender, sSub]);
      return !!row;
    } catch (e) {
      return false;
    }
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
  },

  async consolidateConversations() {
    try {
      function extractClean(str) {
        if (!str) return 'unknown';
        const angleMatch = str.match(/<([^>]+)>/);
        let s = angleMatch ? angleMatch[1] : str;
        s = s.replace(/^["']|["']$/g, '').trim().toLowerCase();
        const atIdx = s.indexOf('@');
        if (atIdx !== -1) {
          const local = s.substring(0, atIdx).trim();
          const cleanDigits = local.replace(/\D/g, '');
          if (cleanDigits.length >= 10 && cleanDigits.length <= 13) {
            return cleanDigits.slice(-10);
          }
          return s;
        }
        const digits = s.replace(/\D/g, '');
        if (digits.length >= 10) return digits.slice(-10);
        return s;
      }

      const convs = await this.queryAll('SELECT * FROM conversations ORDER BY created_at ASC');
      const convMap = new Map();
      for (const c of convs) {
        const p = extractClean(c.participant_phone);
        const key = c.is_group ? ('group_' + c.id) : ('direct_' + p);
        if (!convMap.has(key)) {
          convMap.set(key, c);
        } else {
          const master = convMap.get(key);
          await this.execute('UPDATE emails SET conversation_id = ? WHERE conversation_id = ?', [master.id, c.id]);
          await this.execute('DELETE FROM conversation_participants WHERE conversation_id = ?', [c.id]);
          await this.execute('DELETE FROM conversations WHERE id = ?', [c.id]);
          if (c.subject) {
            await this.execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, subject = ? WHERE id = ?', [c.subject, master.id]);
          }
        }
      }
      console.log('✅ [CONSOLIDATION] Contact-based conversation threads synchronized.');
    } catch (err) {
      console.warn('Notice: Conversation consolidation exception:', err.message);
    }
  }
};

export { db, mysqlPool };
