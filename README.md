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

## 🌾 Rural & Elderly Accessibility ("The Zero-Domain Experience")

In rural communities and for elderly citizens, typing `@` symbols, remembering `.com` spellings, and reading complex email threads is intimidating. PhoneMail solves this with **4 accessibility breakthroughs**:

* 🚫 **No `@` Symbol Needed (Just 10 Digits):**  
  Just like **WhatsApp** and **UPI Numbers (PhonePe/Google Pay)**, users **never type an email domain** inside the app. To send an email, they simply type the **10-digit phone number** or select from their contacts. The system handles the internet email routing invisibly.
* 🎙️ **IVR Voice-Mailbox (Dial & Listen):**  
  If an elderly or illiterate user receives an email, they don't have to read it. They simply dial the toll-free number and press **`2`**:
  > *"Namaste! You have 1 new email from Govt Scheme Office. Press 1 to listen."*  
  The IVR reads the email out loud in their local language using Text-to-Speech!
* 🪪 **Digital PhoneMail ID Card (QR Code):**  
  From their profile, users can view or print a simple **Digital ID Card** containing their photo, 10-digit number, and a scannable QR code. Government officers, banks, and hospitals can scan it to email them instantly without spelling errors.
* 🗣️ **Vernacular Language Support:**  
  The mobile onboarding begins with **Language Selection** (English, Hindi, Tamil, Telugu, etc.), ensuring the entire interface speaks the user's mother tongue.

---

## 👥 Multiple Email IDs on 1 Phone Number (Family & Privacy Aliases)

> *Hackathon Requirement: "A profile icon in the top-right providing access to account settings. Manage Alias IDs, language, personal details..."*

What if one user wants separate personal and work emails? Or what if **an entire rural household shares a single smartphone**? PhoneMail solves this seamlessly:

### 1. Simple Number Extensions (The UPI / Sub-Number Model)
Users can append a simple dot or hyphen followed by a digit or tag:
* **Primary Email:** `9876543210@phonemail.com`
* **Sub-ID 1 (Personal/Govt):** `9876543210.1@phonemail.com`
* **Sub-ID 2 (Shopping/OTPs):** `9876543210.2@phonemail.com`
* **Work Email:** `9876543210.work@phonemail.com`

*For village elders:* They don't need to remember words. They just say: *"My number with a .1 at the end."*

### 2. Multi-Profile "Family Inboxes" (The Netflix Model)
In households where parents and children share 1 phone:
* Inside settings, tap **`[ + Add Profile ]`**:
  * 👨 **Father (Ramesh):** `9876543210.ramesh@phonemail.com`
  * 👩 **Mother (Sunita):** `9876543210.sunita@phonemail.com`
  * 🎓 **Son (Rahul - Student):** `9876543210.rahul@phonemail.com`
* Inside the app, users switch between profiles with a single tap at the top. Rahul's college emails go to Rahul's tab, and the father's agricultural subsidies go to the father's tab.

### 3. Claim a Professional Handle
Users can claim a custom name linked to their phone number (e.g., `soumith@phonemail.com` $\rightarrow$ links to `9876543210`). Both IDs deliver to the same inbox.

### 4. Disposable "Spam-Shield" Aliases
Generate temporary addresses for discounts and shopping (e.g. `9876543210.shop@phonemail.com`). A simple **ON / OFF switch** in settings lets users block spam with 1 tap.

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

## 🚀 Quickstart: Run in 3 Steps

You can run PhoneMail directly with **Node.js** or with **Docker** (optional):

### Option A: Run with Node.js (Recommended & Fastest)
```bash
# 1. Clone the repository
git clone https://github.com/soumith-64/AlphaStack.git
cd AlphaStack

# 2. Configure environment
cp .env.example .env

# 3. Install dependencies & start
npm install
npm start
```

### Option B: Run with Docker (Optional)
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
- [x] **Zero-Domain Addressing** (10-digit number composition without `@` symbol)
- [x] **IVR Account Creation** (Press '1' on voice call to create account)
- [x] **IVR Audio Mailbox** (Press '2' to listen to unread emails aloud via Text-to-Speech)
- [x] **SMS Account Creation** (Text number to create account)
- [x] **2-Field Web Registration Portal** (Phone + OTP, auto-resets on submit)
- [x] **Targeted SMS Notifications** (Only sent to non-mobile app users)
- [x] **Manage Alias IDs & Extensions** (Sub-numbers `.1`, `.2`, family profiles & custom handles)
- [x] **Mobile WhatsApp Design** (4-screen onboarding + device permission flow)
- [x] **Mobile Spike Mail Inbox** (Chats, compact subject, single-reply, expander, locked To field)
- [x] **Desktop Gmail Design** (Sidebar folders, search bar, list view, reading pane)
- [x] **Dockerized** (`docker compose up -d` single command startup)

---

## 📄 License
Open source and released under the [MIT License](LICENSE).
