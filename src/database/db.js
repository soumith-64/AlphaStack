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

// Seed initial demo data for hackathon evaluation
function seedDemoData() {
  const existing = dbOps.queryOne('SELECT COUNT(*) as count FROM users');
  if (!existing || existing.count === 0) {
    console.log('🌱 Seeding initial demo data for hackathon evaluation...');
    
    // User 1: Soumith (Mobile User)
    const u1Id = 'user_soumith';
    const u1Phone = '9876543210';
    const u1Email = `9876543210@${config.domainName}`;
    dbOps.execute(`
      INSERT INTO users (id, phone_number, email_address, display_name, language, registration_channel, has_mobile_app)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [u1Id, u1Phone, u1Email, 'Soumith V', 'en', 'MOBILE_CLIENT', 1]);

    // Aliases
    dbOps.execute(`INSERT INTO aliases (id, user_id, alias_email, label) VALUES (?, ?, ?, ?)`,
      ['alias_1', u1Id, `9876543210.work@${config.domainName}`, 'Work']);
    dbOps.execute(`INSERT INTO aliases (id, user_id, alias_email, label) VALUES (?, ?, ?, ?)`,
      ['alias_2', u1Id, `9876543210.1@${config.domainName}`, 'Personal Ext 1']);

    // User 2: Ramesh (Village Farmer / IVR Registrant)
    const u2Id = 'user_ramesh';
    const u2Phone = '9812345678';
    const u2Email = `9812345678@${config.domainName}`;
    dbOps.execute(`
      INSERT INTO users (id, phone_number, email_address, display_name, language, registration_channel, has_mobile_app)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [u2Id, u2Phone, u2Email, 'Ramesh Patel', 'hi', 'IVR', 0]);

    // Conversation 1: AlphaStack Hackathon Team
    const c1Id = 'conv_hackathon';
    dbOps.execute(`
      INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
      VALUES (?, 0, 'Welcome to AlphaStack 7-Day Buildathon!', 'hr@alphastack.tech', datetime('now', '-2 hours'))
    `, [c1Id]);

    dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
      [c1Id, null, 'hr@alphastack.tech']);
    dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
      [c1Id, u1Id, u1Phone]);

    dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, has_replied, is_read, is_starred, folder, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, 'INBOX', datetime('now', '-2 hours'))
    `, [
      'msg_1',
      c1Id,
      'hr@alphastack.tech',
      JSON.stringify([u1Email]),
      'Welcome to AlphaStack 7-Day Buildathon!',
      'Hi Soumith,\n\nWelcome to PhoneMail! Your account is active with email ID: 9876543210@phonemail.com.\n\nAll features are ready to test:\n- Spike Mail Chat Inbox\n- IVR Voice Signup\n- Targeted SMS alerts\n\nBest,\nAlphaStack Team'
    ]);

    // Conversation 2: Project Architecture Lead
    const c2Id = 'conv_project';
    dbOps.execute(`
      INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
      VALUES (?, 0, 'Urgent: Hostinger Cloud Architecture Review', '9845012345', datetime('now', '-30 minutes'))
    `, [c2Id]);

    dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
      [c2Id, null, '9845012345']);
    dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
      [c2Id, u1Id, u1Phone]);

    dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, has_replied, is_read, is_starred, folder, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'INBOX', datetime('now', '-30 minutes'))
    `, [
      'msg_2',
      c2Id,
      `9845012345@${config.domainName}`,
      JSON.stringify([u1Email]),
      'Urgent: Hostinger Cloud Architecture Review',
      'Hey Soumith, please review the Hostinger Cloud deployment before 6 PM today. Let me know if any updates are needed.'
    ]);

    // Initial Telephony Logs
    dbOps.logTelephony(u2Phone, 'INCOMING_CALL_IVR', 'Inbound call received on toll-free line. User pressed 1 to register.');
    dbOps.logTelephony(u2Phone, 'OUTGOING_NOTIFICATION_SMS', `Welcome to PhoneMail! Your email is ${u2Email}`);

    console.log('✅ Demo data seeded successfully.');
  }
}

seedDemoData();
