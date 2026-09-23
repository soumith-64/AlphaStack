-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  email_address TEXT UNIQUE NOT NULL,
  display_name TEXT,
  language TEXT DEFAULT 'en',
  registration_channel TEXT NOT NULL, -- 'IVR', 'SMS', 'WEB_PORTAL', 'WEB_CLIENT', 'MOBILE_CLIENT'
  has_mobile_app INTEGER DEFAULT 0,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aliases Table (Manage Alias IDs)
CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  alias_email TEXT UNIQUE NOT NULL,
  label TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Conversations Table (Spike Mail Threads)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  is_group INTEGER DEFAULT 0,
  subject TEXT,
  participant_phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversation Participants
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT,
  phone_number TEXT NOT NULL,
  PRIMARY KEY (conversation_id, phone_number),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Emails Table
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  sender_email TEXT NOT NULL,
  recipient_emails TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  reply_to_id TEXT,
  has_replied INTEGER DEFAULT 0,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  folder TEXT DEFAULT 'INBOX',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Telephony & SMS Audit Logs
CREATE TABLE IF NOT EXISTS telephony_logs (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  type TEXT NOT NULL, -- 'INCOMING_CALL_IVR', 'INCOMING_SMS', 'OUTGOING_NOTIFICATION_SMS', 'OUTGOING_OTP'
  content TEXT,
  provider TEXT DEFAULT 'VIRTUAL_SIMULATOR',
  status TEXT DEFAULT 'DELIVERED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
