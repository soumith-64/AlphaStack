# 🇮🇳 INAI — Unified Phone-to-Email WebApp

[![Live Demo](https://img.shields.io/badge/Live%20Demo-alphastack.wwisvnr.com-046A38?style=for-the-badge&logo=googlechrome&logoColor=white)](https://alphastack.wwisvnr.com/)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-soumithjv%2Finai--alphastack-0db7ed?style=for-the-badge&logo=docker&logoColor=white)](https://hub.docker.com/r/soumithjv/inai-alphastack)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM%20%7C%20TLS%201.3-FF671F?style=for-the-badge&logo=shield&logoColor=white)](https://alphastack.wwisvnr.com/api/security/status)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B%20%2F%2020%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

> 🚀 **Built for the AlphaStack Hackathon 2026**  
> Imagine an email ecosystem where nobody needs to remember, spell, or register cryptic email handles like `john.doe1992@gmail.com`.  
> What if your email was simply your **10-digit mobile number**: **`9876543210@alphastack.wwisvnr.com`**?  
> **INAI (Instant Network AI)** makes this a reality — an ultra-modern, zero-delay phone-powered email platform featuring **AES-256-GCM payload encryption at rest**, **Spike/WhatsApp-style Messenger view**, **real-time WebSocket synchronization**, **automatic contact discovery**, **TextBee live SMS alerts for unread emails**, and **national Tiranga aesthetics**.

---

## 🌐 Live Access & Demo Links

| Resource | URL | Description |
| :--- | :--- | :--- |
| 🌐 **Live WebApp (Auto-detects Mobile/Desktop)** | [https://alphastack.wwisvnr.com](https://alphastack.wwisvnr.com) | Production application URL with clean routing |
| 📱 **Mobile WebApp (Messenger View)** | [https://alphastack.wwisvnr.com/mobile/](https://alphastack.wwisvnr.com/mobile/) | Spike/WhatsApp-style chat email interface |
| 💻 **Desktop Webmail (Full Client)** | [https://alphastack.wwisvnr.com/desktop/](https://alphastack.wwisvnr.com/desktop/) | 3-pane enterprise Gmail/Outlook-grade client |
| 🛡️ **Live Cryptographic Security Proof** | [https://alphastack.wwisvnr.com/api/security/status](https://alphastack.wwisvnr.com/api/security/status) | Real-time JSON verification of AES-256-GCM status |
| 🐳 **Docker Hub Public Repository** | [soumithjv/inai-alphastack](https://hub.docker.com/r/soumithjv/inai-alphastack) | Pre-built production Docker container image |

---

## ⚡ Key Highlights & Core Innovations

1. **📱 Phone Number IS Your Email Address:**  
   Your email ID is automatically mapped to your mobile number (`+91 93815 64959` $\rightarrow$ `9381564959@alphastack.wwisvnr.com`). Sending an email to any 10-digit phone number delivers it straight to that user's inbox with zero setup.
2. **🔐 Enterprise-Grade Cryptographic Architecture (AES-256-GCM & TLS 1.3):**  
   - **At-Rest Zero-Knowledge Encryption:** Message bodies (`body_text` & `body_html`) are encrypted with authenticated **AES-256-GCM** using unique 96-bit random IVs and 128-bit authentication tags before touching storage (`enc:v1:<iv>:<tag>:<ciphertext>`).
   - **In-Transit Security:** Full **TLS 1.3 / HTTPS** for clients, **Port 465 SSL/TLS** for Hostinger outbound SMTP, and **Port 993 SSL/TLS** for Hostinger inbound IMAP.
   - **Digital Verification Fingerprint:** Every message receives a tamper-proof SHA-256 integrity stamp (e.g., `INAI-874B-ACCD-9B66`).
   - **Public Security Proof:** Live cryptographic verification endpoint at `GET /api/security/status`.
3. **💬 Messenger View (WhatsApp / Spike Mail Experience):**  
   - Seamlessly converts traditional formal emails into conversational chat threads grouped by contact.
   - Features speech bubbles, double checkmarks (`✓✓` delivered/read status), inline image preview thumbnails, quoted reply chips, and swipe-right-to-reply mobile touch gestures.
   - One-tap switch between **Messenger View** and **Traditional Email View** on mobile and desktop.
4. **👥 Automatic Contact Discovery & Instant Autocomplete:**  
   - Sending an email to any new number automatically registers and saves it as a contact in the database.
   - When typing the number or name in the compose "To" field (desktop or mobile), a rich contact card dropdown appears with formatted phone number (`+91 XXXXX XXXXX`), avatar initials, email, and verified member badge.
5. **⏰ 4-5+ Hour Unread Delayed SMS Notifications (TextBee Gateway):**  
   - A background worker (`checkDelayedUnreadEmails`) continuously scans for unviewed emails.
   - If an email remains unread for **4 to 5 or more hours**, a subject-only SMS reminder is automatically dispatched to the recipient's phone via the **TextBee SMS Gateway**, ensuring critical messages are never missed.
   - Strict deduplication ensures each unread message triggers **at most one** SMS notification.
6. **🔄 Continuous Live Email Sync (5s Polling & WebSockets):**  
   Continuous background polling combined with instant Socket.IO push broadcasts (`email:new`, `email:sent`, `email:incoming`) ensures new emails and badges update instantly without manual page reloads.
7. **🎙️ Voice Mails with Waveform Player & AI Transcription:**  
   Record and send audio voice notes directly inside emails. Includes animated waveform scrubbing, playback speed toggles (`1x`, `1.5x`, `2x`), and instant AI transcription text.
8. **🪪 Luxury Digital ID Card with 3D Flip & QR Code:**  
   Official smart identity card with a holographic EMV chip, 3D flip animation, verified `AES-256-GCM / SHA-256` security badge, dynamic `mailto:` QR code, and 1-click image download.
9. **🌐 Real-Time Multilingual Translation:**  
   Translate the entire UI and incoming email bodies on the fly across **English, हिन्दी (Hindi), தமிழ் (Tamil), and తెలుగు (Telugu)**.
10. **🚫 One-Click Sender Blocking & Spam Reporting:**  
    Users can block spam senders directly from the desktop reading pane, bulk selection bar, or mobile chat menu. Blocked senders are tracked in `blocked_senders` and automatically routed to the Spam folder.
11. **📝 Drafts Management Engine:**  
    Fully functional drafts pipeline (`POST /api/emails/draft` & `DELETE /api/emails/draft/:id`). Auto-saves message drafts with AES-256 encryption, provides live draft count badges, and lets users resume drafting directly in the compose dock.
12. **🚀 Instant Outbound Dispatch (< 20ms Response):**  
    Outbound email submissions save and return immediately with instant WebSocket delivery to internal users, while external SMTP transmission to Gmail/Outlook runs asynchronously in the background.

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
| **Backward Compatibility** | Unencrypted legacy database records pass through safely |
| **Public Status API** | `GET /api/security/status` |

---

## 🛠️ Technology Stack

| Layer | Technologies Used | Purpose |
| :--- | :--- | :--- |
| **Backend Core** | **Node.js 18+ / 20+**, **Express.js (ESM)** | High-throughput REST API, session management & routing |
| **Containerization** | **Docker**, **Docker Compose** | Multi-platform production deployment with automatic health checks |
| **Cryptography** | **Node.js `crypto` (`aes-256-gcm`)** | Zero-knowledge authenticated payload encryption & SHA-256 stamps |
| **Real-Time Engine** | **Socket.io** | Sub-millisecond push delivery for inbound and outbound messages |
| **Database** | **MySQL 8.0** (Hostinger Cloud) / **SQLite (WAL Mode)** | Dual-mode persistence with automatic failover and migrations |
| **SMTP Delivery** | **Nodemailer**, **Hostinger SMTP (Port 465 SSL)** | Outbound delivery to Gmail, Outlook, Yahoo, and corporate domains |
| **IMAP Sync** | **Raw TLS Sockets**, **mailparser** | Inbound polling directly from Hostinger IMAP mailboxes |
| **SMS Gateway** | **TextBee Android SMS Gateway** | 4-5+ Hour delayed unread email alerts via live SMS |
| **Authentication** | **Phone.Email SDK**, **Direct OTP** | SMS & WhatsApp one-tap authentication + 6-cell Telegram OTP auto-submit |
| **Translation Engine** | **Google Neural API + Fallback Dictionaries** | Real-time multilingual translation for Indian regional languages |
| **Styling & UI** | **Vanilla CSS (Tiranga Tokens)** | Zero bloated frameworks, 60fps animations, Daylight & Midnight themes |

---

## 🐳 Quickstart with Docker (Recommended)

### Option 1: Run Pre-Built Image from Docker Hub (1 Command)
```bash
docker run -d -p 3000:3000 --name inai-app soumithjv/inai-alphastack:latest
```
Access the application at your domain or server URL (Live demo: **[https://alphastack.wwisvnr.com](https://alphastack.wwisvnr.com)**).

### Option 2: Run with Docker Compose
```bash
# Clone the repository
git clone https://github.com/soumith-64/AlphaStack.git
cd AlphaStack

# Start with Docker Compose
docker compose up -d
```

### Docker Management Commands:
```bash
# Stream live logs
npm run docker:logs
# or: docker compose logs -f

# Check container health status
docker compose ps

# Stop the container
npm run docker:down
# or: docker compose down
```

---

## 💻 Local Setup (Without Docker)

### Prerequisites
- Node.js 18.x or 20.x
- npm 9+

### 1. Clone & Install:
```bash
git clone https://github.com/soumith-64/AlphaStack.git
cd AlphaStack
npm install
```

### 2. Configure Environment:
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configuration variables in `.env`:
```env
# Server
PORT=3000
HOST=0.0.0.0
DOMAIN_NAME=alphastack.wwisvnr.com
JWT_SECRET=your_jwt_secret_key_here

# Database (Leave empty for zero-setup built-in SQLite)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password

# Phone.Email Verification
PHONE_EMAIL_CLIENT_ID=your_phone_email_client_id

# TextBee Live SMS Gateway
TEXTBEE_DEVICE_ID=your_textbee_device_id
TEXTBEE_API_KEY=your_textbee_api_key

NODE_ENV=production
```

### 3. Start Application:
```bash
npm start
```
The server will bind to port 3000 (Production domain: **https://alphastack.wwisvnr.com**).

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

## 📂 Project Directory Structure

```
AlphaStack/
├── Dockerfile                 # Production Docker build configuration (Node 20 Alpine)
├── docker-compose.yml         # Container orchestration specification
├── .dockerignore              # Exclusions for container build efficiency
├── package.json               # Node.js dependencies & scripts
├── README.md                  # Comprehensive platform documentation
├── app.js                     # Root entrypoint with ESM loader
├── loader.cjs                 # CommonJS bootstrap for cPanel Passenger
├── .env.example               # Environment template
│
└── src/
    ├── server.js              # Express app, HTTP routes & WebSocket setup
    ├── config.js              # Environment settings & credentials
    ├── database/
    │   ├── db.js              # MySQL / SQLite dual-mode connection & query pool
    │   └── schema.sql         # Database schema (emails, users, conversations, blocked)
    ├── routes/
    │   ├── authRoutes.js      # Phone verification, OTP validation & profile registration
    │   └── emailRoutes.js     # Email CRUD, conversations, drafts, bulk, spam & security status
    ├── services/
    │   ├── cryptoService.js   # AES-256-GCM payload encryption, decryption & SHA-256 stamps
    │   ├── emailService.js    # Inbound/outbound email pipelines with encryption hooks
    │   ├── imapSyncService.js # Live IMAP sync from Hostinger mail servers
    │   ├── notificationService.js # 4-5 hour unread delayed SMS scheduler
    │   └── textbeeService.js  # Live Android SMS gateway integration
    ├── smtp/
    │   └── smtpServer.js      # Local SMTP server & MIME parser
    └── public/
        ├── desktop/           # Desktop WebApp (INAI Gmail-grade client)
        │   ├── index.html
        │   ├── style.css
        │   └── app.js
        └── mobile/            # Mobile WebApp (INAI Messenger & traditional client)
            ├── index.html
            ├── style.css
            └── app.js
```

---

## 📄 License
This project is open-source under the **MIT License**. Built with ❤️ for the **AlphaStack Hackathon 2026**.
