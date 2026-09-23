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

// Fallback SQLite (WebAssembly) initialization
let db = null;
const dbPath = path.resolve(config.dbPath.endsWith('.db') ? config.dbPath.replace('.db', '.sqlite') : config.dbPath);
const dbDir = path.dirname(dbPath);

try {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
} catch (err) {
  console.warn('Notice: Could not create persistent DB directory:', err.message);
}

const SQL = await initSqlJs();

try {
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
} catch (err) {
  console.warn('Notice: Could not load DB file from disk, using in-memory DB:', err.message);
  db = new SQL.Database();
}

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

// Initialize SQLite schema if MySQL is not configured
if (!mysqlPool) {
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    db.run(schemaSql);
    saveToDisk();
  } catch (err) {
    console.error('Schema initialization warning:', err.message);
  }
}

// Database abstraction layer (supports both MySQL and SQLite seamlessly)
export const dbOps = {
  async queryAll(sql, params = []) {
    if (mysqlPool) {
      try {
        const [rows] = await mysqlPool.execute(sql, params);
        return rows;
      } catch (err) {
        console.error('MySQL queryAll error:', err.message);
        throw err;
      }
    }
    const stmt = db.prepare(sql);
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
        console.error('MySQL execute error:', err.message);
        throw err;
      }
    }
    db.run(sql, params);
    saveToDisk();
    return { changes: 1 };
  },

  async logTelephony(phoneNumber, type, content, provider = 'VIRTUAL_SIMULATOR', status = 'DELIVERED') {
    const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await this.execute(
      `INSERT INTO telephony_logs (id, phone_number, type, content, provider, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, phoneNumber, type, content, provider, status]
    );
    return id;
  }
};

export { db, mysqlPool };
