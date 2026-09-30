# 🇮🇳 INAI — Bharat's Unified Phone-to-Email WebApp

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Hostinger](https://img.shields.io/badge/Hostinger-Cloud%20Hosting-673AB7?logo=hostinger&logoColor=white)](https://www.hostinger.com/)
[![Encryption](https://img.shields.io/badge/Security-AES--256--GCM%20%7C%20TLS%201.3-046A38?logo=shield&logoColor=white)](https://alphastack.wwisvnr.com/api/security/status)
[![Socket.io](https://img.shields.io/badge/Socket.io-Real--Time%20Sync-010101?logo=socket.dot.io&logoColor=white)](https://socket.io/)
[![TextBee](https://img.shields.io/badge/TextBee-4--Hr%20SMS%20Gateway-FF671F?logo=message&logoColor=white)](https://textbee.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 🚀 **Built for the AlphaStack Hackathon 2026**  
> Imagine an email ecosystem where nobody needs to remember, spell, or register cryptic email handles like `john.doe1992@gmail.com`.  
> What if your email was simply your **10-digit mobile number**: **`9876543210@alphastack.wwisvnr.com`**?  
> **INAI (Instant Network AI)** makes this a reality for Bharat — an ultra-modern, zero-delay phone-powered email platform featuring **AES-256-GCM payload encryption at rest**, **Spike/WhatsApp-style Messenger view**, **real-time WebSocket synchronization**, **instant voice mails**, and **national Tiranga aesthetics**.

---

## ⚡ Key Highlights & Core Innovations

1. **📱 Phone Number IS Your Email Address:**  
   Your email ID is automatically mapped to your mobile number (`+91 93815 64959` $\rightarrow$ `9381564959@alphastack.wwisvnr.com`). Sending an email to any 10-digit phone number delivers it straight to that user's inbox.
2. **🔐 Enterprise-Grade Cryptographic Architecture (AES-256-GCM & TLS 1.3):**  
   - **At-Rest Zero-Knowledge Encryption:** Message bodies (`body_text` & `body_html`) are encrypted with authenticated **AES-256-GCM** using unique 96-bit random IVs and 128-bit authentication tags before touching SQLite / MySQL storage (`enc:v1:<iv>:<tag>:<ciphertext>`).
   - **In-Transit Security:** Full **TLS 1.3 / HTTPS** for clients, **Port 465 SSL/TLS** for Hostinger outbound SMTP, and **Port 993 SSL/TLS** for Hostinger inbound IMAP.
   - **Digital Verification Fingerprint:** Every message receives a tamper-proof SHA-256 integrity stamp (e.g., `INAI-874B-ACCD-9B66`).
   - **Public Security Proof:** Live cryptographic verification endpoint at `GET /api/security/status`.
3. **💬 Messenger View (WhatsApp / Spike Mail Experience):**  
   - Seamlessly converts traditional formal emails into conversational chat threads grouped by contact.
   - Features speech bubbles, double checkmarks (`✓✓` delivered/read status), inline image preview thumbnails, quoted reply chips, and swipe-right-to-reply mobile touch gestures.
   - One-tap switch between **Messenger View** and **Traditional Email View** on mobile and desktop.
4. **🔄 Continuous Live Email Sync (5s Polling & WebSockets):**  
   Continuous background polling (5-second intervals) combined with instant Socket.IO push broadcasts (`email:new`, `email:sent`, `email:incoming`) ensures new emails and badges update instantly without manual page reloads.
5. **👥 Automatic Contact Saving & Instant Autocomplete:**  
   Sending an email to any new number automatically registers and saves it as a contact in the database. Next time you start typing the number or name in the compose "To" field (on desktop or mobile), a rich contact card appears with their formatted phone number (`+91 XXXXX XXXXX`), avatar, and verified member status.
6. **⏰ 4-5+ Hour Unread Delayed SMS Notifications (TextBee Gateway):**  
   An automated background worker continuously scans for unviewed emails. If an email remains unread for **4 to 5 or more hours**, a subject-only SMS reminder is automatically dispatched to the recipient's phone via the TextBee SMS Gateway, ensuring critical messages are never missed.
7. **🚫 One-Click Sender Blocking & Spam Reporting:**  
   Users can block spam senders directly from the desktop reading pane, bulk selection bar, or mobile chat menu. Blocked senders are tracked in `blocked_senders` and automatically routed to the Spam folder.
8. **📝 Drafts Management Engine:**  
   Fully functional drafts pipeline (`POST /api/emails/draft` & `DELETE /api/emails/draft/:id`). Auto-saves message drafts with AES-256 encryption, provides live draft count badges, and lets users resume drafting directly in the compose dock.
9. **🚀 Instant Outbound Dispatch (< 20ms Response):**  
   Outbound email submissions save and return immediately with instant WebSocket delivery to internal users, while external SMTP transmission to Gmail/Outlook runs asynchronously in the background.
10. **🎙️ Voice Mails with Waveform Player & AI Transcription:**  
    Record and send audio voice notes directly inside emails. Includes animated waveform scrubbing, playback speed toggles (`1x`, `1.5x`, `2x`), and instant AI transcription text.
11. **🪪 Luxury Digital ID Card with 3D Flip & QR Code:**  
    Official smart identity card with a holographic EMV chip, 3D flip animation, verified `AES-256-GCM / SHA-256` security badge, dynamic `mailto:` QR code, and 1-click image download.
12. **🌐 Real-Time Multilingual Translation:**  
    Translate the entire UI and incoming email bodies on the fly across **English, हिन्दी (Hindi), தமிழ் (Tamil), and తెలుగు (Telugu)**.

---

## 🛡️ Cryptographic Security & Encryption Architecture

```
[Web & Mobile Client]
         │
         ▼ (Layer 1: TLS 1.3 HTTPS & Secure WSS)
[AlphaStack INAI Gateway]
         │
    ┌────┴──────────────────────────┐
    ▼                               ▼
(Layer 2: AES-256-GCM at Rest)   (Layer 3: SMTPS / IMAPS)
[MySQL / SQLite Database]        [External Hostinger Mail Server]
• body_text & body_html stored    • Port 465 SSL/TLS Outbound
  as: enc:v1:<iv>:<tag>:<cipher>  • Port 993 SSL/TLS Inbound
• Zero-Knowledge at Rest          • SHA-256 Integrity Verification
```

### Encryption Specifications

| Property | Implementation Detail |
| :--- | :--- |
| **Payload Cipher** | **AES-256-GCM** (Authenticated Encryption with Associated Data) |
| **Key Size** | 256 bits (32 bytes), derived via SHA-256 from application secret |
| **Initialization Vector** | Unique 96-bit (12-byte) cryptographic random IV per email |
| **Authentication Tag** | 128-bit GCM tag verifying payload integrity and preventing tampering |
| **Storage Format** | `enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>` |
| **In-Transit Encryption** | **TLS 1.3** on Web/API, **Port 465 SSL** on SMTP, **Port 993 SSL** on IMAP |
| **Integrity Stamp** | Deterministic SHA-256 digital verification hash (`INAI-XXXX-YYYY-ZZZZ`) |
| **Backward Compatibility** | Unencrypted legacy database records pass through without errors |
| **Public Status API** | `GET /api/security/status` |

---

## 🛠️ Technology Stack

| Layer | Technologies Used | Purpose |
| :--- | :--- | :--- |
| **Backend Core** | **Node.js 18+ / 20+**, **Express.js (ESM)** | High-throughput REST API, session management & routing |
| **Cryptography** | **Node.js `crypto` (`aes-256-gcm`)** | Zero-knowledge authenticated payload encryption & SHA-256 stamps |
| **Real-Time Engine** | **Socket.io** | Sub-millisecond push delivery for inbound and outbound messages |
| **Database** | **MySQL 8.0** (Hostinger Cloud) / **SQLite (WAL Mode)** | Dual-mode persistence with automatic failover and migrations |
| **SMTP Delivery** | **Nodemailer**, **Hostinger SMTP (Port 465 SSL)** | Outbound delivery to Gmail, Outlook, Yahoo, and corporate domains |
| **IMAP Sync** | **Raw TLS Sockets**, **mailparser** | Inbound polling directly from Hostinger IMAP mailboxes |
| **SMS Gateway** | **TextBee Android SMS Gateway** | 4-Hour delayed unread email alerts via live SMS |
| **Authentication** | **Phone.Email SDK**, **Direct OTP** | SMS & WhatsApp one-tap authentication + 6-cell Telegram OTP auto-submit |
| **Translation Engine** | **Google Neural API + Fallback Dictionaries** | Real-time multilingual translation for Indian regional languages |
| **Styling & UI** | **Vanilla CSS (Tiranga Tokens)** | Zero bloated frameworks, 60fps animations, Daylight & Midnight themes |

---

## 📱 Detailed Feature Catalog

### 1. Unified Mailbox Structure
INAI offers comprehensive folder management across desktop and mobile:
- **All Mail (`ALL`):** Displays all incoming, outgoing, and sub-account communications with synchronized unread counts.
- **Inbox (`INBOX`):** Primary inbound messages with live unread count badges.
- **Important (`IMPORTANT`):** Priority messages flagged with gold stars and priority sorting (`ORDER BY is_important DESC`).
- **Starred (`STARRED`):** Bookmarked and highlighted threads.
- **Sent (`SENT`):** Outgoing emails with recipient phone or email formatting.
- **Drafts (`DRAFTS`):** Saved encrypted drafts that can be reopened and continued anytime.
- **Archive (`ARCHIVE`):** Archived emails removed from the active stream.
- **Spam (`SPAM`):** Blocked senders and flagged spam messages.
- **Trash (`TRASH`):** Deleted messages pending permanent cleanup.

### 2. Messenger View (WhatsApp / Spike Mail Style)
- Converts email threads into clean, modern chat bubbles.
- Displays participant avatars, sender badges, message timestamps, and delivery double-checkmarks.
- Displays voice mail audio bars, inline attachments, and full email reading modal links.
- Supports swipe-to-reply gestures on touch devices.

### 3. Continuous Background Sync
- Both desktop and mobile webapps poll `/api/emails` and `/api/emails/stats` every 5 seconds.
- Incoming emails trigger real-time audio chime notifications and insert directly into active conversation timelines without page reloads.

### 4. Automatic Contact Discovery & Auto-Registration
- Inbound and outbound phone numbers are automatically registered in the `users` table.
- Contacts endpoint (`GET /api/contacts`) returns all verified INAI phone users with their display names, avatar URLs, and activity status.

### 5. 4-Hour Unread Delayed SMS Notifications
- When an email arrives, a 4-hour countdown starts.
- If the recipient reads the email within 4 hours, no SMS is sent.
- If the email remains unread after 4 hours, an automated SMS reminder containing the subject line is sent to the recipient's phone via TextBee.

### 6. One-Click Sender Blocking & Spam Reporting
- Senders can be blocked immediately from the reading view or bulk selection toolbar.
- Future emails from blocked senders are automatically diverted to the **Spam** folder.

### 7. Instant Outbound SMTP Delivery
- Submitting an outbound email completes in `< 20ms` for a snappy user experience.
- The server saves and encrypts the message locally, broadcasts via WebSockets, and dispatches external SMTP delivery asynchronously.

### 8. Voice Mails with Waveform Player & AI Transcription
- Record voice notes inside the compose window.
- Visual waveform player with play/pause, time scrubber, and speed controls (`1x`, `1.5x`, `2x`).
- Includes AI transcription text displayed directly beneath the voice bubble.

### 9. Luxury Digital ID Card & Dynamic QR Code
- Displays user photo/initials, verified phone number, official email address, and issuance date.
- Card back displays the holographic magstripe and security certificate: `SECURITY: AES-256-GCM / SHA-256`.
- Dynamic SVG QR code configured with `mailto:` scheme for instant scan-to-compose on any device.
- 1-Click high-resolution PNG download and Web Share API integration.

### 10. Real-Time Multilingual Translation
- Instant UI translation across 4 languages:
  - 🇬🇧 English
  - 🇮🇳 हिन्दी (Hindi)
  - 🇮🇳 தமிழ் (Tamil)
  - 🇮🇳 తెలుగు (Telugu)
- **Reading Pane AI Translation:** One-click translation of email subject lines and body text into the user's selected language.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18.x or 20.x
- npm 9+

### Installation & Run

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/soumith-64/AlphaStack.git
   cd AlphaStack
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   HOST=0.0.0.0
   DOMAIN_NAME=alphastack.wwisvnr.com
   JWT_SECRET=super_secret_jwt_key_phonemail_alphastack_2026
   ENCRYPTION_KEY=super_secret_jwt_key_phonemail_alphastack_2026

   # Hostinger MySQL Database (or leave empty for SQLite)
   DB_HOST=localhost
   DB_PORT=3306
   DB_NAME=u663364821_alphastack
   DB_USER=u663364821_alphastack_hk
   DB_PASSWORD=YourDatabasePasswordHere

   # Hostinger SMTP & IMAP
   HOSTINGER_SMTP_HOST=smtp.hostinger.com
   HOSTINGER_SMTP_PORT=465
   HOSTINGER_SMTP_USER=admin@alphastack.wwisvnr.com
   HOSTINGER_SMTP_PASS=YourEmailPasswordHere
   HOSTINGER_IMAP_HOST=imap.hostinger.com
   HOSTINGER_IMAP_PORT=993
   HOSTINGER_IMAP_USER=admin@alphastack.wwisvnr.com
   HOSTINGER_IMAP_PASS=YourEmailPasswordHere

   # TextBee Live SMS Gateway
   TEXTBEE_DEVICE_ID=YourTextbeeDeviceId
   TEXTBEE_API_KEY=YourTextbeeApiKey

   NODE_ENV=production
   ```

3. **Install Dependencies:**
   ```bash
   npm install
   ```

4. **Verify Syntax & Code Correctness:**
   ```bash
   node --check src/server.js
   node --check src/services/cryptoService.js
   node --check src/services/emailService.js
   node --check src/routes/emailRoutes.js
   ```

5. **Start INAI Server:**
   ```bash
   npm start
   ```

6. **Access Web Interfaces:**
   - 💻 **Desktop WebApp:** [http://localhost:3000/desktop/](http://localhost:3000/desktop/)
   - 📱 **Mobile WebApp (Messenger View):** [http://localhost:3000/mobile/](http://localhost:3000/mobile/)
   - 🛡️ **Cryptographic Security Proof:** [http://localhost:3000/api/security/status](http://localhost:3000/api/security/status)

---

## 🌐 Production Cloud Deployment (Hostinger)

INAI is pre-packaged and optimized for deployment on **Hostinger Cloud Hosting / VPS**:

1. Extract the deployment archive:
   - Use `alphastack.zip` (contains all application source code, pre-configured `.env`, and dependencies).
2. Configure Node.js in **Hostinger hPanel**:
   - Set Node version to **`20.x`**.
   - Set Application Entry File to **`app.js`** (or **`src/server.js`**).
3. Run `npm install` and restart the application.
4. Verify the deployment:
   - Public Website: `https://alphastack.wwisvnr.com/`
   - Security API: `https://alphastack.wwisvnr.com/api/security/status`

---

## 🐳 Docker Container Deployment

The platform includes a production-ready, lightweight `node:20-alpine` Docker configuration with automatic health checking.

### 1-Command Startup:
```bash
docker compose up -d --build
```

### Useful Docker Commands:
```bash
# View live container logs
docker compose logs -f

# Check container health status
docker compose ps

# Stop the container
docker compose down

# Rebuild the image
docker compose build
```

### Pull from Docker Hub:
```bash
# Pull official image directly from Docker Hub
docker pull soumithjv/inai-alphastack:latest

# Run container with environment file
docker run -d -p 3000:3000 --env-file .env --name inai-app soumithjv/inai-alphastack:latest
```

The container automatically maps port `3000:3000`, loads your environment variables from `.env`, runs an integrated healthcheck against `/health`, and restarts automatically (`unless-stopped`).

---

## 📂 Project Directory Structure

```
AlphaStack/
├── package.json               # Node.js dependencies & scripts
├── README.md                  # Comprehensive platform documentation
├── app.js                     # Root entrypoint with ESM loader
├── alphastack.zip             # Standalone production deployment package
├── inai-deploy.zip            # Mirrored deployment bundle
├── phonemail-deploy.zip       # Mirrored deployment bundle
├── src/
│   ├── server.js              # Express app, HTTP routes & WebSocket setup
│   ├── config.js              # Environment settings & credentials
│   ├── database/
│   │   ├── db.js              # MySQL / SQLite dual-mode connection & query pool
│   │   └── schema.sql         # Database schema (emails, users, conversations, blocked)
│   ├── routes/
│   │   ├── authRoutes.js      # Phone verification, OTP validation & profile registration
│   │   └── emailRoutes.js     # Email CRUD, conversations, drafts, bulk, spam & security status
│   ├── services/
│   │   ├── cryptoService.js   # AES-256-GCM payload encryption, decryption & SHA-256 stamps
│   │   ├── emailService.js    # Inbound/outbound email pipelines with encryption hooks
│   │   ├── imapSyncService.js # Live IMAP sync from Hostinger mail servers
│   │   ├── notificationService.js # 4-hour unread delayed SMS scheduler
│   │   └── textbeeService.js  # Live Android SMS gateway integration
│   ├── smtp/
│   │   └── smtpServer.js      # Local SMTP server & MIME parser
│   └── public/
│       ├── desktop/           # Desktop WebApp (INAI Gmail-grade client)
│       │   ├── index.html
│       │   ├── style.css
│       │   └── app.js
│       └── mobile/            # Mobile WebApp (INAI Messenger & traditional client)
│           ├── index.html
│           ├── style.css
│           └── app.js
```

---

## 📋 Hackathon Requirements & Compliance Matrix

- [x] **Phone number as primary email address** (`9876543210@alphastack.wwisvnr.com`)
- [x] **Zero-Domain Addressing** (10-digit number composition without forcing `@` input)
- [x] **Rebranded to INAI** (Unified national identity with Indian Tricolor theme)
- [x] **AES-256-GCM Payload Encryption at Rest** (Zero-knowledge encrypted storage in MySQL/SQLite)
- [x] **TLS 1.3 Transport Security & SHA-256 Fingerprinting** (End-to-end cryptographic verification)
- [x] **Messenger View (Spike / WhatsApp style)** (Conversational chat timeline with delivery checkmarks)
- [x] **Continuous Background Sync** (5s polling interval + WebSocket push broadcasts)
- [x] **Auto-Contact Discovery & Verification** (Automatic indexing of phone numbers into verified network)
- [x] **4-Hour Delayed Unread SMS Reminders** (Automated alerts via TextBee SMS Gateway)
- [x] **Spam Reporting & Sender Blocking** (Persistent blacklist and auto-routing to Spam)
- [x] **Full Drafts Engine** (Encrypted draft storage, count badges, and compose dock restoration)
- [x] **Instant Outbound Dispatch (< 20ms)** (Non-blocking external SMTP transmission)
- [x] **WhatsApp-Grade Voice Mail & AI Transcription** (Waveform scrubber, speed controls, transcript)
- [x] **Luxury Digital ID Card with Dynamic QR** (Official luxury smart card with scan-to-mail QR)
- [x] **Real-Time Multilingual Translation** (4 languages + reading pane AI translation)
- [x] **Interactive Toll-Free Voice IVR** (Dial-in voice readout of unread emails via Amazon Polly)
- [x] **Hostinger Cloud Deployment** (Live on `alphastack.wwisvnr.com` with pre-built deployment zips)

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
