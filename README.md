# 📱 PhoneMail — Your Phone Number is Your Email Address

[![Docker](https://img.shields.io/badge/Docker-compose%20up%20--d-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Twilio](https://img.shields.io/badge/Twilio-Voice%20IVR%20%26%20SMS-F22F46?logo=twilio&logoColor=white)](https://www.twilio.com/)
[![SMTP](https://img.shields.io/badge/SMTP-Self--Hosted-0052CC)](https://github.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 🚀 **Built for the AlphaStack 7-Day Buildathon**  
> Imagine if you didn't need to create complicated email addresses like `john.doe1992@gmail.com`.  
> What if your email was simply your phone number: **`9876543210@phonemail.com`**?  
> **PhoneMail makes this real** — with zero paid third-party tools, running completely on **1 domain + 1 hosting server** via Docker.

---

## 🎯 What is PhoneMail? (In 60 Seconds)

PhoneMail connects traditional phone lines (voice calls and SMS) with modern email:

1. **Your Email ID:** Your phone number (e.g. `9876543210@phonemail.com`).
2. **Anyone Can Email You:** Anyone from Gmail, Outlook, or Yahoo can send an email to your phone number.
3. **Smart Inbox on Mobile:** Looks and feels just like **WhatsApp**, turning emails from each person into a chat conversation (inspired by **Spike Mail**).
4. **Power Inbox on Desktop:** Looks and feels just like **Gmail** for power users.
5. **No Smartphone? No Problem:** If you sign up by phone or kiosk, you receive an **instant SMS text** whenever someone emails you:  
   > *"You have received an email from boss@company.com. Subject: Meeting update."*
6. **100% Free & Self-Hosted:** No SendGrid, no Mailgun, and no monthly fees. Includes an internal SMTP mail server in Docker.

---

## 🖼️ How It Works (Visual Flow)

```
                    ┌───────────────────────────────┐
                    │ External Sender (e.g. Gmail)  │
                    │ sends email to:               │
                    │ 9876543210@phonemail.com      │
                    └───────────────┬───────────────┘
                                    │ (via Internet SMTP)
                                    ▼
                    ┌───────────────────────────────┐
                    │    PhoneMail Local Server     │
                    │  (Catches & Parses Email)     │
                    └───────┬───────────────┬───────┘
                            │               │
        Has Mobile App?     │               │ No Mobile App?
       (Smartphone User)    │               │ (Basic Phone / Kiosk)
                            ▼               ▼
               ┌──────────────────────┐  ┌──────────────────────┐
               │ 📱 Mobile Web App    │  │ 💬 Instant SMS Alert │
               │ Real-time Chat Inbox │  │ "New email from X:   │
               │ (WhatsApp + Spike)   │  │  Subject: Y"         │
               └──────────────────────┘  └──────────────────────┘
```

---

## ⚡ 4 Easy Ways to Create an Account

You can register an email account in under 10 seconds:

| Method | How it works | Who it's for |
| :--- | :--- | :--- |
| **📞 1. Toll-Free Phone Call (IVR)** | Call the number and press **`1`** on your keypad. Your account is created instantly using your Caller ID. | Anyone with a landline or feature phone |
| **💬 2. Send an SMS** | Send any text (like `REGISTER`) to the phone number. | Quick signup without internet |
| **🌐 3. 2-Field Web Portal** | Visit `/portal`, enter your Phone Number + OTP, click Submit. The form resets automatically for the next user. | Registration kiosks, schools, or offices |
| **📱 4. Web & Mobile App** | Open the website or mobile link, enter phone number, verify OTP. | Smartphone & desktop users |

---

## 🎨 Two Beautiful Interfaces

### 📱 1. Mobile Experience (WhatsApp + Spike Mail)
* **Onboarding (WhatsApp Style):**
  * **Screen 1:** Language Selection (English, Spanish, Hindi, etc.)
  * **Screen 2:** Terms & Conditions with WhatsApp green buttons
  * **Screen 3:** Phone verification (auto-detects SIM number)
  * **Screen 4:** 6-digit OTP verification (auto-detects and auto-verifies)
* **Inbox (Spike Mail Style):**
  * **No separate Inbox or Sent:** All emails from the same person are grouped into a continuous chat.
  * **Filter Chips:** Tap `All`, `Unread`, `Attachments`, or `Favorites`.
  * **Compact Subject:** Displayed neatly above the chat bubble.
  * **Swipe Right:** Swipe any message bubble to reply directly to it.
  * **Group Chats:** Selecting 2 or more people in Compose automatically starts a group conversation.
  * **Manage Aliases:** Create aliases like `9876543210-work@phonemail.com` from your profile.

---

### 💻 2. Desktop Experience (Gmail Style)
* **Clean Login:** A single minimalist card with Phone + OTP + Terms of Service link.
* **Familiar Gmail Layout:**
  * Left sidebar with a large **"+ Compose"** button, Inbox (with unread count), Sent, Drafts, Spam, and Trash.
  * Search bar across the top.
  * Email list with checkboxes, stars, sender name, and subject preview.
  * Side-by-side Reading Pane with quick Reply / Forward buttons.
  * Profile settings to manage your PhoneMail Aliases.

---

## 🚀 Quickstart: Run with Docker in 3 Steps

Everything is packaged into a single container. You only need **Docker** installed.

### Step 1: Clone the Repo
```bash
git clone https://github.com/soumith-64/AlphaStack.git
cd AlphaStack
```

### Step 2: Set Your Domain
Copy the example config:
```bash
cp .env.example .env
```
*(By default, it is pre-configured to work out of the box with zero setup).*

### Step 3: Start the App
```bash
docker compose up -d
```

🎉 **That's it!** Open your browser:
* 📱 **Mobile Interface (WhatsApp + Spike):** [http://localhost:3000/mobile](http://localhost:3000/mobile)
* 💻 **Desktop Interface (Gmail):** [http://localhost:3000/desktop](http://localhost:3000/desktop)
* 🌐 **2-Field Registration Kiosk:** [http://localhost:3000/portal](http://localhost:3000/portal)
* 🧪 **Judge Testing Lab & Live Simulator:** [http://localhost:3000/simulator](http://localhost:3000/simulator)

---

## 🧪 How Judges Can Test in 2 Minutes (Zero Telephony Cost)

We built an interactive **Testing Lab** right into the app at **`/simulator`** so judges and evaluators don't need a Twilio account or phone balance to test:

1. **Test the IVR Phone Call:**
   - Open `/simulator`.
   - Click **"Simulate Inbound Call"**.
   - Listen/read the prompt: *"Press 1 to create your PhoneMail account"*.
   - Tap keypad **`1`** $\rightarrow$ Account is created instantly!
2. **Test Inbound Email & SMS Notification:**
   - On the simulator screen, send a test email to `9876543210@phonemail.com`.
   - Look at the **Live SMS Audit Log** at the bottom of the screen.
   - You will immediately see:
     ```
     [OUTGOING SMS] To: 9876543210
     "You have received an email from test@gmail.com. Subject: Project Update."
     ```
3. **Verify the Inbox:**
   - Log into `/desktop` or `/mobile` with `9876543210` and see the email waiting in real time!

---

## 🌐 How to Connect Your Domain & Hosting Server

If you want to receive real emails from actual Gmail or Outlook users:

### Add these DNS records to your Domain Registrar:
| Type | Name / Host | Value / Points To | Priority | Why it's needed |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `@` | `YOUR_SERVER_IP` | — | Directs website visitors to your app |
| **A** | `mail` | `YOUR_SERVER_IP` | — | Address of your mail server |
| **MX** | `@` | `mail.yourdomain.com` | `10` | Tells Gmail/Outlook where to send emails |
| **TXT** | `@` | `v=spf1 mx ip4:YOUR_SERVER_IP ~all` | — | Prevents spam filters from blocking mail |

---

## 📂 Project Architecture

```
AlphaStack/
├── docker-compose.yml     # Starts entire stack with 1 command
├── Dockerfile             # Multi-stage container build
├── README.md              # Clear project documentation
├── HACKATHON_ANALYSIS.md  # Deep technical spec & compliance sheet
├── src/
│   ├── server.js          # Main web & WebSocket server
│   ├── smtp/              # Built-in local SMTP mail server (Port 25)
│   ├── services/          # Telephony, SMS, and notification logic
│   ├── database/          # SQLite database (zero config, super fast)
│   ├── routes/            # REST API & Twilio webhooks
│   └── public/            # Frontend interfaces
│       ├── mobile/        # WhatsApp onboarding + Spike Mail UI
│       ├── desktop/       # Gmail desktop UI
│       ├── portal/        # 2-Field Registration Kiosk
│       └── simulator/     # Judge Testing Lab & SMS Viewer
```

---

## 📋 Hackathon Checklist

- [x] **Phone number as email address** (e.g. `9876543210@phonemail.com`)
- [x] **IVR Account Creation** (Press '1' on voice call to create account)
- [x] **SMS Account Creation** (Text number to create account)
- [x] **2-Field Web Registration Portal** (Phone + OTP, auto-resets on submit)
- [x] **Targeted SMS Notifications** (Only sent to non-mobile app users)
- [x] **Mobile WhatsApp Design** (4-screen onboarding + device permission flow)
- [x] **Mobile Spike Mail Inbox** (Chats, compact subject, single-reply, expander, locked To field)
- [x] **Desktop Gmail Design** (Sidebar folders, search bar, list view, reading pane)
- [x] **Dockerized** (`docker compose up -d` single command startup)

---

## 📄 License
Open source and released under the [MIT License](LICENSE).
