# 🚀 PhoneMail — 5-Day Fast-Track Roadmap (Hostinger Cloud + Docker)

> **AlphaStack 7-Day Buildathon Execution Plan**  
> Tailored specifically for **Hostinger Cloud Hosting + Custom Domain + Docker (`docker compose up -d`)**.  
> Complete all coding in **5 focused days**, reserving Days 6 & 7 for video submission, presentation rehearsal, and judge Q&A.

---

## 🏗️ The Dual-Deployment Strategy

This roadmap enables **two simultaneous deployment targets** from the same codebase:
1. 🐳 **Docker Evaluation Mode (`docker compose up -d`):** Satisfies the hackathon requirement for judges testing locally.
2. ☁️ **Hostinger Cloud Live Site (`https://yourdomain.com`):** Hosted via Hostinger's hPanel Node.js Application Manager with free SSL and Git auto-deploy.

---

## 🗓️ 5-Day Step-by-Step Schedule

```
┌────────────────────────────────────────────────────────────────────────┐
│ DAY 1: Core Engine, SQLite Database & Inbound SMTP Mail Service       │
│ DAY 2: Telephony Integration, SMS Gateway & The Judge Testing Lab      │
│ DAY 3: Priority Mobile Client (WhatsApp Onboarding + Spike Mail Chats) │
│ DAY 4: Desktop Web Client (Gmail UI) & 2-Field Registration Portal     │
│ DAY 5: Hostinger Cloud Live Deploy + Docker Verification & Demo Video  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 📅 DAY 1: Core Engine, SQLite DB & Inbound SMTP Service
> **Goal:** Run the backend engine that receives emails for `9876543210@yourdomain.com` and parses them into conversations.

* **Morning (Backend Skeleton & Database):**
  - Set up Node.js Express server with ES modules.
  - Configure Socket.io for real-time WebSocket communication.
  - Set up SQLite database (`better-sqlite3` or Prisma) with WAL mode.
  - Initialize tables: `users`, `aliases`, `conversations`, `emails`, `attachments`, `telephony_logs`.
* **Afternoon (Self-Hosted Inbound SMTP Engine):**
  - Implement local SMTP server using `smtp-server` on port `25` (and dev port `2525`).
  - Integrate `mailparser` to stream and parse raw MIME messages.
  - Extract phone number from recipient headers (`9876543210@yourdomain.com` $\rightarrow$ `9876543210`).
  - Support sub-number aliases (`9876543210.1`, `9876543210.work`).
* **Evening (Thread Mapping & Storage):**
  - Automatically associate emails from the same sender into a single conversation thread.
  - Build Inbound Webhook endpoint (`/api/email/inbound`) so Hostinger Catch-All email can forward emails into the app.
  - Test sending a local email and verify it stores in SQLite within 50ms.
* **🎯 Day 1 Deliverable:** A test email to `9876543210@yourdomain.com` is captured, parsed, and stored in the database!

---

### 📅 DAY 2: Telephony Integration, SMS & Judge Testing Lab
> **Goal:** Build the Toll-Free IVR (Press '1' & '2'), SMS account creation, targeted notifications, and the zero-cost testing sandbox.

* **Morning (Twilio Webhooks & Telephony Logic):**
  - `/api/twilio/voice`: TwiML `<Gather numDigits="1">` (Press 1 to create account; Press 2 for Audio Mailbox).
  - `/api/twilio/voice-gather`: Extract Caller ID, register account with `registrationChannel = 'IVR'`, and send confirmation SMS.
  - `/api/twilio/sms`: Handle inbound SMS messages to create accounts.
* **Afternoon (Targeted SMS Notification Engine):**
  - Implement notification logic:
    $$\text{Trigger SMS} \iff \text{user.hasMobileApp} == \text{false}$$
  - Message format:
    ```
    You have received an email from <Sender>. Subject: <Subject>.
    ```
* **Evening (In-App Judge Testing Lab at `/simulator`):**
  - Build interactive testing panel:
    1. Keypad to simulate Toll-Free Call and press '1' or '2'.
    2. Test email composer to send emails directly into the parser.
    3. Real-time streaming **SMS Audit Log** displaying outbound notification messages.
* **🎯 Day 2 Deliverable:** Anyone can test IVR calls, simulate incoming mail, and audit SMS notifications directly in the browser!

---

### 📅 DAY 3: Priority Mobile Client (WhatsApp UI + Spike Mail Inbox)
> **Goal:** Build the complete mobile experience adhering strictly to WhatsApp and Spike Mail design languages.

* **Morning (WhatsApp 4-Screen Onboarding at `/mobile`):**
  - **Screen 1:** Language Selection (English, Hindi, etc.) with custom radio controls and WhatsApp-green accents.
  - **Screen 2:** Terms & Conditions with WhatsApp styling and "AGREE AND CONTINUE".
  - **Screen 3:** Phone Number Verification with country dropdown and simulated SIM pre-fill.
  - **Screen 4:** 6-digit OTP verification with auto-fill simulation $\rightarrow$ transitions immediately to Inbox.
  - Simulated device permission prompts (Contacts, Notifications).
* **Afternoon (Spike Mail Conversational Inbox):**
  - Unified chat list: All emails from the same contact grouped into a single chat (no separate Inbox/Sent).
  - Search bar + Filter chips: `All`, `Unread`, `Attachments`, `Favorites`.
  - Left navigation drawer: Home, Drafts, Spam, Trash.
  - Profile & Alias modal: Add Sub-numbers (`.1`, `.work`), Family Profiles, QR Card.
* **Evening (Inside a Chat & Group Logic):**
  - Compact Subject bar above message input box (hidden during threaded replies).
  - Swipe right on message bubble to quote/reply (single-reply rule enforced).
  - Long-email "Read more..." expander to traditional full view.
  - Camera-tab toggle for Traditional Email Compose with locked `To` field.
  - Composing to 2+ recipients from Home auto-spawns a **Group Chat**.
* **🎯 Day 3 Deliverable:** Full WhatsApp + Spike Mail web client running with real-time WebSocket chat updates.

---

### 📅 DAY 4: Desktop Web Client (Gmail UI) & 2-Field Web Portal
> **Goal:** Build the desktop power-user interface and the rapid registration kiosk.

* **Morning (2-Field Web Registration Portal at `/portal`):**
  - Ultra-clean dedicated screen with only two fields: `[ Phone Number ]` + `[ OTP ]`.
  - On submit: displays success toast and **immediately resets fields** for the next user.
* **Afternoon (Desktop Gmail Experience at `/desktop`):**
  - Single-card login (Phone + OTP + Terms of Service hyperlink).
  - Material 3 Gmail UI:
    - Collapsible left rail with Compose button, Inbox (with unread badge), Sent, Drafts, Spam, Trash.
    - Top search bar and profile avatar.
    - Email list with checkboxes, stars, sender name, subject-snippet preview, timestamp.
    - Side-by-side reading pane with full headers and Quick Reply / Forward buttons.
    - Settings modal for Alias IDs management and signatures.
* **Evening (Smart Viewport Router):**
  - Auto-detects screen width on `/`:
    - Screen width $< 768px$ $\rightarrow$ loads Mobile Client.
    - Screen width $\ge 768px$ $\rightarrow$ loads Desktop Client.
  - Floating top Device Switcher Pill (`[📱 Mobile] | [💻 Desktop] | [📋 Portal] | [🧪 Simulator]`).
* **🎯 Day 4 Deliverable:** All client interfaces live, styled, and synchronized across both mobile and desktop.

---

### 📅 DAY 5: Hostinger Cloud Live Deploy + Docker Verification
> **Goal:** Deploy live to `yourdomain.com` on Hostinger Cloud and verify `docker compose up -d`.

* **Morning (Dockerization for Hackathon Judges):**
  - Finalize multi-stage `Dockerfile` and `docker-compose.yml`.
  - Test on clean machine: `docker compose up -d` boots everything with 0 errors.
* **Afternoon (Hostinger Cloud Deployment):**
  - Log into **Hostinger hPanel** $\rightarrow$ **Node.js**.
  - Connect your GitHub repository: `https://github.com/soumith-64/AlphaStack.git`.
  - Set Entry Point: `src/server.js` and Node Version: `20.x`.
  - Click **Deploy**!
  - Enable free SSL Certificate on `yourdomain.com`.
  - (Optional) Configure Hostinger Catch-All email forwarding to your webhook.
* **Evening (Demo Video & Presentation Rehearsal):**
  - Populate database with realistic seed data.
  - Record a 3-minute video walk-through demonstrating:
    1. IVR Call / Simulator registration.
    2. Inbound email triggering SMS notification.
    3. Mobile WhatsApp onboarding and Spike Mail chat threading.
    4. Desktop Gmail interface.
* **🎯 Day 5 Deliverable:** Live website running on Hostinger Cloud at `https://yourdomain.com` + Docker repository verified!

---

## 🏆 Days 6 & 7: Buffer & Submission Polish
* Review submission against hackathon judging rubric.
* Finalize slide deck and README documentation.
* Submit repository link and live URL ahead of the deadline!
