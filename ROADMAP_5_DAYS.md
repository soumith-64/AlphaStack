# 🚀 PhoneMail — 5-Day Fast-Track Hackathon Roadmap

> **AlphaStack 7-Day Buildathon Strategy**  
> Complete all development in **5 focused days**, reserving Days 6 & 7 for video presentation, judge Q&A preparation, and final polish.

---

## 🎯 Daily Checklist & Deliverables

### 📅 DAY 1: Core Engine, Database & Local Inbound SMTP Server
- [ ] Initialize Node.js Express server with WebSocket (Socket.io) support.
- [ ] Set up SQLite with WAL mode (`better-sqlite3` or Prisma).
- [ ] Create database tables: `users`, `aliases`, `conversations`, `emails`, `attachments`, `telephony_logs`.
- [ ] Implement local SMTP server (`smtp-server`) listening on port 25 (and 2525 for dev).
- [ ] Integrate `mailparser` to extract From, To, Subject, HTML/Text, and Attachments from MIME streams.
- [ ] Normalize recipient phone number from `<phone>@domain.com` (e.g. `9876543210`).
- [ ] Save inbound emails to DB and map them to threaded conversations.
- [ ] **Day 1 Milestone:** Test sending an email via Nodemailer/Telnet and see it saved in SQLite.

---

### 📅 DAY 2: Telephony Integration & In-App Judge Testing Simulator
- [ ] Implement Twilio Voice Webhook `/api/twilio/voice` with TwiML `<Gather numDigits="1">`.
- [ ] Implement `/api/twilio/voice-gather`: Press '1' registers Caller ID; Press '2' for Audio Mailbox (TTS).
- [ ] Implement Twilio SMS Webhook `/api/twilio/sms` for SMS-based registration.
- [ ] Implement Targeted SMS Notification Dispatcher:
  - Trigger rule: If inbound email arrives and `!user.hasMobileApp`, send:  
    `"You have received an email from <Sender>. Subject: <Subject>."`
- [ ] Build the interactive **Judge Testing Lab (`/simulator`)**:
  - Interactive keypad to simulate Toll-Free Call and press '1'.
  - Test Inbound Email Dispatcher form.
  - Real-time streaming **SMS Audit Log** displaying outbound notification messages.
- [ ] **Day 2 Milestone:** Full telephony and notification flow testable in browser without spending money.

---

### 📅 DAY 3: Priority Mobile Client (WhatsApp Onboarding + Spike Mail Inbox)
- [ ] Build **WhatsApp-style 4-Screen Onboarding (`/mobile`)**:
  - Screen 1: Language Selection (English, Hindi, etc.).
  - Screen 2: Terms & Conditions with WhatsApp green buttons.
  - Screen 3: Phone Number Verification with SIM pre-fill simulation.
  - Screen 4: 6-digit OTP verification with auto-fill simulation.
  - Simulated device permission prompts (Contacts, Notifications).
- [ ] Build **Spike Mail Conversational Inbox**:
  - Unified chat view (all emails from same contact grouped; no separate Inbox/Sent).
  - Search bar + Filter chips: `All`, `Unread`, `Attachments`, `Favorites`.
  - Left navigation drawer: Home, Drafts, Spam, Trash.
  - Profile & Alias Management: Add Sub-numbers (`.1`, `.work`), Family Profiles, QR Card.
- [ ] Build **Inside a Conversation**:
  - Compact Subject bar above message input box (hidden during threaded replies).
  - Swipe right on message bubble to quote/reply (single-reply rule enforced).
  - Long-email "Read more..." expander to traditional full view.
  - Camera-tab toggle for Traditional Email Compose with locked `To` field.
  - Composing to 2+ recipients from Home auto-spawns a Group Chat.
- [ ] **Day 3 Milestone:** Mobile web app fully functional with live real-time WebSocket chat updates.

---

### 📅 DAY 4: Desktop Web Client (Gmail UI) & 2-Field Web Portal
- [ ] Build **Web Registration Portal (`/portal`)**:
  - Exactly 2 fields: `[ Phone Number ]` + `[ OTP ]`.
  - Auto-reset state immediately on successful submission.
- [ ] Build **Desktop Gmail Client (`/desktop`)**:
  - Single-card login (Phone + OTP + Terms of Service link).
  - Material 3 Gmail UI:
    - Collapsible left rail with Compose button, Inbox (with unread badge), Sent, Drafts, Spam, Trash.
    - Top search bar and profile avatar.
    - Email list with checkboxes, stars, sender name, subject-snippet preview, timestamp.
    - Side-by-side reading pane with full headers and Quick Reply / Forward buttons.
    - Settings modal for Alias IDs management and signatures.
- [ ] Implement **Smart Viewport Router**:
  - Auto-detects screen width on `/` (Mobile vs. Desktop).
  - Floating top Device Switcher Pill (`[📱 Mobile] | [💻 Desktop] | [📋 Portal] | [🧪 Simulator]`).
- [ ] **Day 4 Milestone:** All client interfaces live, styled, and synchronized.

---

### 📅 DAY 5: Dockerization (`docker compose up -d`), DNS Setup & Demo Polish
- [ ] Create multi-stage `Dockerfile` and `docker-compose.yml`.
- [ ] Verify single command startup: `docker compose up -d`.
- [ ] Configure custom domain DNS records:
  - `A` record for `@` pointing to Server IP.
  - `A` record for `mail` pointing to Server IP.
  - `MX` record with Priority `10` pointing to `mail.yourdomain.com`.
  - `TXT` record for SPF protection.
- [ ] Deploy container to your hosting server and send real emails from external Gmail.
- [ ] Populate database with realistic seed data for presentation.
- [ ] Rehearse 3-minute video walk-through covering all hackathon requirements.
- [ ] **Day 5 Milestone:** Live production system running on your domain with 2 days of buffer remaining!
