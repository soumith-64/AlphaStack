# 🚀 PhoneMail — 5-Day Fast-Track Roadmap (Hostinger Cloud & Native Node.js)

> **AlphaStack 7-Day Buildathon Execution Plan**  
> Tailored for **Hostinger Cloud Hosting + Custom Domain + Native Node.js** (Docker is completely optional).  
> Complete all development in **5 focused days**, reserving Days 6 & 7 for video submission, presentation rehearsal, and judge Q&A.

---

## ⚡ The Lean & Fast Architecture (No Docker Required!)

By running directly on **native Node.js**:
* 🚀 **Zero Overhead:** No heavy container runtimes or virtualization issues.
* ☁️ **Hostinger Cloud Native:** Deploys in 1 click using Hostinger hPanel's built-in **Node.js Application Manager** with free SSL (`https://yourdomain.com`).
* 💻 **Runs Anywhere:** Evaluators or local testers simply run:
  ```bash
  npm install
  npm start
  ```
*(A Dockerfile will still be provided as an optional bonus, but it is not required).*

---

## 🗓️ 5-Day Step-by-Step Schedule

```
┌────────────────────────────────────────────────────────────────────────┐
│ DAY 1: Core Engine, SQLite Database & Inbound Mail Service             │
│ DAY 2: Telephony Integration, SMS Gateway & The Judge Testing Lab      │
│ DAY 3: Priority Mobile Client (WhatsApp Onboarding + Spike Mail Chats) │
│ DAY 4: Desktop Web Client (Gmail UI) & 2-Field Registration Portal     │
│ DAY 5: 1-Click Hostinger Cloud Deployment, Domain SSL & Demo Video    │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 📅 DAY 1: Core Engine, SQLite DB & Inbound Mail Service
> **Goal:** Run the backend engine that receives emails for `9876543210@yourdomain.com` and parses them into conversations.

* **Morning (Backend Skeleton & Database):**
  - Initialize Node.js Express server (`package.json`, ES modules).
  - Configure Socket.io for real-time WebSocket communication.
  - Set up SQLite database (`better-sqlite3` or Prisma) with WAL mode for zero-cost, ultra-fast storage.
  - Initialize tables: `users`, `aliases`, `conversations`, `emails`, `attachments`, `telephony_logs`.
* **Afternoon (Inbound Mail Service & Parser):**
  - Implement built-in SMTP listener (`smtp-server` on port `25` / `2525`).
  - Integrate `mailparser` to parse MIME headers, HTML/Text, and attachments.
  - Extract phone number from recipient headers (`9876543210@yourdomain.com` $\rightarrow$ `9876543210`).
  - Support sub-number aliases (`9876543210.1`, `9876543210.work`).
* **Evening (Thread Mapping & Webhook Ingestion):**
  - Automatically map incoming emails into threaded conversations.
  - Create Inbound Webhook (`/api/email/inbound`) so Hostinger Catch-All email can route external mail directly into the database.
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
    2. Test email composer to inject emails directly into the parser.
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

### 📅 DAY 5: 1-Click Hostinger Cloud Deployment & Demo Video
> **Goal:** Deploy live to `https://yourdomain.com` on Hostinger Cloud and record your winning demo.

* **Morning (Deploying on Hostinger Cloud):**
  - Log into **Hostinger hPanel** $\rightarrow$ Navigate to **Node.js**.
  - Select Node version `20.x`, set entry point to `src/server.js`.
  - Connect your GitHub repository: `https://github.com/soumith-64/AlphaStack.git`.
  - Click **Deploy**! Hostinger runs `npm install` and starts the app automatically.
  - Enable free SSL Certificate on `yourdomain.com`.
* **Afternoon (Catch-All Email & Real-World Inbound Test):**
  - In Hostinger hPanel $\rightarrow$ **Emails**, enable **Catch-All Email** for your domain.
  - Send an email from your personal Gmail to `yourphone@yourdomain.com`.
  - Verify it arrives live on your website!
* **Evening (Demo Video & Presentation Rehearsal):**
  - Populate database with realistic seed demo data.
  - Record a 3-minute video walk-through demonstrating:
    1. IVR Call / Simulator registration.
    2. Inbound email triggering SMS notification.
    3. Mobile WhatsApp onboarding and Spike Mail chat threading.
    4. Desktop Gmail interface.
* **🎯 Day 5 Deliverable:** Live website running on Hostinger Cloud at `https://yourdomain.com` ready for submission!

---

## 🏆 Days 6 & 7: Buffer & Submission Polish
* Review submission against hackathon judging rubric.
* Finalize slide deck and README documentation.
* Submit repository link and live URL ahead of the deadline!
