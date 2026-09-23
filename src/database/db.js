import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(config.dbPath.endsWith('.db') ? config.dbPath.replace('.db', '.sqlite') : config.dbPath);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const SQL = await initSqlJs();
let db;

// Load existing database if available, or create new
if (fs.existsSync(dbPath)) {
  const fileBuffer = fs.readFileSync(dbPath);
  db = new SQL.Database(fileBuffer);
} else {
  db = new SQL.Database();
}

// Function to persist database to disk
function saveToDisk() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('Failed to persist database:', err.message);
  }
}

// Initialize schema
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.run(schemaSql);
saveToDisk();

// Database abstraction layer
export const dbOps = {
  queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  queryOne(sql, params = []) {
    const all = this.queryAll(sql, params);
    return all.length > 0 ? all[0] : null;
  },

  execute(sql, params = []) {
    db.run(sql, params);
    saveToDisk();
    return { changes: 1 };
  },

  logTelephony(phoneNumber, type, content, provider = 'VIRTUAL_SIMULATOR', status = 'DELIVERED') {
    const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    db.run(
      `INSERT INTO telephony_logs (id, phone_number, type, content, provider, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, phoneNumber, type, content, provider, status]
    );
    saveToDisk();
    return id;
  }
};

export { db };

