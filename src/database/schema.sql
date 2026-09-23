-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  phone_number VARCHAR(32) UNIQUE NOT NULL,
  email_address VARCHAR(191) UNIQUE NOT NULL,
  display_name VARCHAR(191),
  language VARCHAR(10) DEFAULT 'en',
  registration_channel VARCHAR(32) NOT NULL, -- 'IVR', 'SMS', 'WEB_PORTAL', 'WEB_CLIENT', 'MOBILE_CLIENT'
  has_mobile_app INT DEFAULT 0,
  avatar_url VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aliases Table (Manage Alias IDs)
CREATE TABLE IF NOT EXISTS aliases (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  alias_email VARCHAR(191) UNIQUE NOT NULL,
  label VARCHAR(64),
  is_active INT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Conversations Table (Spike Mail Threads)
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY,
  is_group INT DEFAULT 0,
  subject VARCHAR(255),
  participant_phone VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversation Participants
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  phone_number VARCHAR(32) NOT NULL,
  PRIMARY KEY (conversation_id, phone_number),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Emails Table
CREATE TABLE IF NOT EXISTS emails (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64),
  sender_email VARCHAR(191) NOT NULL,
  recipient_emails TEXT NOT NULL,
  subject VARCHAR(255),
  body_text TEXT,
  body_html TEXT,
  reply_to_id VARCHAR(64),
  has_replied INT DEFAULT 0,
  is_read INT DEFAULT 0,
  is_starred INT DEFAULT 0,
  folder VARCHAR(32) DEFAULT 'INBOX',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Telephony & SMS Audit Logs
CREATE TABLE IF NOT EXISTS telephony_logs (
  id VARCHAR(64) PRIMARY KEY,
  phone_number VARCHAR(32) NOT NULL,
  type VARCHAR(64) NOT NULL, -- 'INCOMING_CALL_IVR', 'INCOMING_SMS', 'OUTGOING_NOTIFICATION_SMS', 'OUTGOING_OTP'
  content TEXT,
  provider VARCHAR(64) DEFAULT 'VIRTUAL_SIMULATOR',
  status VARCHAR(32) DEFAULT 'DELIVERED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
