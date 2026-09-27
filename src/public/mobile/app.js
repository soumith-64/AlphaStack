// ==================== INAI MOBILE WEBAPP CORE CONTROLLER ====================
// Real-time Phone-to-Email Platform for Bharat
// =========================================================================

// ==================== GLOBAL STATE ====================
let currentUser = null;
let pendingPhone = '';
let currentFolder = 'ALL'; // Default to All Mail as requested
let allEmails = [];
let selectedEmailIds = new Set();
let emailFolderCache = {};
let activeEmail = null;
let currentLanguage = localStorage.getItem('inai_lang') || 'en';
let isMessageTranslated = false;
let originalMessageSubject = '';
let originalMessageBody = '';
let socket = null;
let activeSourceFilter = 'all'; // 'all' | 'phonemail' | 'external'
let activeQuickFilter = 'all'; // 'all' | 'unread' | 'attachments' | 'favorites'
let searchTerm = '';
let cachedContacts = [];
let allConversations = [];
let activeConversation = null;
let activeConversationId = null;
let activeReplyingMessage = null;
let activeContactForModal = null;
let activeContactModalIsSelf = true;
let activeTradEmail = null;
let mobileInboxMode = localStorage.getItem('mobile_inbox_mode') || 'messenger'; // 'messenger' | 'traditional'
let activeCustomAvatarDataUrl = '';

// Date Filter State
let activeDateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
let customDateStart = '';
let customDateEnd = '';

// Smart Translation Draft Preview State
let smartDraftTranslation = null;

// ==================== PERSISTENCE & FORMATTING HELPERS ====================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getInitials(name) {
  if (!name) return 'IN';
  let clean = String(name).replace(/^(?:To|From):\s*/i, '');
  const bracketIdx = clean.indexOf('(');
  if (bracketIdx > 0) {
    clean = clean.substring(0, bracketIdx).trim();
  }
  clean = clean.replace(/<[^>]*>/g, '').replace(/[()]/g, '').trim();
  const words = clean.split(/\s+/).filter(w => /^[a-zA-Z0-9]/.test(w));
  if (words.length >= 2) {
    const first = (words[0].match(/[a-zA-Z0-9]/) || [''])[0];
    const second = (words[1].match(/[a-zA-Z0-9]/) || [''])[0];
    if (first && second) return (first + second).toUpperCase();
  }
  if (words.length === 1 && words[0].length >= 2) {
    const alpha = words[0].replace(/[^a-zA-Z0-9]/g, '');
    if (alpha.length >= 2 && /^[a-zA-Z]+$/.test(alpha)) {
      return (alpha[0] + alpha[1]).toUpperCase();
    }
  }
  const letterMatch = clean.match(/[a-zA-Z]/);
  if (letterMatch) return letterMatch[0].toUpperCase();
  const digits = clean.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  return 'IN';
}

/**
 * Dynamic deterministic default profile picture generator
 * Generates vibrant SVG avatar with gradient background and crisp monogram
 */
function generateDefaultAvatar(seed, displayName = '') {
  const str = String(displayName || seed || 'User').trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const gradients = [
    ['#059669', '#10B981'], // Bharat Green
    ['#EA580C', '#F59E0B'], // Kesari Saffron Amber
    ['#2563EB', '#38BDF8'], // Ocean Sapphire Blue
    ['#7C3AED', '#C084FC'], // Royal Purple
    ['#DB2777', '#F472B6'], // Vivid Rose
    ['#0D9488', '#2DD4BF'], // Teal Aurora
    ['#DC2626', '#FB7185'], // Crimson Flame
    ['#4F46E5', '#818CF8']  // Indigo Twilight
  ];
  
  const pair = gradients[Math.abs(hash) % gradients.length];
  const initial = getInitials(str);
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="g_${Math.abs(hash)}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${pair[0]}"/>
        <stop offset="100%" stop-color="${pair[1]}"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="50" fill="url(#g_${Math.abs(hash)})"/>
    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
    <text x="50" y="52" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="42" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initial}</text>
  </svg>`;

  try {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  } catch (e) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
}

/**
 * Returns best available avatar: custom photo -> external/Gmail auto-fetch -> deterministic initials SVG
 */
function getAvatarUrl(rawIdentifier, displayName = '', customAvatar = null) {
  if (customAvatar) return customAvatar;
  
  const cleanId = extractCleanParticipant(rawIdentifier || '');
  
  // Check cached contacts
  if (cleanId && typeof cachedContacts !== 'undefined' && Array.isArray(cachedContacts)) {
    const contact = cachedContacts.find(c => {
      if (c && c.avatar_url) {
        if (c.phone && cleanId.includes(c.phone)) return true;
        if (c.email && c.email.toLowerCase() === cleanId.toLowerCase()) return true;
      }
      return false;
    });
    if (contact && contact.avatar_url) return contact.avatar_url;
  }

  // If email address (e.g. @gmail.com, etc.), auto-fetch from unavatar.io
  if (cleanId.includes('@')) {
    return `https://unavatar.io/${encodeURIComponent(cleanId)}?fallback=false`;
  }

  return generateDefaultAvatar(cleanId || displayName, displayName || cleanId);
}

function formatPhoneDisplay(digits, tag = '') {
  const p = String(digits).replace(/\D/g, '').slice(-10);
  if (p.length === 10) {
    const formatted = `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
    return tag ? `${formatted} (.${tag})` : formatted;
  }
  return digits;
}

function isPhoneMailSender(rawSender) {
  if (!rawSender) return false;
  const str = String(rawSender).toLowerCase();
  if (
    str.includes('@gmail.com') ||
    str.includes('@rediff') ||
    str.includes('@yahoo.') ||
    str.includes('@outlook.') ||
    str.includes('@hotmail.') ||
    str.includes('@icloud.') ||
    str.includes('@zoho.') ||
    str.includes('@proton.') ||
    str.includes('@aol.')
  ) {
    return false;
  }
  if (
    str.includes('@alphastack.wwisvnr.com') ||
    str.includes('@phonemail.com') ||
    /\b\d{10}\b/.test(str)
  ) {
    return true;
  }
  if (str.includes('@') && !str.includes('alphastack.wwisvnr.com') && !str.includes('phonemail.com')) {
    return false;
  }
  return true;
}

function lookupContactName(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  if (!digits || digits.length !== 10) return '';
  let cachedDeviceContacts = [];
  try {
    const raw = localStorage.getItem('phonemail_cached_device_contacts');
    if (raw) cachedDeviceContacts = JSON.parse(raw);
  } catch (e) {}
  const all = [...(cachedContacts || []), ...(cachedDeviceContacts || [])];
  const found = all.find(c => {
    const cP = String(c.phone || c.phone_number || '').replace(/\D/g, '').slice(-10);
    return cP === digits;
  });
  if (found) {
    if (found.name && !/^User\s*\d+/i.test(found.name)) return found.name.trim();
    if (found.display_name && !/^User\s*\d+/i.test(found.display_name)) return found.display_name.trim();
    if (found.device_name) return found.device_name.trim();
  }

  // Check custom contact names from localStorage
  try {
    const customMap = JSON.parse(localStorage.getItem('inai_custom_contact_names') || '{}');
    if (customMap[digits]) return customMap[digits].trim();
  } catch (e) {}

  // Check cached device names
  try {
    const namesMap = JSON.parse(localStorage.getItem('phonemail_cached_device_names') || '{}');
    for (const [k, v] of Object.entries(namesMap)) {
      if (String(k).replace(/\D/g, '').slice(-10) === digits && v && !/^User\s*\d+/i.test(v)) {
        return v.trim();
      }
    }
  } catch (e) {}

  // Check allEmails heuristic
  if (typeof allEmails !== 'undefined' && Array.isArray(allEmails)) {
    for (const em of allEmails) {
      if (em.sender_name && !/^User\s*\d+/i.test(em.sender_name)) {
        const sDigits = (em.sender_email || '').replace(/\D/g, '').slice(-10);
        if (sDigits === digits) return em.sender_name.trim();
      }
      if (em.recipient_name && !/^User\s*\d+/i.test(em.recipient_name)) {
        let rList = [];
        try { rList = JSON.parse(em.recipient_emails || '[]'); } catch(_) { rList = [em.recipient_emails]; }
        if (rList.some(r => String(r).replace(/\D/g, '').slice(-10) === digits)) {
          return em.recipient_name.trim();
        }
      }
      const isTarget = (em.recipient_emails && String(em.recipient_emails).includes(digits)) ||
                       (em.sender_email && String(em.sender_email).includes(digits));
      if (isTarget && em.subject) {
        const subMatch = em.subject.match(/^(?:hi|hello|hey|dear)\s+([a-zA-Z]{2,20})\b/i);
        if (subMatch && subMatch[1]) {
          return subMatch[1].charAt(0).toUpperCase() + subMatch[1].slice(1).toLowerCase();
        }
      }
    }
  }

  return '';
}

/**
 * Cleanly format sender:
 * - If from INAI (PhoneMail user): Show Name and Phone number in brackets:
 *   e.g. "John Doe (+91 79047 75295)" or "User (+91 79047 75295)"
 * - If from external (Gmail, Rediff, etc.): Show Name and Gmail address:
 *   e.g. "John Doe (johndoe@gmail.com)" or "johndoe@gmail.com"
 */
function formatSenderDisplay(rawSender, includeAddress = false, fallbackName = '') {
  if (!rawSender) return 'Unknown';
  let str = String(rawSender).trim();
  let name = fallbackName || '';
  let email = str;
  const match = str.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  if (match) {
    if (!name) name = (match[1] || '').trim().replace(/^["']+|["']+$/g, '');
    email = (match[2] || '').trim();
  } else {
    email = str.replace(/^[<"']+|[>"']+$/g, '').trim();
  }

  const isFromInai = isPhoneMailSender(email);
  const phoneAliasMatch = email.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  const plainPhoneMatch = email.match(/^(\d{10})@/);
  const digitsOnly = email.replace(/\D/g, '').slice(-10);
  const has10Digits = digitsOnly && digitsOnly.length === 10;

  if (isFromInai && (phoneAliasMatch || plainPhoneMatch || has10Digits)) {
    const phone = phoneAliasMatch ? phoneAliasMatch[1] : (plainPhoneMatch ? plainPhoneMatch[1] : digitsOnly);
    const tag = phoneAliasMatch && phoneAliasMatch[2] ? phoneAliasMatch[2] : '';
    const phoneFormatted = formatPhoneDisplay(phone, tag);

    if (!name || /^User\s*\d+/i.test(name) || name.replace(/\D/g, '') === phone) {
      const contactName = lookupContactName(phone);
      if (contactName) {
        name = contactName;
      }
    }

    if (name && !/^User\s*\d+/i.test(name) && name.replace(/\D/g, '') !== phone) {
      name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return `${name} (${phoneFormatted})`;
    }
    return `User (${phoneFormatted})`;
  }

  if (name && name.toLowerCase() !== email.toLowerCase()) {
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${name} (${email})`;
  }

  return email;
}

function getRecipientsDisplay(email) {
  if (!email) return '';
  if (email.recipient_display) return email.recipient_display;
  if (email.recipient_name && email.recipient_phone) {
    return `${email.recipient_name} (${formatPhoneDisplay(email.recipient_phone)})`;
  }
  if (email.recipient_emails) {
    try {
      const parsed = typeof email.recipient_emails === 'string' ? JSON.parse(email.recipient_emails) : email.recipient_emails;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(r => formatSenderDisplay(r)).join(', ');
      }
    } catch (e) {
      return formatSenderDisplay(email.recipient_emails);
    }
  }
  if (email.recipient_phone) {
    const contactName = lookupContactName(email.recipient_phone);
    if (contactName) {
      return `${contactName} (${formatPhoneDisplay(email.recipient_phone)})`;
    }
    return formatPhoneDisplay(email.recipient_phone);
  }
  return '';
}

function getFolderFriendlyName(folder) {
  const map = {
    'ALL': 'All Mail',
    'INBOX': 'Inbox',
    'IMPORTANT': 'Important',
    'STARRED': 'Starred',
    'SENT': 'Sent',
    'DRAFTS': 'Drafts',
    'ARCHIVE': 'Archive',
    'SPAM': 'Spam',
    'TRASH': 'Trash'
  };
  return map[folder.toUpperCase()] || folder;
}

// ==================== NOTIFICATIONS ====================
function showToastNotification(message, type = 'info') {
  const container = document.getElementById('app-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

const showNotify = {
  success: (m) => showToastNotification(m, 'success'),
  error: (m) => showToastNotification(m, 'error'),
  warning: (m) => showToastNotification(m, 'warning'),
  info: (m) => showToastNotification(m, 'info')
};

// ==================== AUTH & SESSION RESTORATION ====================
function restoreSession() {
  // Check if Phone.Email redirected back with user_json_url in query parameters or hash
  const searchStr = window.location.search || (window.location.hash.includes('user_json_url') ? window.location.hash.replace(/^#/, '?') : '');
  const urlParams = new URLSearchParams(searchStr);
  const userJsonUrl = urlParams.get('user_json_url');
  if (userJsonUrl) {
    const btn = document.getElementById('mobile-phonemail-hero-btn');
    if (btn) {
      btn.style.opacity = '0.7';
      const subCaption = btn.querySelector('.btn-sub-caption');
      if (subCaption) subCaption.innerText = 'Verifying with Phone.Email...';
    }
    showToastNotification('Verifying your phone number with Phone.Email...', 'info');
    window.phoneEmailListener({ user_json_url: userJsonUrl });
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch(e) {}
    return;
  }

  const saved = localStorage.getItem('phonemail-mobile-user') || 
                localStorage.getItem('inai_user') || 
                localStorage.getItem('phonemail-user') ||
                sessionStorage.getItem('phonemail-mobile-user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && (user.phone || user.email)) {
        currentUser = user;
        document.documentElement.classList.add('has-saved-session');
        initAppView();
        return;
      }
    } catch (e) {}
  }
  document.documentElement.classList.remove('has-saved-session');
  // Show Onboarding
  const onb = document.getElementById('onboarding-container');
  const app = document.getElementById('app-container');
  if (onb) onb.style.display = 'flex';
  if (app) app.style.display = 'none';
  goToScreen('screen-phone');
}

function saveMobileSession(user) {
  currentUser = user;
  const remEl = document.getElementById('mob-remember-me');
  const remember = remEl ? remEl.checked : true;
  const str = JSON.stringify(user);
  if (remember) {
    localStorage.setItem('phonemail-mobile-user', str);
    localStorage.setItem('inai_user', str);
    localStorage.setItem('phonemail-user', str);
    if (user.phone) localStorage.setItem('phonemail_saved_phone', user.phone);
  }
  sessionStorage.setItem('phonemail-mobile-user', str);
  document.documentElement.classList.add('has-saved-session');
}

function initAppView() {
  document.getElementById('onboarding-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  // Update User Header Info
  const initials = getInitials(currentUser.name || 'User');
  const myFallbackSvg = generateDefaultAvatar(currentUser.phone, currentUser.name);
  const myAvatarUrl = currentUser.avatar_url || myFallbackSvg;

  const avatarEl = document.getElementById('mob-user-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(currentUser.name || 'User')}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${myFallbackSvg}';">
    `;
    avatarEl.title = `${currentUser.name || 'User'} (+91 ${currentUser.phone})`;
  }

  const drawerAvatar = document.getElementById('mob-drawer-avatar');
  if (drawerAvatar) {
    drawerAvatar.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(currentUser.name || 'User')}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${myFallbackSvg}';">
    `;
  }

  const drawerName = document.getElementById('drawer-username');
  if (drawerName) drawerName.innerText = currentUser.name || 'INAI Member';

  const drawerEmail = document.getElementById('drawer-email');
  if (drawerEmail) drawerEmail.innerText = formatPhoneDisplay(currentUser.phone);

  // Setup Socket.IO for real-time notifications
  setupSocket();

  // Apply Language
  applyInaiLanguage();

  // Update view mode controls on startup
  updateMobileViewModeControls();

  // Load All Mail with 0-delay instant caching
  loadEmails('ALL');

  // Pre-fetch contacts silently in background for instant autocomplete
  fetchContactsSilently();
}

function setupSocket() {
  try {
    if (typeof io !== 'undefined') {
      socket = io();
      socket.on('connect', () => {
        if (currentUser && currentUser.phone) {
          socket.emit('join', currentUser.phone);
        }
      });
      socket.on('email:received', (data) => {
        showToastNotification(`New email from ${formatSenderDisplay(data.sender_email)} ✉️`, 'success');
        // Invalidate current folder cache and refresh
        emailFolderCache = {};
        loadEmails(currentFolder);
      });
      socket.on('new_email', (data) => {
        showToastNotification(`New email received ✉️`, 'success');
        emailFolderCache = {};
        loadEmails(currentFolder);
      });
    }
  } catch (err) {
    console.warn('Socket.io init error:', err);
  }
}

// ==================== ONBOARDING FLOW ====================
function goToScreen(screenId) {
  document.querySelectorAll('.onboarding-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

function autoDetectMobilePhone() {
  const savedPhone = localStorage.getItem('phonemail_saved_phone');
  if (savedPhone) {
    const input = document.getElementById('mobile-phone-input');
    if (input) input.value = savedPhone.slice(-10);
    showToastNotification(`Auto-detected: +91 ${savedPhone.slice(-10)} ✓`);
    return;
  }
  showToastNotification('Please enter your 10-digit mobile number');
}

async function handleMobilePhoneSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('mobile-phone-input');
  const rawDigits = (input ? input.value : '').replace(/\D/g, '').slice(-10);
  if (rawDigits.length !== 10) {
    showToastNotification('Please enter a valid 10-digit mobile number', 'error');
    return;
  }

  pendingPhone = rawDigits;
  const dispEl = document.getElementById('mob-tg-phone-display');
  if (dispEl) dispEl.innerText = `+91 ${rawDigits.slice(0, 5)} ${rawDigits.slice(5)}`;

  goToScreen('screen-otp');
  startOtpTimer();

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pendingPhone })
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification('Verification code sent via SMS & WhatsApp! 📲', 'success');
      setupOtpInputHandlers();
    } else {
      showToastNotification(data.error || 'Failed to send OTP', 'error');
    }
  } catch (err) {
    showToastNotification('Failed to send verification code', 'error');
  }
}

function triggerPhoneEmailLogin() {
  const btn = document.getElementById('mobile-phonemail-hero-btn');
  if (btn) {
    btn.style.opacity = '0.75';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Opening Phone.Email gateway...';
  }

  const clientId = '13311688567845248231';
  // Strip any existing query parameters or hash so origin/redirect URL is clean
  const redirectUrl = window.location.href.split('?')[0].split('#')[0];
  const authUrl = `https://auth.phone.email/log-in?client_id=${clientId}&auth_type=8&origin=${encodeURIComponent(redirectUrl)}`;

  // Mobile touch devices strictly block programmatic popups in Safari & Chrome
  // Direct location navigation is 100% reliable, immune to popup blockers, and provides optimal mobile UX
  const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

  if (isMobile) {
    window.location.href = authUrl;
    return;
  }

  // Desktop or wide-screen fallback: open popup with fallback to top-level navigation
  try {
    const w = 500, h = 600;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    const popup = window.open(authUrl, 'peLoginWindow', `toolbar=0,scrollbars=1,location=0,statusbar=0,menubar=0,resizable=1,width=${w},height=${h},top=${top},left=${left}`);
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = authUrl;
    }
  } catch (err) {
    window.location.href = authUrl;
  }
}

// Window receiver for official Phone.Email SDK
window.phoneEmailListener = async function(userObj) {
  if (!userObj || !userObj.user_json_url) return;
  const user_json_url = userObj.user_json_url;
  console.log('📱 [Mobile Phone.Email Verification Success] JSON URL:', user_json_url);
  showToastNotification('Phone verified via Phone.Email! Entering mailbox...', 'info');

  const btn = document.getElementById('mobile-phonemail-hero-btn');
  if (btn) {
    btn.style.opacity = '0.7';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Creating session...';
  }

  try {
    const res = await fetch('/api/auth/phone-email-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_json_url, clientType: 'MOBILE_APP' })
    });
    const data = await res.json();
    if (res.ok && data.success && data.user) {
      saveMobileSession(data.user);
      initAppView();
      showToastNotification(`Welcome to INAI, ${data.user.name || 'User'}! 🇮🇳`, 'success');
    } else {
      if (btn) {
        btn.style.opacity = '1';
        const subCaption = btn.querySelector('.btn-sub-caption');
        if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
      }
      showToastNotification(data.error || 'Failed to authenticate phone number with Phone.Email', 'error');
    }
  } catch (err) {
    if (btn) {
      btn.style.opacity = '1';
      const subCaption = btn.querySelector('.btn-sub-caption');
      if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
    }
    showToastNotification('Authentication communication error: ' + err.message, 'error');
  }
};
// Alias for backwards compatibility
window.phoneEmailReceiver = window.phoneEmailListener;

// Universal fallback listener for popup postMessage
window.addEventListener('message', (event) => {
  if (!event || !event.data) return;
  if (event.data.user_json_url) {
    window.phoneEmailListener({ user_json_url: event.data.user_json_url });
  } else if (typeof event.data === 'string' && event.data.includes('user_json_url')) {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed && parsed.user_json_url) {
        window.phoneEmailListener({ user_json_url: parsed.user_json_url });
      }
    } catch (e) {}
  }
});

function loadPhoneEmailScript() {
  if (document.getElementById('pe-signin-script')) return;
  const script = document.createElement('script');
  script.id = 'pe-signin-script';
  script.src = 'https://www.phone.email/sign_in_button_v1.js';
  script.async = true;
  document.body.appendChild(script);
}

let otpTimerInterval = null;
function startOtpTimer() {
  let seconds = 45;
  const timerEl = document.getElementById('mob-otp-timer-seconds');
  const resendBtn = document.getElementById('mob-btn-resend-sms');
  if (resendBtn) resendBtn.disabled = true;

  if (otpTimerInterval) clearInterval(otpTimerInterval);
  otpTimerInterval = setInterval(() => {
    seconds--;
    if (timerEl) timerEl.innerText = `0:${seconds < 10 ? '0' : ''}${seconds}`;
    if (seconds <= 0) {
      clearInterval(otpTimerInterval);
      if (resendBtn) resendBtn.disabled = false;
    }
  }, 1000);
}

function resendMobileOTP() {
  if (!pendingPhone) return;
  handleMobilePhoneSubmit(null);
}

function backToPhoneStep() {
  goToScreen('screen-phone');
}

function setupOtpInputHandlers() {
  const cells = document.querySelectorAll('.telegram-otp-cell');
  cells.forEach((cell, idx) => {
    cell.value = '';
    cell.oninput = (e) => {
      const val = e.target.value.replace(/\D/g, '');
      cell.value = val ? val[0] : '';
      if (val && idx < cells.length - 1) {
        cells[idx + 1].focus();
      }
      checkAndSubmitOtp();
    };
    cell.onkeydown = (e) => {
      if (e.key === 'Backspace' && !cell.value && idx > 0) {
        cells[idx - 1].focus();
      }
    };
    cell.onpaste = (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      pasted.split('').forEach((ch, i) => {
        if (cells[i]) cells[i].value = ch;
      });
      checkAndSubmitOtp();
    };
  });
  if (cells[0]) cells[0].focus();
}

async function checkAndSubmitOtp() {
  const cells = document.querySelectorAll('.telegram-otp-cell');
  let otp = '';
  cells.forEach(c => otp += c.value);
  if (otp.length === 6) {
    const statusBanner = document.getElementById('mobile-otp-status');
    if (statusBanner) statusBanner.innerText = 'Verifying code...';

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, otp })
      });
      const data = await res.json();
      if (data.success) {
        if (data.isNewUser) {
          goToScreen('screen-profile');
        } else {
          saveMobileSession(data.user);
          initAppView();
          showToastNotification(`Welcome to INAI! 🇮🇳`, 'success');
        }
      } else {
        if (statusBanner) statusBanner.innerText = data.error || 'Invalid OTP code';
        showToastNotification(data.error || 'Invalid OTP', 'error');
        cells.forEach(c => c.value = '');
        if (cells[0]) cells[0].focus();
      }
    } catch (err) {
      if (statusBanner) statusBanner.innerText = 'Verification error';
    }
  }
}

function updateMobileAvatarPreview() {
  const fn = document.getElementById('mobile-first-name').value || 'P';
  const circle = document.getElementById('mob-profile-avatar-circle');
  if (circle) circle.innerText = fn.charAt(0).toUpperCase();
}

async function completeMobileProfile() {
  const fn = (document.getElementById('mobile-first-name').value || '').trim();
  const ln = (document.getElementById('mobile-last-name').value || '').trim();
  if (!fn) {
    showToastNotification('Please enter your first name', 'warning');
    return;
  }
  const fullName = `${fn} ${ln}`.trim();

  try {
    const res = await fetch('/api/auth/register-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pendingPhone, name: fullName })
    });
    const data = await res.json();
    if (data.success && data.user) {
      saveMobileSession(data.user);
      initAppView();
      showToastNotification(`Profile registered! Welcome to INAI.`, 'success');
    }
  } catch (err) {
    showToastNotification('Failed to save profile', 'error');
  }
}

function logoutMobile() {
  localStorage.removeItem('phonemail-mobile-user');
  localStorage.removeItem('inai_user');
  localStorage.removeItem('phonemail-user');
  sessionStorage.removeItem('phonemail-mobile-user');
  sessionStorage.removeItem('phonemail-user');
  document.documentElement.classList.remove('has-saved-session');
  currentUser = null;
  location.reload();
}

// ==================== DRAWER NAVIGATION ====================
function toggleDrawer() {
  const drawer = document.getElementById('drawer-menu');
  if (drawer) {
    drawer.classList.toggle('open');
  }
}

function closeDrawer() {
  const drawer = document.getElementById('drawer-menu');
  if (drawer) {
    drawer.classList.remove('open');
  }
}

function switchMobileFolder(folder, element) {
  document.querySelectorAll('.drawer-items .drawer-item').forEach(i => i.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  } else {
    const defaultEl = document.getElementById(`mob-nav-${folder.toLowerCase()}`);
    if (defaultEl) defaultEl.classList.add('active');
  }

  const titleEl = document.getElementById('mob-folder-title');
  if (titleEl) {
    titleEl.innerText = getFolderFriendlyName(folder);
  }

  closeDrawer();
  closeReadingPane();
  loadEmails(folder);
}

// ==================== 0-DELAY REAL-TIME EMAIL LOADING ====================
async function loadEmails(folder = currentFolder) {
  currentFolder = folder;
  clearEmailSelection();

  // 1. INSTANT 0ms RENDER FROM MEMORY CACHE
  if (emailFolderCache[folder] && Array.isArray(emailFolderCache[folder])) {
    allEmails = emailFolderCache[folder];
    renderEmailList(allEmails);
    updateFolderCounts(allEmails);
  } else {
    // Clear out previous folder's emails immediately so they never linger
    allEmails = [];
    renderEmailList([]);
    updateFolderCounts([]);
  }

  // 2. BACKGROUND FETCH TO KEEP SYNCHRONIZED
  try {
    if (!currentUser || !currentUser.phone) return;
    const res = await fetch(`/api/emails?folder=${folder}&phone=${encodeURIComponent(currentUser.phone)}`);
    const data = await res.json();
    allEmails = data.emails || [];
    emailFolderCache[folder] = allEmails;

    updateFolderCounts(allEmails);
    renderEmailList(allEmails);
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

function updateFolderCounts(emails) {
  const countAll = emails.length;
  const countPhoneMail = emails.filter(e => isPhoneMailSender(e.sender_email)).length;
  const countExternal = emails.filter(e => !isPhoneMailSender(e.sender_email)).length;

  const elAll = document.getElementById('mob-count-all');
  if (elAll) elAll.innerText = countAll;
  const elPM = document.getElementById('mob-count-phonemail');
  if (elPM) elPM.innerText = countPhoneMail;
  const elExt = document.getElementById('mob-count-external');
  if (elExt) elExt.innerText = countExternal;

  const countInd = document.getElementById('mob-count-indicator');
  if (countInd) {
    countInd.innerText = emails.length === 1 ? '1 message' : `${emails.length} messages`;
  }

  // Real-time unread badge indicator: if 0, hide completely (becomes none)
  const unreadCount = emails.filter(e => e.is_read === 0).length;
  const unreadBadge = document.getElementById('badge-unread-count');
  if (unreadBadge) {
    if (unreadCount > 0) {
      unreadBadge.innerText = unreadCount;
      unreadBadge.style.display = 'inline-flex';
    } else {
      unreadBadge.innerText = '';
      unreadBadge.style.display = 'none';
    }
  }

  const pillUnread = document.getElementById('mob-pill-unread');
  if (pillUnread) {
    pillUnread.innerText = unreadCount;
  }
}

function setMobileSourceFilter(source) {
  activeSourceFilter = source;
  ['all', 'phonemail', 'external'].forEach(s => {
    const btn = document.getElementById(`mob-source-${s}`);
    if (btn) {
      if (s === source) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderEmailList(allEmails);
}

function onSearchInput(query) {
  searchTerm = (query || '').trim().toLowerCase();
  renderEmailList(allEmails);
}

// ==================== CHECKBOX & BULK ACTIONS ====================
function updateBulkToolbar() {
  const toolbar = document.getElementById('mob-bulk-toolbar');
  const badge = document.getElementById('mob-bulk-count-badge');
  const masterCheck = document.getElementById('mob-select-all-check');
  const visibleItems = document.querySelectorAll('.email-card-item');
  const count = selectedEmailIds.size;

  if (toolbar) {
    toolbar.style.display = count > 0 ? 'flex' : 'none';
  }
  if (badge) {
    badge.innerText = `${count} selected`;
  }
  if (masterCheck) {
    if (count === 0) {
      masterCheck.checked = false;
      masterCheck.indeterminate = false;
    } else if (count === visibleItems.length && visibleItems.length > 0) {
      masterCheck.checked = true;
      masterCheck.indeterminate = false;
    } else {
      masterCheck.checked = false;
      masterCheck.indeterminate = true;
    }
  }
}

function toggleEmailSelection(id, e) {
  if (e) e.stopPropagation();
  if (selectedEmailIds.has(id)) {
    selectedEmailIds.delete(id);
  } else {
    selectedEmailIds.add(id);
  }

  const row = document.getElementById(`mob-row-${id}`);
  if (row) {
    if (selectedEmailIds.has(id)) row.classList.add('selected');
    else row.classList.remove('selected');
  }
  const chk = document.getElementById(`mob-check-${id}`);
  if (chk) {
    chk.checked = selectedEmailIds.has(id);
  }
  updateBulkToolbar();
}

function toggleSelectAll(masterEl) {
  const isChecked = masterEl ? masterEl.checked : false;
  const visibleItems = document.querySelectorAll('.email-card-item');

  if (isChecked) {
    visibleItems.forEach(item => {
      const id = item.dataset.id;
      if (id) {
        selectedEmailIds.add(id);
        item.classList.add('selected');
        const chk = document.getElementById(`mob-check-${id}`);
        if (chk) chk.checked = true;
      }
    });
  } else {
    clearEmailSelection();
  }
  updateBulkToolbar();
}

function clearEmailSelection() {
  selectedEmailIds.clear();
  document.querySelectorAll('.email-card-item').forEach(i => i.classList.remove('selected'));
  document.querySelectorAll('.row-checkbox').forEach(c => c.checked = false);
  updateBulkToolbar();
}

async function executeBulkAction(action) {
  if (selectedEmailIds.size === 0) return;
  const emailIds = Array.from(selectedEmailIds);
  const count = emailIds.length;

  // Immediate optimistic cache update
  if (action === 'read' || action === 'unread') {
    allEmails.forEach(e => {
      if (emailIds.includes(e.id)) e.is_read = action === 'read' ? 1 : 0;
    });
  } else if (action === 'star') {
    allEmails.forEach(e => {
      if (emailIds.includes(e.id)) e.is_starred = 1;
    });
  } else if (action === 'important') {
    allEmails.forEach(e => {
      if (emailIds.includes(e.id)) e.is_important = 1;
    });
  } else if (action === 'archive' || action === 'delete') {
    allEmails = allEmails.filter(e => !emailIds.includes(e.id));
  }

  if (emailFolderCache[currentFolder]) {
    emailFolderCache[currentFolder] = [...allEmails];
  }
  clearEmailSelection();
  renderEmailList(allEmails);

  showToastNotification(`Executing ${action} on ${count} email${count > 1 ? 's' : ''}...`);

  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids: emailIds, emailIds: emailIds, folder: currentFolder })
    });
    showToastNotification(`Updated ${count} message${count > 1 ? 's' : ''} ✓`, 'success');
  } catch (err) {
    console.error('Bulk action error:', err);
  }
}

async function executeBulkActionOnSingle(id, action, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids: [id], emailIds: [id], folder: currentFolder })
    });
    allEmails = allEmails.filter(e => e.id !== id);
    if (emailFolderCache[currentFolder]) {
      emailFolderCache[currentFolder] = [...allEmails];
    }
    renderEmailList(allEmails);
    showToastNotification(`Message ${action === 'archive' ? 'archived' : 'moved to trash'} ✓`, 'success');
  } catch (err) {}
}

async function executeBulkActionOnConversation(convId, action, e) {
  if (e) e.stopPropagation();
  const conv = allConversations.find(c => c.id === convId || c.key === convId);
  const ids = conv ? conv.messages.map(m => m.id) : [convId];
  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids, emailIds: ids, folder: currentFolder })
    });
    allEmails = allEmails.filter(email => !ids.includes(email.id));
    if (emailFolderCache[currentFolder]) {
      emailFolderCache[currentFolder] = [...allEmails];
    }
    renderEmailList(allEmails);
    showToastNotification(`Conversation ${action === 'archive' ? 'archived' : 'moved to trash'} ✓`, 'success');
  } catch (err) {}
}

async function toggleImportant(id, e) {
  if (e) e.stopPropagation();
  try {
    const res = await fetch(`/api/emails/${id}/important`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      allEmails.forEach(item => {
        if (item.id === id) item.is_important = data.is_important;
      });
      if (emailFolderCache[currentFolder]) {
        emailFolderCache[currentFolder] = [...allEmails];
      }
      renderEmailList(allEmails);

      if (activeEmail && activeEmail.id === id) {
        activeEmail.is_important = data.is_important;
        const impBtn = document.getElementById('mob-pane-important-btn');
        if (impBtn) {
          impBtn.style.color = data.is_important ? '#eab308' : 'var(--text-dim)';
        }
      }
      showToastNotification(data.is_important ? 'Marked as Important ⭐' : 'Unmarked Important');
    }
  } catch (err) {
    console.error('Toggle important error:', err);
  }
}

async function toggleStar(id, e) {
  if (e) e.stopPropagation();
  try {
    const res = await fetch(`/api/emails/${id}/star`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      allEmails.forEach(item => {
        if (item.id === id) item.is_starred = data.is_starred;
      });
      if (emailFolderCache[currentFolder]) {
        emailFolderCache[currentFolder] = [...allEmails];
      }
      renderEmailList(allEmails);

      if (activeEmail && activeEmail.id === id) {
        activeEmail.is_starred = data.is_starred;
        const starBtn = document.getElementById('mob-pane-star-btn');
        if (starBtn) {
          starBtn.style.color = data.is_starred ? '#f59e0b' : 'var(--text-dim)';
        }
      }
    }
  } catch (err) {}
}

/**
 * Universal Mobile Card Swipe Gesture Handler
 * Enables smooth 60fps horizontal swiping for both:
 * 1. Traditional email cards (Gmail view)
 * 2. WhatsApp conversation cards (Messenger view)
 * Swiping Right -> Reveals Star & Priority actions
 * Swiping Left  -> Reveals Archive & Delete actions
 */
function enableCardSwipeGestures(cardWrapper, surface, onOpenItem) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isSwiping = false;
  let isHorizontal = false;
  let currentTranslate = 0;
  const maxOpen = 136; // 2 action buttons * 68px width

  // Touch device events
  surface.addEventListener('touchstart', (e) => {
    // Close other swiped cards
    document.querySelectorAll('.chat-conv-surface, .traditional-email-surface').forEach(el => {
      if (el !== surface && el.dataset.swiped === 'true') {
        el.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = 'translateX(0px)';
        el.dataset.swiped = 'false';
        el.dataset.translateOffset = '0';
      }
    });

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = startX;
    currentY = startY;
    isSwiping = false;
    isHorizontal = false;
    currentTranslate = surface.dataset.swiped === 'true' ? (parseFloat(surface.dataset.translateOffset) || 0) : 0;
  }, { passive: true });

  surface.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    currentX = touch.clientX;
    currentY = touch.clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (!isSwiping) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        isSwiping = true;
        isHorizontal = true;
      } else if (Math.abs(dy) > 8) {
        isSwiping = true;
        isHorizontal = false;
      }
    }

    if (isHorizontal) {
      if (e.cancelable) e.preventDefault();
      let targetX = currentTranslate + dx;
      if (targetX > maxOpen) targetX = maxOpen + (targetX - maxOpen) * 0.2;
      if (targetX < -maxOpen) targetX = -maxOpen + (targetX + maxOpen) * 0.2;
      surface.style.transition = 'none';
      surface.style.transform = `translateX(${targetX}px)`;
    }
  }, { passive: false });

  surface.addEventListener('touchend', () => {
    if (!isHorizontal) return;
    surface.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    const totalDx = currentTranslate + (currentX - startX);
    if (totalDx > 60) {
      // Swiped right -> Reveal Star & Priority
      surface.style.transform = `translateX(${maxOpen}px)`;
      surface.dataset.swiped = 'true';
      surface.dataset.translateOffset = String(maxOpen);
    } else if (totalDx < -60) {
      // Swiped left -> Reveal Archive & Delete
      surface.style.transform = `translateX(-${maxOpen}px)`;
      surface.dataset.swiped = 'true';
      surface.dataset.translateOffset = String(-maxOpen);
    } else {
      // Snap closed
      surface.style.transform = 'translateX(0px)';
      surface.dataset.swiped = 'false';
      surface.dataset.translateOffset = '0';
    }
    isHorizontal = false;
    isSwiping = false;
  });

  // Desktop mouse drag emulation for testing & devtools
  let isMouseDown = false;
  surface.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    currentX = startX;
    currentY = startY;
    isMouseDown = true;
    isSwiping = false;
    isHorizontal = false;
    currentTranslate = surface.dataset.swiped === 'true' ? (parseFloat(surface.dataset.translateOffset) || 0) : 0;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    currentX = e.clientX;
    currentY = e.clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (!isSwiping) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        isSwiping = true;
        isHorizontal = true;
      }
    }

    if (isHorizontal) {
      let targetX = currentTranslate + dx;
      if (targetX > maxOpen) targetX = maxOpen + (targetX - maxOpen) * 0.2;
      if (targetX < -maxOpen) targetX = -maxOpen + (targetX + maxOpen) * 0.2;
      surface.style.transition = 'none';
      surface.style.transform = `translateX(${targetX}px)`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    if (isHorizontal) {
      surface.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      const totalDx = currentTranslate + (currentX - startX);
      if (totalDx > 60) {
        surface.style.transform = `translateX(${maxOpen}px)`;
        surface.dataset.swiped = 'true';
        surface.dataset.translateOffset = String(maxOpen);
      } else if (totalDx < -60) {
        surface.style.transform = `translateX(-${maxOpen}px)`;
        surface.dataset.swiped = 'true';
        surface.dataset.translateOffset = String(-maxOpen);
      } else {
        surface.style.transform = 'translateX(0px)';
        surface.dataset.swiped = 'false';
        surface.dataset.translateOffset = '0';
      }
      isHorizontal = false;
      isSwiping = false;
    }
  });

  // Tap / click handler
  surface.addEventListener('click', (e) => {
    if (surface.dataset.swiped === 'true') {
      e.stopPropagation();
      e.preventDefault();
      surface.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      surface.style.transform = 'translateX(0px)';
      surface.dataset.swiped = 'false';
      surface.dataset.translateOffset = '0';
      return;
    }
    if (typeof onOpenItem === 'function') {
      onOpenItem();
    }
  });
}

// ==================== CONVERSATION THREADING & UTILITIES ====================
function normalizeSubject(sub) {
  if (!sub) return '(no subject)';
  let s = String(sub).trim();
  // Strip repeated Re:, Fwd:, Fw:, Sv:, Aw:, etc.
  s = s.replace(/^(\s*(re|fw|fwd|sv|aw|antw)\s*:\s*)+/i, '').trim();
  return s.toLowerCase() || '(no subject)';
}

function extractCleanParticipant(str) {
  if (!str) return '';
  const s = String(str).trim();
  const angleMatch = s.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();
  return s.replace(/^["']|["']$/g, '').trim().toLowerCase();
}

function getCanonicalContactId(str) {
  if (!str) return 'unknown';
  let s = String(str).trim();
  const angleMatch = s.match(/<([^>]+)>/);
  if (angleMatch) s = angleMatch[1].trim();
  s = s.replace(/^["']|["']$/g, '').trim().toLowerCase();
  
  const atIdx = s.indexOf('@');
  if (atIdx !== -1) {
    const local = s.substring(0, atIdx).trim();
    const cleanDigits = local.replace(/\D/g, '');
    if (cleanDigits.length >= 10 && cleanDigits.length <= 13) {
      return cleanDigits.slice(-10);
    }
    return s;
  }
  
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return s;
}

function getConversationKey(email, myPhone) {
  const myClean = (myPhone || (currentUser && currentUser.phone) || '').replace(/\D/g, '').slice(-10);
  const myEmail = (currentUser && currentUser.email_address || '').toLowerCase().trim();

  const senderCanon = getCanonicalContactId(email.sender_email);

  let recipients = [];
  if (email.recipient_phone) {
    recipients = email.recipient_phone.split(/[,;]/).map(r => getCanonicalContactId(r)).filter(Boolean);
  } else if (email.recipient_emails) {
    try {
      const parsed = JSON.parse(email.recipient_emails);
      if (Array.isArray(parsed)) recipients = parsed.map(r => getCanonicalContactId(r)).filter(Boolean);
    } catch(e) {}
  }

  const isSenderMe = (senderCanon && myClean && senderCanon === myClean) || (myEmail && senderCanon === myEmail);
  let counterparts = [];
  if (isSenderMe) {
    counterparts = recipients.filter(r => r !== myClean && r !== myEmail);
  } else {
    counterparts = [senderCanon, ...recipients.filter(r => r !== myClean && r !== myEmail && r !== senderCanon)];
  }

  const uniqueCounterparts = [...new Set(counterparts)].filter(Boolean);

  if (uniqueCounterparts.length >= 2) {
    const sorted = uniqueCounterparts.sort();
    return `group_${sorted.join('__')}`;
  }

  const otherParty = uniqueCounterparts[0] || senderCanon || 'unknown';
  return `direct_${otherParty}`;
}

function groupEmailsIntoConversations(emails) {
  const myPhone = currentUser ? currentUser.phone : '';
  const convMap = new Map();

  emails.forEach(email => {
    const key = getConversationKey(email, myPhone);
    if (!convMap.has(key)) {
      convMap.set(key, {
        id: email.conversation_id || key,
        key: key,
        messages: [],
        subject: email.subject || '(No Subject)',
        is_starred: 0,
        is_important: 0,
        folder: email.folder || 'INBOX',
        has_attachments: false,
        created_at: email.created_at
      });
    }

    const conv = convMap.get(key);
    conv.messages.push(email);

    if (email.is_starred === 1) conv.is_starred = 1;
    if (email.is_important === 1) conv.is_important = 1;
    if (email.has_attachments || (email.attachments && email.attachments.length > 0)) {
      conv.has_attachments = true;
    }
    // Update to most recent timestamp
    if (new Date(email.created_at) > new Date(conv.created_at)) {
      conv.created_at = email.created_at;
      conv.subject = email.subject || conv.subject;
    }
  });

  const convList = [];
  convMap.forEach(conv => {
    // Sort chronological: oldest first for chat timeline
    conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const latest = conv.messages[conv.messages.length - 1];
    conv.latestMessage = latest;
    conv.latest_subject = latest.subject || conv.subject || '(No Subject)';
    conv.latest_snippet = (latest.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);
    conv.message_count = conv.messages.length;
    conv.is_read = conv.messages.every(m => m.is_read === 1) ? 1 : 0;
    conv.unread_count = conv.messages.filter(m => m.is_read === 0).length;

    // Detect if group or 1-on-1
    const isGroup = conv.key.startsWith('group_');
    conv.is_group = isGroup;

    // Identify primary participant (counterpart) - ALWAYS show other user profile
    const myClean = (myPhone || '').replace(/\D/g, '').slice(-10);
    const myEmail = (currentUser && currentUser.email_address || '').toLowerCase().trim();
    let counterpart = '';
    let senderName = '';

    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      const s = extractCleanParticipant(m.sender_email);
      const isMe = (myClean && s.includes(myClean)) || (myEmail && s.toLowerCase().includes(myEmail));
      if (!isMe) {
        counterpart = s;
        senderName = m.sender_name || '';
        break;
      }
    }
    if (!counterpart) {
      // All messages were sent by user. Look for recipient
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const m = conv.messages[i];
        if (m.recipient_phone) {
          counterpart = extractCleanParticipant(m.recipient_phone);
          break;
        } else if (m.recipient_emails) {
          try {
            const arr = JSON.parse(m.recipient_emails);
            if (Array.isArray(arr) && arr.length > 0) {
              const other = arr.find(r => {
                const cr = extractCleanParticipant(r);
                return !(myClean && cr.includes(myClean)) && !(myEmail && cr.toLowerCase().includes(myEmail));
              });
              if (other) {
                counterpart = extractCleanParticipant(other);
                break;
              }
            }
          } catch(e) {}
        }
      }
      if (!counterpart) {
        counterpart = extractCleanParticipant(latest.recipient_phone || getRecipientsDisplay(latest) || 'unknown');
      }
      senderName = '';
    }

    // Check cached contacts for saved name & custom avatar
    let customAvatar = null;
    if (counterpart && cachedContacts && cachedContacts.length > 0) {
      const contact = cachedContacts.find(c => {
        if (c.phone && counterpart.includes(c.phone)) return true;
        if (c.email && c.email.toLowerCase() === counterpart.toLowerCase()) return true;
        return false;
      });
      if (contact) {
        if (contact.name && !senderName) senderName = contact.name;
        if (contact.avatar_url) customAvatar = contact.avatar_url;
      }
    }

    conv.participant_raw = counterpart;
    conv.sender_name = senderName;

    const isPhoneMail = isPhoneMailSender(counterpart);
    conv.is_phonemail = isPhoneMail;

    // Format display title
    if (isGroup) {
      conv.display_title = `Group (${conv.message_count} msgs)`;
      conv.display_subtitle = '👥 Group Conversation';
    } else {
      const formatted = formatSenderDisplay(counterpart, false, senderName);
      conv.display_title = formatted;
      conv.display_subtitle = isPhoneMail ? '⚡ INAI Verified' : '🌐 External Mail';
    }

    // Avatar auto-fetch & fallback
    conv.avatar_url = getAvatarUrl(counterpart, conv.display_title, customAvatar);

    convList.push(conv);
  });

  // Sort conversations descending by latest message
  convList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return convList;
}

// ==================== QUICK FILTERS (ALL / UNREAD / ATTACHMENTS / FAVORITES) ====================
function setMobileQuickFilter(filter) {
  activeQuickFilter = filter;
  ['all', 'unread', 'attachments', 'favorites'].forEach(f => {
    const pill = document.getElementById(`quick-pill-${f}`);
    if (pill) {
      if (f === filter) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  });
  renderEmailList(allEmails);
}

function clearSearchInput() {
  const input = document.getElementById('mob-search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  if (input) {
    input.value = '';
    searchTerm = '';
  }
  if (clearBtn) clearBtn.style.display = 'none';
  renderEmailList(allEmails);
}

function setMobileInboxMode(mode) {
  if (mode !== 'messenger' && mode !== 'traditional') mode = 'messenger';
  mobileInboxMode = mode;
  localStorage.setItem('mobile_inbox_mode', mobileInboxMode);
  updateMobileViewModeControls();
  renderEmailList(allEmails);
  showToastNotification(`Switched to ${mode === 'messenger' ? 'Messenger' : 'Traditional'} View`, 'info');
}

function toggleMobileInboxMode() {
  setMobileInboxMode(mobileInboxMode === 'messenger' ? 'traditional' : 'messenger');
}

function updateMobileViewModeControls() {
  const tabMessenger = document.getElementById('tab-mode-messenger');
  const tabTraditional = document.getElementById('tab-mode-traditional');

  if (tabMessenger && tabTraditional) {
    if (mobileInboxMode === 'traditional') {
      tabMessenger.classList.remove('active');
      tabTraditional.classList.add('active');
    } else {
      tabTraditional.classList.remove('active');
      tabMessenger.classList.add('active');
    }
  }

  const topBtn = document.getElementById('mob-top-mode-btn');
  const topIcon = document.getElementById('mob-top-mode-icon');
  const drawerLabel = document.getElementById('drawer-view-mode-label');
  const drawerIcon = document.getElementById('drawer-view-mode-icon');

  if (mobileInboxMode === 'traditional') {
    if (topBtn) topBtn.title = 'Switch to Messenger View';
    if (topIcon) {
      topIcon.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
    if (drawerLabel) drawerLabel.innerText = 'Messenger View';
    if (drawerIcon) {
      drawerIcon.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
  } else {
    if (topBtn) topBtn.title = 'Switch to Traditional View';
    if (topIcon) {
      topIcon.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
    }
    if (drawerLabel) drawerLabel.innerText = 'Traditional View';
    if (drawerIcon) {
      drawerIcon.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
    }
  }

  // Update FAB icon and background dynamically
  const fab = document.getElementById('mob-fab-compose') || document.querySelector('.fab-compose');
  if (fab) {
    if (mobileInboxMode === 'traditional') {
      fab.style.background = '#2563eb';
      fab.title = 'Compose New Email';
      fab.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    } else {
      fab.style.background = '#046A38';
      fab.title = 'New Message';
      fab.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
  }
}

function handleMobileFabClick() {
  openTraditionalCompose();
}

// ==================== MOBILE CONVERSATION / TRADITIONAL LIST RENDERING ====================
function renderEmailList(emails) {
  const container = document.getElementById('conversations-list');
  if (!container) return;
  container.innerHTML = '';

  const rawList = emails || [];
  allConversations = groupEmailsIntoConversations(rawList);

  // Update quick filter pill counts
  const totalCount = allConversations.length;
  const unreadCount = allConversations.filter(c => c.unread_count > 0).length;
  const attachCount = allConversations.filter(c => c.has_attachments).length;
  const favCount = allConversations.filter(c => c.is_starred === 1 || c.is_important === 1).length;

  const pillAll = document.getElementById('mob-pill-all');
  if (pillAll) pillAll.innerText = totalCount;
  const pillUnread = document.getElementById('mob-pill-unread');
  if (pillUnread) pillUnread.innerText = unreadCount;
  const pillAttach = document.getElementById('mob-pill-attachments');
  if (pillAttach) pillAttach.innerText = attachCount;
  const pillFav = document.getElementById('mob-pill-favorites');
  if (pillFav) pillFav.innerText = favCount;

  if (mobileInboxMode === 'traditional') {
    // TRADITIONAL VIEW: Render individual email cards
    let filteredEmails = [...rawList];

    if (activeSourceFilter === 'phonemail') {
      filteredEmails = filteredEmails.filter(e => isPhoneMailSender(e.sender_email));
    } else if (activeSourceFilter === 'external') {
      filteredEmails = filteredEmails.filter(e => !isPhoneMailSender(e.sender_email));
    }

    if (activeQuickFilter === 'unread') {
      filteredEmails = filteredEmails.filter(e => e.is_read === 0);
    } else if (activeQuickFilter === 'attachments') {
      filteredEmails = filteredEmails.filter(e => e.has_attachments || (e.attachments && e.attachments.length > 0));
    } else if (activeQuickFilter === 'favorites') {
      filteredEmails = filteredEmails.filter(e => e.is_starred === 1 || e.is_important === 1);
    }

    // Date Filter in Traditional View
    if (activeDateFilter !== 'all') {
      filteredEmails = filteredEmails.filter(e => isDateInFilter(e.created_at));
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filteredEmails = filteredEmails.filter(e => 
        (e.subject || '').toLowerCase().includes(term) ||
        (e.sender_email || '').toLowerCase().includes(term) ||
        (e.sender_name || '').toLowerCase().includes(term) ||
        (e.body_text || '').toLowerCase().includes(term)
      );
    }

    if (filteredEmails.length === 0) {
      let emptyMsg = `No messages in ${getFolderFriendlyName(currentFolder)}.`;
      if (activeQuickFilter === 'unread') emptyMsg = 'No unread emails.';
      else if (activeQuickFilter === 'attachments') emptyMsg = 'No emails with attachments.';
      else if (activeQuickFilter === 'favorites') emptyMsg = 'No starred or favorite emails.';
      else if (activeDateFilter !== 'all') emptyMsg = `No emails matching date filter (${getDatePresetLabel(activeDateFilter)}).`;

      container.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 50px 20px;">
          <div style="margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">No Emails Found</h3>
          <p style="font-size: 12.5px;">${emptyMsg}</p>
        </div>
      `;
      return;
    }

    filteredEmails.forEach(email => {
      const card = createMobileTraditionalEmailCard(email);
      container.appendChild(card);
    });

    updateBulkToolbar();
    return;
  }

  // MESSENGER VIEW: Render WhatsApp-style conversation cards
  let filtered = [...allConversations];

  // 1. Source Filter (All / INAI Network / External)
  if (activeSourceFilter === 'phonemail') {
    filtered = filtered.filter(c => c.is_phonemail);
  } else if (activeSourceFilter === 'external') {
    filtered = filtered.filter(c => !c.is_phonemail);
  }

  // 2. Quick Filter Pill
  if (activeQuickFilter === 'unread') {
    filtered = filtered.filter(c => c.unread_count > 0);
  } else if (activeQuickFilter === 'attachments') {
    filtered = filtered.filter(c => c.has_attachments);
  } else if (activeQuickFilter === 'favorites') {
    filtered = filtered.filter(c => c.is_starred === 1 || c.is_important === 1);
  }

  // Date Filter in Messenger View
  if (activeDateFilter !== 'all') {
    filtered = filtered.filter(c => isDateInFilter(c.created_at || (c.latestMessage && c.latestMessage.created_at)));
  }

  // 3. Search query
  if (searchTerm) {
    filtered = filtered.filter(c => {
      const matchSub = (c.latest_subject || '').toLowerCase().includes(searchTerm);
      const matchPart = (c.display_title || '').toLowerCase().includes(searchTerm);
      const matchBody = (c.latest_snippet || '').toLowerCase().includes(searchTerm);
      const matchMsgs = c.messages.some(m => 
        (m.subject || '').toLowerCase().includes(searchTerm) || 
        (m.body_text || '').toLowerCase().includes(searchTerm)
      );
      return matchSub || matchPart || matchBody || matchMsgs;
    });
  }

  if (filtered.length === 0) {
    let emptyMsg = `No conversations in ${getFolderFriendlyName(currentFolder)}.`;
    if (activeQuickFilter === 'unread') emptyMsg = 'No unread conversations.';
    else if (activeQuickFilter === 'attachments') emptyMsg = 'No conversations with attachments.';
    else if (activeQuickFilter === 'favorites') emptyMsg = 'No starred or favorite conversations.';
    else if (activeDateFilter !== 'all') emptyMsg = `No conversations matching date filter (${getDatePresetLabel(activeDateFilter)}).`;

    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 50px 20px;">
        <div style="margin-bottom: 12px;">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">No Conversations Found</h3>
        <p style="font-size: 12.5px;">${emptyMsg}</p>
      </div>
    `;
    return;
  }

  // Render conversation cards
  filtered.forEach(conv => {
    const card = createMobileConversationCard(conv);
    container.appendChild(card);
  });

  updateBulkToolbar();
}

function createMobileTraditionalEmailCard(email) {
  const cardWrapper = document.createElement('div');
  const isSelected = selectedEmailIds.has(email.id);
  const isStarred = email.is_starred === 1;
  const isImportant = email.is_important === 1;

  cardWrapper.id = `mob-email-${email.id}`;
  cardWrapper.dataset.id = email.id;
  cardWrapper.className = `traditional-email-card-wrap`;

  const dateObj = new Date(email.created_at);
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const timeDisplay = isToday 
    ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const isSentFolder = currentFolder.toUpperCase() === 'SENT';
  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const recipientsDisplay = getRecipientsDisplay(email);

  const isFromPhoneMail = isPhoneMailSender(email.sender_email);
  const inaiIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const extIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  const sourceBadgeHtml = isFromPhoneMail
    ? `<span class="badge-source-tag badge-phonemail-pill" title="Sent via INAI Network">${inaiIcon}<span>INAI</span></span>`
    : `<span class="badge-source-tag badge-external-pill" title="Sent via External Mail Service">${extIcon}<span>External</span></span>`;

  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const displaySender = (isSentFolder || isSentByMe) 
    ? `To: ${recipientsDisplay || 'Recipient'}` 
    : formattedSender;

  const participantForAvatar = (isSentFolder || isSentByMe) ? (email.recipient_phone || recipientsDisplay) : email.sender_email;
  const targetForInitials = (isSentFolder || isSentByMe) ? (recipientsDisplay || 'Recipient') : formattedSender;
  const rowAvatar = getAvatarUrl(participantForAvatar, targetForInitials);
  const fallbackSvg = generateDefaultAvatar(participantForAvatar, targetForInitials);
  const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 110);
  const hasAtt = email.has_attachments || (email.attachments && email.attachments.length > 0);
  const attCount = email.attachments ? email.attachments.length : (email.has_attachments ? 1 : 0);

  // Traditional Email Card with Interactive Swipe Actions Underlay
  cardWrapper.innerHTML = `
    <div class="swipe-actions-underlay">
      <div class="swipe-right-actions">
        <button type="button" class="swipe-btn star" onclick="toggleStar('${email.id}', event)" title="Star / Unstar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>${isStarred ? 'Unstar' : 'Star'}</span>
        </button>
        <button type="button" class="swipe-btn important" onclick="toggleImportant('${email.id}', event)" title="Add to Priority">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>${isImportant ? 'Normal' : 'Priority'}</span>
        </button>
      </div>
      <div class="swipe-left-actions">
        <button type="button" class="swipe-btn archive" onclick="executeBulkActionOnSingle('${email.id}', 'archive', event)" title="Archive Email">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          <span>Archive</span>
        </button>
        <button type="button" class="swipe-btn delete" onclick="executeBulkActionOnSingle('${email.id}', 'delete', event)" title="Delete Email">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>
      </div>
    </div>

    <div class="traditional-email-surface ${email.is_read === 0 ? 'unread' : ''} ${isSelected ? 'selected' : ''}">
      <div class="email-checkbox-wrap" onclick="toggleEmailSelection('${email.id}', event)">
        <label class="custom-checkbox" onclick="event.stopPropagation()">
          <input type="checkbox" class="row-checkbox" id="mob-check-${email.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmailSelection('${email.id}', event)">
          <span class="checkmark"></span>
        </label>
      </div>

      <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </span>

      <div class="trad-email-avatar-box" onclick="openContactInfoModal('${escapeHtml(participantForAvatar)}'); event.stopPropagation();" title="View Digital ID Card">
        <img src="${rowAvatar}" alt="${escapeHtml(displaySender)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${fallbackSvg}';">
      </div>

      <div class="trad-email-main-col">
        <div class="trad-email-header-row">
          <span class="trad-email-sender ${email.is_read === 0 ? 'bold-unread' : ''}">
            ${escapeHtml(displaySender)}
          </span>
          <div class="trad-email-meta-right">
            ${hasAtt ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" style="color: var(--text-dim);"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' : ''}
            <span class="trad-email-date">${timeDisplay}</span>
          </div>
        </div>

        <div class="trad-email-subject-line ${email.is_read === 0 ? 'bold-unread' : ''}">
          ${escapeHtml(email.subject || '(No Subject)')}
        </div>

        <div class="trad-email-snippet-line">
          ${escapeHtml(cleanBodySnippet || 'No preview available')}
        </div>

        <div class="trad-email-tags-row">
          ${sourceBadgeHtml}
          ${isImportant ? '<span class="trad-priority-tag">PRIORITY</span>' : ''}
          ${hasAtt ? `<span class="trad-att-tag">${attCount} ${attCount === 1 ? 'file' : 'files'}</span>` : ''}
        </div>
      </div>
    </div>
  `;

  const surface = cardWrapper.querySelector('.traditional-email-surface');
  enableCardSwipeGestures(cardWrapper, surface, () => {
    openMobileTraditionalEmail(email.id);
  });

  return cardWrapper;
}

function getFormattedEmailBody(email) {
  if (!email) return '<span style="color: var(--text-dim); font-style: italic;">(No Content)</span>';

  let html = (email.body_html || '').trim();
  let text = (email.body_text || '').trim();

  // Attached images helper - ensure attachments are rendered prominently if not in body
  let attachedImagesHtml = '';
  if (email.attachments && email.attachments.length > 0) {
    const unreferencedImages = email.attachments.filter(att => {
      const isImg = (att.content_type && att.content_type.startsWith('image/')) || 
                    (att.filename && /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(att.filename));
      if (!isImg) return false;
      const attUrl = att.url || `/api/attachments/${att.id}`;
      return !html.includes(attUrl) && (!att.content_id || !html.includes(att.content_id));
    });
    if (unreferencedImages.length > 0) {
      attachedImagesHtml = unreferencedImages.map(att => `
        <div class="email-attached-image-wrap" style="margin: 12px 0; text-align: center;">
          <img src="${att.url || `/api/attachments/${att.id}`}" alt="${escapeHtml(att.filename || 'Image')}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); display: block; margin: 0 auto; cursor: pointer;">
        </div>
      `).join('');
    }
  }

  // If HTML is present
  if (html) {
    // 1. Repair truncated HTML (e.g. unclosed <img> tag or unclosed quotes)
    const lastImgOpen = html.lastIndexOf('<img');
    if (lastImgOpen !== -1) {
      const lastImgClose = html.indexOf('>', lastImgOpen);
      if (lastImgClose === -1) {
        const afterImg = html.substring(lastImgOpen);
        const quoteCount = (afterImg.match(/"/g) || []).length;
        if (quoteCount % 2 === 1) {
          html += '">';
        } else {
          html += '>';
        }
      }
    }

    // 2. Check if text content is missing from HTML
    // (e.g. if HTML was truncated right after an image or has only whitespace)
    const strippedHtmlText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanPlain = text.replace(/\[image:[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();

    if (cleanPlain.length > 80 && strippedHtmlText.length < 40) {
      // The HTML has an image or layout but lost its text body!
      const formattedText = escapeHtml(text).replace(/\n/g, '<br>');
      return `
        <div class="email-body-html-wrap">${html}</div>
        ${attachedImagesHtml}
        <div class="email-body-text-fallback" style="margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border-color, #e2e8f0); line-height: 1.6; color: var(--text-main);">
          ${formattedText}
        </div>
      `;
    }

    return `<div class="email-body-html-wrap">${html}</div>${attachedImagesHtml}`;
  }

  // Fallback to plain text
  if (text) {
    return `${attachedImagesHtml}<div class="email-body-text-content" style="line-height: 1.65; word-break: break-word;">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  }

  if (attachedImagesHtml) {
    return attachedImagesHtml;
  }

  return '<span style="color: var(--text-dim); font-style: italic;">(No Content)</span>';
}

function openMobileTraditionalEmail(emailId) {
  let email = allEmails.find(e => e.id === emailId);
  if (!email && activeConversation && activeConversation.messages) {
    email = activeConversation.messages.find(m => m.id === emailId);
  }
  if (!email) return;

  activeTradEmail = email;
  activeEmail = email;

  // Immediately remove unread class and bold styling from DOM card so badge vanishes
  const cardWrapper = document.getElementById(`mob-email-${email.id}`) || document.querySelector(`[data-id="${email.id}"]`);
  if (cardWrapper) {
    const surface = cardWrapper.querySelector('.email-card-surface, .traditional-email-surface');
    if (surface) {
      surface.classList.remove('unread');
      surface.querySelectorAll('.bold-unread').forEach(el => el.classList.remove('bold-unread'));
    }
  }

  // Mark read
  if (email.is_read === 0) {
    email.is_read = 1;
    email.read_at = new Date().toISOString();
    fetch(`/api/emails/${email.id}/read`, { method: 'POST' }).catch(() => {});
    Object.keys(emailFolderCache).forEach(f => {
      if (Array.isArray(emailFolderCache[f])) {
        const c = emailFolderCache[f].find(e => e.id === email.id);
        if (c) c.is_read = 1;
      }
    });
    updateFolderCounts(allEmails);
  }

  // Reset translation state
  isMessageTranslated = false;
  originalMessageSubject = email.subject || '(No Subject)';
  originalMessageBody = getFormattedEmailBody(email);

  // Populate dedicated full-screen traditional reading view
  const readingView = document.getElementById('mob-traditional-reading-view');
  if (!readingView) return;

  const folderBadge = document.getElementById('mob-trad-folder-badge');
  if (folderBadge) folderBadge.innerText = getFolderFriendlyName(currentFolder);

  const subjEl = document.getElementById('mob-trad-subject');
  if (subjEl) subjEl.innerText = originalMessageSubject;

  const sourcePill = document.getElementById('mob-trad-source-pill');
  if (sourcePill) {
    const isPM = isPhoneMailSender(email.sender_email);
    sourcePill.className = isPM ? 'badge-source-tag badge-phonemail-pill' : 'badge-source-tag badge-external-pill';
    sourcePill.innerHTML = isPM 
      ? `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="#eab308" stroke="#ca8a04" stroke-width="1.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>INAI Network</span>`
      : `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>External Mail</span>`;
  }

  const catPill = document.getElementById('mob-trad-category-pill');
  if (catPill) catPill.innerText = email.folder || currentFolder;

  const senderAvatarBox = document.getElementById('mob-trad-sender-avatar');
  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const avatarUrl = getAvatarUrl(email.sender_email, formattedSender);
  const fallbackSvg = generateDefaultAvatar(email.sender_email, formattedSender);
  if (senderAvatarBox) {
    senderAvatarBox.innerHTML = `<img src="${avatarUrl}" alt="${escapeHtml(formattedSender)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${fallbackSvg}';">`;
  }

  const senderNameEl = document.getElementById('mob-trad-sender-name');
  if (senderNameEl) senderNameEl.innerText = formattedSender;

  const timeEl = document.getElementById('mob-trad-time');
  if (timeEl) timeEl.innerText = new Date(email.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  const senderAddrEl = document.getElementById('mob-trad-sender-address');
  if (senderAddrEl) senderAddrEl.innerText = email.sender_email || '';

  const toEl = document.getElementById('mob-trad-to');
  if (toEl) toEl.innerText = getRecipientsDisplay(email) || (currentUser ? currentUser.phone : 'me');

  const bodyEl = document.getElementById('mob-trad-body');
  if (bodyEl) {
    bodyEl.innerHTML = originalMessageBody;
  }

  // Attachments
  const attCluster = document.getElementById('mob-trad-attachments');
  if (attCluster) {
    if (email.attachments && email.attachments.length > 0) {
      attCluster.style.display = 'flex';
      attCluster.innerHTML = email.attachments.map(att => `
        <a href="${att.url || `/api/attachments/${att.id}`}" target="_blank" class="trad-att-chip" download="${escapeHtml(att.filename || 'attachment')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span>${escapeHtml(att.filename || 'File')}</span>
        </a>
      `).join('');
    } else {
      attCluster.style.display = 'none';
      attCluster.innerHTML = '';
    }
  }

  updateTradStarButton(email.is_starred === 1);

  readingView.style.display = 'flex';
  const scrollArea = readingView.querySelector('.trad-reading-scroll-area');
  if (scrollArea) scrollArea.scrollTop = 0;
}

function closeMobileTraditionalReading() {
  const readingView = document.getElementById('mob-traditional-reading-view');
  if (readingView) readingView.style.display = 'none';
  activeTradEmail = null;
}

function updateTradStarButton(isStarred) {
  const btn = document.getElementById('mob-trad-star-btn');
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    btn.style.color = isStarred ? '#eab308' : 'inherit';
  }
}

async function toggleCurrentTradStar() {
  if (!activeTradEmail) return;
  const id = activeTradEmail.id;
  try {
    const res = await fetch(`/api/emails/${id}/star`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      activeTradEmail.is_starred = data.is_starred;
      allEmails.forEach(item => {
        if (item.id === id) item.is_starred = data.is_starred;
      });
      if (emailFolderCache[currentFolder]) {
        emailFolderCache[currentFolder] = [...allEmails];
      }
      updateTradStarButton(data.is_starred === 1);
      renderEmailList(allEmails);
      showToastNotification(data.is_starred === 1 ? 'Message starred' : 'Message unstarred');
    }
  } catch (err) {}
}

async function archiveCurrentTradEmail() {
  if (!activeTradEmail) return;
  const id = activeTradEmail.id;
  closeMobileTraditionalReading();
  await executeBulkActionOnSingle(id, 'archive');
}

async function deleteCurrentTradEmail() {
  if (!activeTradEmail) return;
  const id = activeTradEmail.id;
  closeMobileTraditionalReading();
  await executeBulkActionOnSingle(id, 'delete');
}

function replyFromTraditionalView() {
  if (!activeTradEmail) return;
  activeEmail = activeTradEmail;
  openReplyCompose(false);
}

function forwardFromTraditionalView() {
  if (!activeTradEmail) return;
  activeEmail = activeTradEmail;
  openReplyCompose(true);
}

function switchToMessengerForActiveContact() {
  if (!activeTradEmail) return;
  const targetSender = activeTradEmail.sender_email;
  closeMobileTraditionalReading();
  setMobileInboxMode('messenger');
  
  const targetClean = extractCleanParticipant(targetSender);
  const conv = allConversations.find(c => {
    const pClean = extractCleanParticipant(c.participant_raw);
    return pClean === targetClean || (targetClean && pClean.includes(targetClean)) || (pClean && targetClean.includes(pClean));
  });

  if (conv) {
    openConversation(conv.id);
  }
}

async function toggleTradEmailTranslation() {
  if (!activeTradEmail) return;

  const bodyEl = document.getElementById('mob-trad-body');
  const subjEl = document.getElementById('mob-trad-subject');
  if (!bodyEl || !subjEl) return;

  if (isMessageTranslated) {
    subjEl.innerText = originalMessageSubject;
    bodyEl.innerHTML = originalMessageBody;
    isMessageTranslated = false;
    showToastNotification('Original message restored', 'info');
    return;
  }

  const targetLang = getSmartTranslationTarget() || (currentLanguage === 'en' ? 'hi' : currentLanguage);
  showToastNotification(`Translating to ${targetLang.toUpperCase()}...`, 'info');

  try {
    const plainText = (activeTradEmail.body_text || bodyEl.innerText || '').trim();
    const cleanSubj = activeTradEmail.subject || '';

    const [subjRes, bodyRes] = await Promise.all([
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanSubj, targetLang })
      }).then(r => r.json()).catch(() => null),
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: plainText, targetLang })
      }).then(r => r.json()).catch(() => null)
    ]);

    const translatedSubject = (subjRes && subjRes.translatedText) ? subjRes.translatedText : cleanSubj;
    const translatedBody = (bodyRes && bodyRes.translatedText) ? bodyRes.translatedText.replace(/\n/g, '<br>') : plainText.replace(/\n/g, '<br>');

    subjEl.innerHTML = `<span style="font-size:11px; background: rgba(37,99,235,0.12); color: #2563eb; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-right: 6px;">AI ${targetLang.toUpperCase()}</span> ` + escapeHtml(translatedSubject);
    bodyEl.innerHTML = `
      <div style="padding: 8px 12px; background: rgba(37,99,235,0.06); border-left: 3px solid #2563eb; border-radius: 6px; margin-bottom: 12px; font-size: 11.5px; color: #2563eb; font-weight: 600;">
        ⚡ Real-time AI Translation (${targetLang.toUpperCase()})
      </div>
      <div>${translatedBody}</div>
    `;

    isMessageTranslated = true;
    showToastNotification(`Translated message to ${targetLang.toUpperCase()} ✓`, 'success');
  } catch (err) {
    showToastNotification('Translation failed, showing original', 'warning');
  }
}

function createMobileConversationCard(conv) {
  const cardWrapper = document.createElement('div');
  const isStarred = conv.is_starred === 1;
  const isImportant = conv.is_important === 1;
  const latestMsgId = conv.latestMessage ? conv.latestMessage.id : (conv.messages && conv.messages[0] ? conv.messages[0].id : conv.id);

  cardWrapper.id = `mob-conv-${conv.id}`;
  cardWrapper.dataset.id = conv.id;
  cardWrapper.className = `conversation-chat-card-wrap`;

  const dateObj = new Date(conv.created_at);
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const timeDisplay = isToday 
    ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const inaiIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const extIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  const sourceBadgeHtml = conv.is_phonemail
    ? `<span class="badge-source-tag badge-phonemail-pill" title="Sent via INAI Network">${inaiIcon}<span>INAI</span></span>`
    : `<span class="badge-source-tag badge-external-pill" title="Sent via External Mail Service">${extIcon}<span>External</span></span>`;

  const convFallbackSvg = generateDefaultAvatar(conv.participant_raw, conv.display_title);
  const convAvatarUrl = conv.avatar_url || convFallbackSvg;

  // Pure WhatsApp Messenger Card with Interactive Swipe Actions Underlay
  cardWrapper.innerHTML = `
    <div class="swipe-actions-underlay">
      <div class="swipe-right-actions">
        <button type="button" class="swipe-btn star" onclick="toggleStar('${latestMsgId}', event)" title="Star / Unstar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>${isStarred ? 'Unstar' : 'Star'}</span>
        </button>
        <button type="button" class="swipe-btn important" onclick="toggleImportant('${latestMsgId}', event)" title="Add to Priority">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>${isImportant ? 'Normal' : 'Priority'}</span>
        </button>
      </div>
      <div class="swipe-left-actions">
        <button type="button" class="swipe-btn archive" onclick="executeBulkActionOnConversation('${conv.id}', 'archive', event)" title="Archive Conversation">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          <span>Archive</span>
        </button>
        <button type="button" class="swipe-btn delete" onclick="executeBulkActionOnConversation('${conv.id}', 'delete', event)" title="Delete Conversation">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>
      </div>
    </div>

    <div class="chat-conv-surface ${conv.unread_count > 0 ? 'unread' : ''}">
      <div class="chat-conv-avatar-box" onclick="openContactInfoModal('${escapeHtml(conv.participant_raw)}'); event.stopPropagation();" title="View Digital ID Card">
        <img src="${convAvatarUrl}" alt="${escapeHtml(conv.display_title)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${convFallbackSvg}';">
        <span class="chat-online-dot"></span>
      </div>

      <div class="chat-conv-info-col">
        <div class="chat-conv-top-row">
          <div class="chat-conv-title-box">
            <span class="chat-conv-name">${escapeHtml(conv.display_title)}</span>
            ${sourceBadgeHtml}
          </div>
          <span class="chat-conv-time ${conv.unread_count > 0 ? 'unread-time' : ''}">${timeDisplay}</span>
        </div>

        <div class="chat-conv-bottom-row">
          <div class="chat-conv-snippet">
            <span class="chat-check-icon">✓✓</span>
            <span class="chat-snippet-text">${escapeHtml(conv.latest_snippet || conv.latest_subject || 'No preview available')}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            ${isStarred ? '<span style="color: #eab308; display: inline-flex;"><svg viewBox="0 0 24 24" width="13" height="13" fill="#eab308" stroke="#eab308" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>' : ''}
            ${conv.has_attachments ? '<span style="color: var(--text-dim); display: inline-flex;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span>' : ''}
            ${conv.unread_count > 0 ? `<span class="chat-conv-unread-pill">${conv.unread_count}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  const surface = cardWrapper.querySelector('.chat-conv-surface');
  enableCardSwipeGestures(cardWrapper, surface, () => {
    openConversation(conv.id);
  });

  return cardWrapper;
}

// ==================== WHATSAPP-GRADE MOBILE CONVERSATION SCREEN ====================
async function openConversation(convId) {
  const conv = allConversations.find(c => c.id === convId || c.key === convId);
  if (!conv) return;

  activeConversation = conv;
  activeConversationId = conv.id;
  activeEmail = conv.latestMessage;
  activeTradEmail = conv.latestMessage;

  // Immediately remove unread styling and dot from conversation list card
  const cardWrapper = document.getElementById(`mob-conv-${conv.id}`) || document.querySelector(`[data-id="${conv.id}"]`);
  if (cardWrapper) {
    const surface = cardWrapper.querySelector('.email-card-surface');
    if (surface) surface.classList.remove('unread');
    const dot = cardWrapper.querySelector('.conv-unread-dot');
    if (dot) dot.remove();
  }

  // Mark all messages in conversation as read
  const unreadMsgs = conv.messages.filter(m => m.is_read === 0);
  conv.messages.forEach(m => {
    m.is_read = 1;
    m.read_at = m.read_at || new Date().toISOString();
  });
  conv.is_read = 1;
  conv.unread_count = 0;

  if (unreadMsgs.length > 0) {
    const unreadIds = unreadMsgs.map(m => m.id);
    fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', ids: unreadIds })
    }).catch(() => {});
  }

  // Update cached folder emails so it remains read upon return
  const allMsgIds = conv.messages.map(m => m.id);
  allEmails.forEach(e => {
    if (allMsgIds.includes(e.id)) e.is_read = 1;
  });
  Object.keys(emailFolderCache).forEach(f => {
    if (Array.isArray(emailFolderCache[f])) {
      emailFolderCache[f].forEach(e => {
        if (allMsgIds.includes(e.id)) e.is_read = 1;
      });
    }
  });
  updateFolderCounts(allEmails);

  // Header configuration
  const avatarEl = document.getElementById('mob-conv-avatar');
  if (avatarEl) {
    const chatFallbackSvg = generateDefaultAvatar(conv.participant_raw, conv.display_title);
    const chatAvatarUrl = conv.avatar_url || chatFallbackSvg;
    avatarEl.innerHTML = `
      <img src="${chatAvatarUrl}" alt="${escapeHtml(conv.display_title)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${chatFallbackSvg}';">
    `;
    avatarEl.style.backgroundImage = 'none';
    avatarEl.onclick = (e) => {
      e.stopPropagation();
      openContactInfoModal(conv.participant_raw);
    };
    avatarEl.style.cursor = 'pointer';
  }

  const titleEl = document.getElementById('mob-conv-title');
  if (titleEl) titleEl.innerText = conv.display_title;

  const subEl = document.getElementById('mob-conv-subtitle');
  if (subEl) subEl.innerText = conv.display_subtitle;

  // Star status
  const starBtn = document.getElementById('mob-pane-star-btn');
  if (starBtn) {
    starBtn.style.color = conv.is_starred === 1 ? '#f59e0b' : 'var(--text-dim)';
  }

  // Populate chronological chat timeline
  renderChatTimeline(conv);

  // Reset quote banner and input
  cancelQuotedReply();
  const input = document.getElementById('mob-chat-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Show WhatsApp chat pane
  const pane = document.getElementById('reading-pane');
  if (pane) pane.style.display = 'flex';

  // Scroll timeline to bottom
  const timeline = document.getElementById('mob-chat-timeline');
  if (timeline) {
    setTimeout(() => {
      timeline.scrollTop = timeline.scrollHeight;
    }, 60);
  }
}

function renderChatTimeline(conv) {
  const timeline = document.getElementById('mob-chat-timeline');
  if (!timeline) return;
  timeline.innerHTML = '';

  const myPhone = currentUser ? currentUser.phone : '';
  const myClean = (myPhone || '').replace(/\D/g, '');

  let lastDateStr = '';

  conv.messages.forEach((msg, idx) => {
    // 1. Date Divider
    const msgDate = new Date(msg.created_at);
    const dateStr = msgDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr;
      const divider = document.createElement('div');
      divider.className = 'chat-date-divider';
      const isToday = new Date().toDateString() === msgDate.toDateString();
      divider.innerHTML = `<span>${isToday ? 'Today' : dateStr}</span>`;
      timeline.appendChild(divider);
    }

    // 2. Sender Identification
    const cleanSender = extractCleanParticipant(msg.sender_email);
    const isOutgoing = cleanSender.includes(myClean) || (currentUser && cleanSender.includes(currentUser.phone));

    const timeDisplay = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Single-reply constraint
    const hasReplied = msg.has_replied === 1;

    // Extract inline or attached image if present
    let previewImageSrc = '';
    if (msg.body_html) {
      const imgMatch = msg.body_html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) {
        previewImageSrc = imgMatch[1];
      }
    }
    if (!previewImageSrc && msg.attachments && msg.attachments.length > 0) {
      const imgAtt = msg.attachments.find(a => 
        (a.content_type && a.content_type.startsWith('image/')) || 
        (a.filename && /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(a.filename))
      );
      if (imgAtt) {
        previewImageSrc = imgAtt.url || `/api/attachments/${imgAtt.id}`;
      }
    }

    let cleanText = (msg.body_text || '').replace(/\[image:[^\]]*\]/gi, '').trim();
    if (!cleanText && msg.body_html) {
      cleanText = msg.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const hasLongContent = cleanText.length > 180 || Boolean(previewImageSrc) || (msg.body_html && msg.body_html.length > 250);
    const snippetText = hasLongContent ? (cleanText.substring(0, 160) + (cleanText.length > 160 ? '...' : '')) : cleanText;

    // First email in thread shows Subject; replies hide Subject
    const isFirstMessage = idx === 0;
    const showSubject = isFirstMessage && msg.subject && msg.subject !== '(No Subject)';

    // Bubble element
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = `chat-bubble-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
    bubbleWrapper.id = `chat-msg-${msg.id}`;

    // Quoted reply content if this message was a reply
    let quotedReplyHtml = '';
    if (msg.quoted_text || msg.reply_to_id) {
      const qSender = msg.quoted_sender || 'Original Message';
      const qText = (msg.quoted_text || 'Referenced message').substring(0, 90);
      quotedReplyHtml = `
        <div class="chat-quoted-box">
          <div class="quoted-bar"></div>
          <div class="quoted-text-wrap">
            <span class="quoted-sender">${escapeHtml(qSender)}</span>
            <span class="quoted-snippet">${escapeHtml(qText)}</span>
          </div>
        </div>
      `;
    }

    // Subject badge for first message
    const subjectHtml = showSubject ? `
      <div class="chat-subject-badge">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        <span>${escapeHtml(msg.subject)}</span>
      </div>
    ` : '';

    // Sender name badge (for incoming in group, or external)
    const senderBadgeHtml = (!isOutgoing && conv.is_group) ? `
      <div class="chat-sender-label">${escapeHtml(formatSenderDisplay(msg.sender_email, false, msg.sender_name))}</div>
    ` : '';

    // Inline Image Preview thumbnail in bubble - prominent with tap badge
    const imageHtml = previewImageSrc ? `
      <div class="bubble-image-preview" onclick="openTraditionalViewFromChat('${msg.id}')" title="Tap to view full email and image">
        <img src="${previewImageSrc}" alt="Email image" loading="lazy" onerror="this.closest('.bubble-image-preview').style.display='none';">
        <div class="bubble-image-overlay">
          <span class="bubble-image-badge">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            <span>Full Mail</span>
          </span>
        </div>
      </div>
    ` : '';

    // Body display with snippet & actions
    const bodyContentHtml = `
      ${imageHtml}
      <div class="chat-message-text" id="body-text-${msg.id}">
        ${escapeHtml(snippetText).replace(/\n/g, '<br>')}
      </div>
      ${hasLongContent ? `
        <div class="chat-long-email-actions" id="chat-actions-${msg.id}">
          <button type="button" class="btn-chat-link expand-btn" onclick="toggleExpandMessage('${msg.id}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
            <span>View Full Mail ▾</span>
          </button>
          <button type="button" class="btn-chat-link trad-link" onclick="openTraditionalViewFromChat('${msg.id}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>Open Full View ↗</span>
          </button>
        </div>
      ` : ''}
    `;

    // Reply button fallback & Single-Reply indicator
    let replyActionHtml = '';
    if (hasReplied) {
      replyActionHtml = `<span class="replied-status-badge">Replied ✓</span>`;
    } else {
      replyActionHtml = `
        <button type="button" class="bubble-reply-btn" onclick="triggerReplyToMessage('${msg.id}', event)" title="Reply to this message">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          <span>Reply</span>
        </button>
      `;
    }

    bubbleWrapper.innerHTML = `
      <div class="chat-bubble ${isOutgoing ? 'outgoing' : 'incoming'} ${hasLongContent ? 'has-rich-email' : ''}">
        ${senderBadgeHtml}
        ${subjectHtml}
        ${quotedReplyHtml}
        ${bodyContentHtml}
        <div class="chat-bubble-footer">
          <div class="bubble-footer-left">
            ${replyActionHtml}
          </div>
          <div class="bubble-footer-right">
            <span class="chat-timestamp">${timeDisplay}</span>
            ${isOutgoing ? `
              <span class="chat-checks ${msg.is_read === 1 || msg.read_at ? 'read' : 'delivered'}" title="${msg.is_read === 1 || msg.read_at ? 'Read by recipient' : 'Delivered'}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                  <polyline points="22 10 14.5 17.5 11 14"/>
                </svg>
              </span>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Swipe-right-to-reply touch gesture on bubble
    const bubbleEl = bubbleWrapper.querySelector('.chat-bubble');
    let touchStartX = 0;
    bubbleEl.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    bubbleEl.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      if (touchEndX - touchStartX > 65) {
        // Swiped right! Trigger reply
        triggerReplyToMessage(msg.id, e);
      }
    }, { passive: true });

    timeline.appendChild(bubbleWrapper);
  });
}

function toggleExpandMessage(msgId) {
  const el = document.getElementById(`body-text-${msgId}`);
  if (!el) return;

  const isExpanded = el.classList.contains('expanded-full');

  let msg = null;
  if (activeConversation && activeConversation.messages) {
    msg = activeConversation.messages.find(m => m.id === msgId);
  }
  if (!msg) {
    msg = allEmails.find(e => e.id === msgId);
  }
  if (!msg) return;

  const actions = document.getElementById(`chat-actions-${msgId}`) || el.parentElement.querySelector('.chat-long-email-actions');
  const bubble = el.closest('.chat-bubble');

  if (isExpanded) {
    el.classList.remove('expanded-full');
    if (bubble) bubble.classList.remove('expanded-full');

    let cleanText = (msg.body_text || '').replace(/\[image:[^\]]*\]/gi, '').trim();
    if (!cleanText && msg.body_html) {
      cleanText = msg.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    el.innerHTML = escapeHtml(cleanText.substring(0, 160) + (cleanText.length > 160 ? '...' : '')).replace(/\n/g, '<br>');

    if (bubble) {
      const prevImg = bubble.querySelector('.bubble-image-preview');
      if (prevImg) prevImg.style.display = 'block';
    }

    if (actions) {
      actions.innerHTML = `
        <button type="button" class="btn-chat-link expand-btn" onclick="toggleExpandMessage('${msgId}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
          <span>View Full Mail ▾</span>
        </button>
        <button type="button" class="btn-chat-link trad-link" onclick="openTraditionalViewFromChat('${msgId}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          <span>Open Full View ↗</span>
        </button>
      `;
    }
  } else {
    el.classList.add('expanded-full');
    if (bubble) bubble.classList.add('expanded-full');
    el.innerHTML = getFormattedEmailBody(msg);

    if (bubble) {
      const prevImg = bubble.querySelector('.bubble-image-preview');
      if (prevImg) prevImg.style.display = 'none';
    }

    if (actions) {
      actions.innerHTML = `
        <button type="button" class="btn-chat-link expand-btn" onclick="toggleExpandMessage('${msgId}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="18 15 12 9 6 15"/></svg>
          <span>Collapse Mail ▴</span>
        </button>
        <button type="button" class="btn-chat-link trad-link" onclick="openTraditionalViewFromChat('${msgId}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          <span>Open Full View ↗</span>
        </button>
      `;
    }
  }
}

function closeReadingPane() {
  const pane = document.getElementById('reading-pane');
  if (pane) pane.style.display = 'none';
  activeConversation = null;
  activeConversationId = null;
  activeReplyingMessage = null;
}

// ==================== REPLY BEHAVIOR & CONSTRAINTS ====================
function triggerReplyToMessage(msgId, e) {
  if (e) e.stopPropagation();

  if (!activeConversation) return;
  const msg = activeConversation.messages.find(m => m.id === msgId);
  if (!msg) return;

  // Single-reply check
  if (msg.has_replied === 1) {
    showToastNotification('This message has already been replied to once.', 'info');
    return;
  }

  activeReplyingMessage = msg;

  const quoteBar = document.getElementById('mob-quote-reply-bar');
  const quoteSender = document.getElementById('mob-quote-sender');
  const quoteSnippet = document.getElementById('mob-quote-snippet');

  if (quoteBar && quoteSender && quoteSnippet) {
    const senderDisplay = formatSenderDisplay(msg.sender_email, false, msg.sender_name);
    quoteSender.innerText = `Replying to ${senderDisplay}`;
    quoteSnippet.innerText = (msg.body_text || msg.body_html || '').replace(/\s+/g, ' ').trim().substring(0, 80);
    quoteBar.style.display = 'flex';
  }

  const input = document.getElementById('mob-chat-input');
  if (input) {
    input.focus();
    input.placeholder = 'Type your reply...';
  }
}

function cancelQuotedReply() {
  activeReplyingMessage = null;
  const quoteBar = document.getElementById('mob-quote-reply-bar');
  if (quoteBar) quoteBar.style.display = 'none';
  const input = document.getElementById('mob-chat-input');
  if (input) input.placeholder = 'Type an email message...';
}

function autoExpandChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleChatInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitChatMessage();
  }
}

async function submitChatMessage() {
  const input = document.getElementById('mob-chat-input');
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;

  if (!activeConversation) {
    showToastNotification('No active conversation', 'error');
    return;
  }

  // Recipient lock: Send to counterpart or group participants
  const to = activeConversation.participant_raw || activeConversation.latestMessage.sender_email;
  const cleanSubject = activeConversation.latest_subject.replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '');
  const subject = `Re: ${cleanSubject}`;

  const sendBtn = document.getElementById('mob-chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const payload = {
      sender_phone: currentUser.phone,
      to: to,
      subject: subject,
      body: body,
      reply_to_id: activeReplyingMessage ? activeReplyingMessage.id : null,
      conversation_id: activeConversation.id
    };

    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      input.value = '';
      input.style.height = 'auto';

      if (activeReplyingMessage) {
        activeReplyingMessage.has_replied = 1;
      }
      cancelQuotedReply();

      // Append temporary outgoing message to timeline
      const now = new Date();
      const newMsg = {
        id: data.email ? data.email.id : `tmp_${Date.now()}`,
        sender_email: `${currentUser.phone}@alphastack.wwisvnr.com`,
        sender_name: currentUser.display_name || currentUser.phone,
        subject: subject,
        body_text: body,
        created_at: now.toISOString(),
        is_read: 1,
        has_replied: 0,
        quoted_sender: activeReplyingMessage ? formatSenderDisplay(activeReplyingMessage.sender_email, false, activeReplyingMessage.sender_name) : null,
        quoted_text: activeReplyingMessage ? (activeReplyingMessage.body_text || '').substring(0, 90) : null
      };

      activeConversation.messages.push(newMsg);
      activeConversation.latestMessage = newMsg;
      activeConversation.latest_snippet = body.substring(0, 90);
      activeConversation.created_at = newMsg.created_at;

      renderChatTimeline(activeConversation);

      const timeline = document.getElementById('mob-chat-timeline');
      if (timeline) {
        timeline.scrollTop = timeline.scrollHeight;
      }

      showToastNotification('Reply sent ✓', 'success');
      // Invalidate memory cache to keep in sync
      emailFolderCache = {};
    } else {
      showToastNotification(data.error || 'Failed to send reply', 'error');
    }
  } catch (err) {
    showToastNotification('Network error sending reply', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ==================== TRADITIONAL EMAIL VIEW ON MOBILE ====================
function openTraditionalViewFromChat(emailId) {
  let targetId = emailId;
  if (!targetId && activeConversation) {
    if (activeConversation.latestMessage && activeConversation.latestMessage.id) {
      targetId = activeConversation.latestMessage.id;
    } else if (activeConversation.messages && activeConversation.messages.length > 0) {
      targetId = activeConversation.messages[activeConversation.messages.length - 1].id;
    }
  }
  if (targetId) {
    openMobileTraditionalEmail(targetId);
  } else {
    showToastNotification('Select an email to view details', 'info');
  }
}

function closeTraditionalViewModal() {
  closeMobileTraditionalReading();
}

// ==================== MOBILE IMAGE LIGHTBOX VIEWER ====================
function openImageLightbox(src, alt) {
  if (!src) return;
  const modal = document.getElementById('mob-image-lightbox');
  const img = document.getElementById('mob-lightbox-img');
  const caption = document.getElementById('mob-lightbox-caption');
  const download = document.getElementById('mob-lightbox-download');
  if (!modal || !img) return;

  img.src = src;
  if (caption) caption.innerText = alt || 'Email Image';
  if (download) {
    download.href = src;
    download.setAttribute('download', alt ? (alt.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png') : 'inai_email_photo.png');
  }
  modal.style.display = 'flex';
}

function closeImageLightbox() {
  const modal = document.getElementById('mob-image-lightbox');
  if (modal) modal.style.display = 'none';
}

// ==================== DIGITAL ID CARD & PERSON INFO MODAL ====================
function openDigitalIdModal() {
  openContactInfoModal(currentUser ? currentUser.phone : null);
}

function openActiveContactInfoModal() {
  let target = null;
  let customName = null;

  if (activeEmail) {
    const isSentFolder = currentFolder && currentFolder.toUpperCase() === 'SENT';
    const isSentByMe = Boolean(
      isSentFolder ||
      (activeEmail.sender_email && currentUser && currentUser.phone && activeEmail.sender_email.includes(currentUser.phone))
    );
    if (isSentByMe) {
      const recDisplay = getRecipientsDisplay(activeEmail);
      target = activeEmail.recipient_phone || recDisplay || (activeEmail.recipient_emails && activeEmail.recipient_emails[0]);
      customName = lookupContactName(target) || activeEmail.recipient_name || '';
    } else {
      target = activeEmail.sender_email;
      customName = activeEmail.sender_name || lookupContactName(target) || '';
    }
  } else if (activeConversation) {
    target = activeConversation.participant_raw;
    customName = activeConversation.sender_name || '';
  }

  if (!target && currentUser) {
    target = currentUser.phone;
    customName = currentUser.name || currentUser.display_name;
  }

  if (target) {
    openContactInfoModal(target, customName);
  }
}

async function openContactInfoModal(phoneOrEmail, customName = '') {
  let raw = phoneOrEmail || (activeConversation && activeConversation.participant_raw) || (currentUser && currentUser.phone);
  if (!raw) return;

  // Clean target
  let target = String(raw).trim();
  try {
    const parsed = JSON.parse(target);
    if (Array.isArray(parsed) && parsed.length > 0) target = parsed[0];
  } catch(e) {}
  target = target.replace(/^[<"']+|[>"']+$/g, '').trim();
  const angleMatch = target.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  let parsedName = customName;
  if (angleMatch) {
    if (!parsedName) parsedName = angleMatch[1];
    target = angleMatch[2];
  }

  activeContactForModal = target;
  const modal = document.getElementById('digital-id-modal');
  if (!modal) return;

  const cleanPhone = String(target).replace(/\D/g, '').slice(-10);
  const myPhoneClean = currentUser && currentUser.phone ? String(currentUser.phone).replace(/\D/g, '').slice(-10) : '';
  const myEmailClean = currentUser && currentUser.email ? String(currentUser.email).toLowerCase().trim() : '';
  const targetEmailClean = (target.includes('@') ? target.toLowerCase().trim() : (cleanPhone ? `${cleanPhone}@alphastack.wwisvnr.com` : ''));

  // Only allow editing if viewing YOUR OWN profile
  const isSelf = Boolean(
    (myPhoneClean && cleanPhone && myPhoneClean === cleanPhone) ||
    (myEmailClean && targetEmailClean && myEmailClean === targetEmailClean) ||
    (!cleanPhone && !targetEmailClean && currentUser)
  );
  activeContactModalIsSelf = isSelf;

  const tabSwitcher = document.getElementById('mob-id-card-tab-switcher');
  const btnEdit = document.getElementById('btn-id-tab-edit');
  if (tabSwitcher) {
    tabSwitcher.style.display = isSelf ? 'flex' : 'none';
  }
  if (btnEdit) {
    btnEdit.style.display = isSelf ? 'inline-flex' : 'none';
  }

  // Set default view to Digital ID Card
  switchIdCardTab('card');

  const isPM = isPhoneMailSender(target) || (cleanPhone && cleanPhone.length === 10);
  const formattedPhone = cleanPhone.length === 10 ? `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}` : (target.includes('@') ? '' : target);

  const nameEl = document.getElementById('id-card-name');
  const phoneEl = document.getElementById('id-card-phone');
  const emailEl = document.getElementById('id-card-email');
  const aliasTagEl = document.getElementById('id-card-alias-tag');
  const avatarEl = document.getElementById('id-card-avatar-img');
  const qrEl = document.getElementById('id-card-qr-img');
  const dateEl = document.getElementById('id-card-issue-date');

  const defaultEmail = isPM && cleanPhone ? `${cleanPhone}@alphastack.wwisvnr.com` : target;
  const resolvedContactName = lookupContactName(cleanPhone) || parsedName || (activeConversation && activeConversation.sender_name);
  let displayName = resolvedContactName || (isPM && cleanPhone ? `User ${cleanPhone.slice(-4)}` : target.split('@')[0]);

  if (nameEl) nameEl.innerText = displayName;
  if (phoneEl) phoneEl.innerText = formattedPhone;
  if (emailEl) emailEl.innerText = defaultEmail;
  if (aliasTagEl) aliasTagEl.innerText = 'Sub-ID: .primary';
  if (dateEl) dateEl.innerText = new Date().toISOString().split('T')[0];

  const avatarSvg = generateDefaultAvatar(target, displayName);
  const contactAvatarUrl = (typeof contactAvatarMap !== 'undefined' && contactAvatarMap[target]) ? contactAvatarMap[target] : avatarSvg;
  if (avatarEl) {
    avatarEl.innerHTML = `<img src="${contactAvatarUrl}" alt="${escapeHtml(displayName)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${avatarSvg}';">`;
    avatarEl.style.backgroundImage = 'none';
  }

  // Real dynamic QR code
  if (qrEl) {
    const qrData = encodeURIComponent(`mailto:${defaultEmail}?subject=INAI%20Contact`);
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}`;
  }

  // Pre-fill edit form inputs
  const editName = document.getElementById('edit-person-name');
  const editPhone = document.getElementById('edit-person-phone');
  const editEmail = document.getElementById('edit-person-email');
  const editAlias = document.getElementById('edit-person-alias');
  const editBio = document.getElementById('edit-person-bio');
  const editAvatarPrev = document.getElementById('edit-person-avatar-preview');

  if (editName) editName.value = displayName;
  if (editPhone) editPhone.value = formattedPhone || cleanPhone;
  if (editEmail) editEmail.value = defaultEmail;
  if (editAlias) editAlias.value = 'primary';
  if (editBio) editBio.value = '';
  if (editAvatarPrev) {
    editAvatarPrev.innerHTML = `<img src="${avatarSvg}" alt="${escapeHtml(displayName)}" class="avatar-inner-img">`;
    editAvatarPrev.style.backgroundImage = 'none';
  }

  // Fetch from server /api/contacts/detail/:phone
  try {
    const fetchPhone = cleanPhone || target;
    const res = await fetch(`/api/contacts/detail/${encodeURIComponent(fetchPhone)}`);
    const data = await res.json();
    if (data.contact) {
      const c = data.contact;
      const apiName = (c.display_name && !/^User\s*\d+/i.test(c.display_name)) ? c.display_name : null;
      const finalName = apiName || displayName;
      const finalEmail = c.email_address || c.email || defaultEmail;

      if (nameEl) nameEl.innerText = finalName;
      if (emailEl) emailEl.innerText = finalEmail;
      if (c.bio && editBio) editBio.value = c.bio;
      if (editName) editName.value = finalName;
      if (editEmail) editEmail.value = finalEmail;
      if (c.avatar_url && avatarEl) {
        avatarEl.innerHTML = `<img src="${c.avatar_url}" alt="${escapeHtml(finalName)}" class="avatar-inner-img">`;
      }
      if (c.avatar_url && editAvatarPrev) {
        editAvatarPrev.innerHTML = `<img src="${c.avatar_url}" alt="${escapeHtml(finalName)}" class="avatar-inner-img">`;
      }
    }
  } catch (err) {}

  modal.style.display = 'flex';
}

function closeDigitalIdModal(e) {
  if (e && e.target && e.target.id !== 'digital-id-modal' && !e.target.classList.contains('close-modal-btn')) return;
  const modal = document.getElementById('digital-id-modal');
  if (modal) modal.style.display = 'none';
  const card = document.getElementById('smart-mail-card');
  if (card) card.classList.remove('flipped');
}

function switchIdCardTab(tab) {
  if (tab === 'edit' && !activeContactModalIsSelf) {
    showToastNotification('You can only edit your own Digital ID profile.', 'warning');
    return;
  }
  const btnCard = document.getElementById('btn-id-tab-card');
  const btnEdit = document.getElementById('btn-id-tab-edit');
  const panelCard = document.getElementById('id-card-view-panel');
  const panelEdit = document.getElementById('id-card-edit-panel');

  if (tab === 'card') {
    if (btnCard) btnCard.classList.add('active');
    if (btnEdit) btnEdit.classList.remove('active');
    if (panelCard) panelCard.style.display = 'block';
    if (panelEdit) panelEdit.style.display = 'none';
  } else {
    if (btnCard) btnCard.classList.remove('active');
    if (btnEdit) btnEdit.classList.add('active');
    if (panelCard) panelCard.style.display = 'none';
    if (panelEdit) panelEdit.style.display = 'block';
  }
}

function flipSmartCard() {
  const card = document.getElementById('smart-mail-card');
  if (card) card.classList.toggle('flipped');
}

function selectPersonAvatarGradient(palette) {
  const target = activeContactForModal || (currentUser && currentUser.phone) || 'User';
  const preview = document.getElementById('edit-person-avatar-preview');
  const cardAvatar = document.getElementById('id-card-avatar-img');
  const newSvg = generateDefaultAvatar(`${target}_${palette}`, target);
  activeCustomAvatarDataUrl = newSvg;
  
  if (preview) {
    preview.innerHTML = `<img src="${newSvg}" alt="Avatar Preview" class="avatar-inner-img">`;
    preview.style.backgroundImage = 'none';
  }
  if (cardAvatar) {
    cardAvatar.innerHTML = `<img src="${newSvg}" alt="Avatar" class="avatar-inner-img">`;
    cardAvatar.style.backgroundImage = 'none';
  }
}

function handlePersonAvatarUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvt) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 120, 120);
      activeCustomAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      const preview = document.getElementById('edit-person-avatar-preview');
      const cardAvatar = document.getElementById('id-card-avatar-img');
      if (preview) {
        preview.innerHTML = `<img src="${activeCustomAvatarDataUrl}" alt="Avatar" class="avatar-inner-img">`;
      }
      if (cardAvatar) {
        cardAvatar.innerHTML = `<img src="${activeCustomAvatarDataUrl}" alt="Avatar" class="avatar-inner-img">`;
      }
    };
    img.src = loadEvt.target.result;
  };
  reader.readAsDataURL(file);
}

function resetPersonAvatarToDefault() {
  activeCustomAvatarDataUrl = '';
  const target = activeContactForModal || (currentUser && currentUser.phone) || 'User';
  const nameEl = document.getElementById('edit-person-name');
  const name = nameEl ? nameEl.value : target;
  const defaultSvg = generateDefaultAvatar(target, name);
  const preview = document.getElementById('edit-person-avatar-preview');
  const cardAvatar = document.getElementById('id-card-avatar-img');
  if (preview) preview.innerHTML = `<img src="${defaultSvg}" alt="Avatar" class="avatar-inner-img">`;
  if (cardAvatar) cardAvatar.innerHTML = `<img src="${defaultSvg}" alt="Avatar" class="avatar-inner-img">`;
}

async function savePersonInfoSubmit(e) {
  e.preventDefault();
  if (!activeContactModalIsSelf) {
    showToastNotification('You can only edit your own Digital ID profile.', 'warning');
    return;
  }
  const phone = (document.getElementById('edit-person-phone').value || '').trim();
  const displayName = (document.getElementById('edit-person-name').value || '').trim();
  const email = (document.getElementById('edit-person-email').value || '').trim();
  const subAlias = (document.getElementById('edit-person-alias').value || '').trim();
  const bio = (document.getElementById('edit-person-bio').value || '').trim();

  try {
    const res = await fetch('/api/contacts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_phone: (currentUser && currentUser.phone) || '',
        phone: phone || activeContactForModal,
        name: displayName,
        email: email,
        bio: bio,
        avatar_url: activeCustomAvatarDataUrl || undefined,
        alias_tag: subAlias
      })
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification('Contact info updated successfully! ✓', 'success');
      // Update ID card front text
      const nameEl = document.getElementById('id-card-name');
      if (nameEl) nameEl.innerText = displayName;
      const emailEl = document.getElementById('id-card-email');
      if (emailEl) emailEl.innerText = email;
      const aliasTag = document.getElementById('id-card-alias-tag');
      if (aliasTag && subAlias) aliasTag.innerText = `Sub-ID: .${subAlias}`;

      // Save name into local custom contact names map
      const cleanDigits = String(phone || activeContactForModal).replace(/\D/g, '').slice(-10);
      if (cleanDigits && displayName) {
        try {
          const customMap = JSON.parse(localStorage.getItem('inai_custom_contact_names') || '{}');
          customMap[cleanDigits] = displayName;
          localStorage.setItem('inai_custom_contact_names', JSON.stringify(customMap));
        } catch(e) {}
      }

      // Update in memory cached contacts
      const existingIdx = cachedContacts.findIndex(c => String(c.phone_number || c.phone || '').replace(/\D/g, '').slice(-10) === cleanDigits);
      if (existingIdx >= 0) {
        cachedContacts[existingIdx].display_name = displayName;
        cachedContacts[existingIdx].name = displayName;
      } else {
        cachedContacts.push({ phone_number: cleanDigits, display_name: displayName, email_address: email });
      }

      // Update in memory emails (both sender and recipient!) and re-render
      allEmails.forEach(em => {
        if (em.sender_email && (em.sender_email.includes(cleanDigits) || (email && em.sender_email.includes(email)))) {
          em.sender_name = displayName;
          if (activeCustomAvatarDataUrl) em.sender_avatar = activeCustomAvatarDataUrl;
        }
        let rList = [];
        try { rList = JSON.parse(em.recipient_emails || '[]'); } catch(_) { rList = [em.recipient_emails]; }
        if (rList.some(r => String(r).includes(cleanDigits) || (email && String(r).includes(email)))) {
          em.recipient_name = displayName;
        }
      });

      // Update active conversation title if same contact
      if (activeConversation) {
        activeConversation.display_title = displayName;
        if (activeCustomAvatarDataUrl) activeConversation.avatar_url = activeCustomAvatarDataUrl;
        const topTitle = document.getElementById('mob-conv-title');
        if (topTitle) topTitle.innerText = displayName;
      }
      renderEmailList(allEmails);
      switchIdCardTab('card');
    } else {
      showToastNotification(data.error || 'Failed to update contact', 'error');
    }
  } catch (err) {
    showToastNotification('Network error saving contact info', 'error');
  }
}

function copyIdCardEmail() {
  const emailEl = document.getElementById('id-card-email');
  if (!emailEl) return;
  const email = emailEl.innerText.trim();
  navigator.clipboard.writeText(email).then(() => {
    const btnText = document.getElementById('btn-copy-id-text');
    if (btnText) {
      btnText.innerText = 'Copied to Clipboard! ✓';
      setTimeout(() => { btnText.innerText = 'Copy Mail ID'; }, 2000);
    }
    showToastNotification('Mail ID copied to clipboard! 📋', 'success');
  }).catch(() => {
    showToastNotification(`Mail ID: ${email}`);
  });
}

function shareDigitalIdCard() {
  const emailEl = document.getElementById('id-card-email');
  const nameEl = document.getElementById('id-card-name');
  const email = emailEl ? emailEl.innerText.trim() : '';
  const name = nameEl ? nameEl.innerText.trim() : 'INAI User';

  if (navigator.share) {
    navigator.share({
      title: `${name}'s Official INAI ID`,
      text: `Connect with ${name} on INAI at: ${email}`,
      url: window.location.origin
    }).catch(() => {});
  } else {
    copyIdCardEmail();
  }
}

// ==================== MOBILE PROFILE & SETTINGS ====================
function openMobileProfileSettings() {
  if (!currentUser) return;
  const modal = document.getElementById('mobile-settings-modal');
  if (!modal) return;

  const phoneInput = document.getElementById('mob-settings-phone-input');
  const nameInput = document.getElementById('mob-settings-name-input');
  const emailInput = document.getElementById('mob-settings-email-input');
  const langSelect = document.getElementById('mob-settings-lang');

  const avatarEl = document.getElementById('mob-settings-avatar');
  const nameLabel = document.getElementById('mob-settings-name');
  const phoneLabel = document.getElementById('mob-settings-phone');

  const formattedPhone = formatPhoneDisplay(currentUser.phone);
  const myEmail = `${currentUser.phone}@alphastack.wwisvnr.com`;

  if (phoneInput) phoneInput.value = formattedPhone;
  if (nameInput) nameInput.value = currentUser.display_name || '';
  if (emailInput) emailInput.value = myEmail;
  if (nameLabel) nameLabel.innerText = currentUser.display_name || 'INAI User';
  if (phoneLabel) phoneLabel.innerText = formattedPhone;

  const myFallbackSvg = generateDefaultAvatar(currentUser.phone, currentUser.display_name || currentUser.name);
  const mySvg = currentUser.avatar_url || myFallbackSvg;
  if (avatarEl) {
    avatarEl.innerHTML = `<img src="${mySvg}" alt="User Avatar" class="avatar-inner-img" onerror="this.onerror=null; this.src='${myFallbackSvg}';">`;
    avatarEl.style.backgroundImage = 'none';
  }

  if (langSelect) langSelect.value = currentLanguage;

  const transLangSelect = document.getElementById('mob-settings-trans-lang');
  if (transLangSelect) transLangSelect.value = getSmartTranslationTarget();

  const autoTransToggle = document.getElementById('mob-auto-translate-toggle');
  if (autoTransToggle) autoTransToggle.checked = localStorage.getItem('inai_auto_translate_suggest') === 'true';

  initMobileReadReceipts();
  modal.style.display = 'flex';
}

function initMobileReadReceipts() {
  const saved = localStorage.getItem('phonemail_read_receipts');
  const isEnabled = saved === null ? true : saved === 'true';
  const toggle = document.getElementById('mob-read-receipts-toggle');
  if (toggle) toggle.checked = isEnabled;
  if (currentUser && currentUser.phone) {
    fetch(`/api/settings/read-receipts?phone=${encodeURIComponent(currentUser.phone)}`)
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.enabled === 'boolean') {
          if (toggle) toggle.checked = d.enabled;
          localStorage.setItem('phonemail_read_receipts', d.enabled ? 'true' : 'false');
        }
      })
      .catch(() => {});
  }
}

function toggleMobileReadReceipts(checked) {
  localStorage.setItem('phonemail_read_receipts', checked ? 'true' : 'false');
  if (currentUser && currentUser.phone) {
    fetch('/api/settings/read-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: currentUser.phone, enabled: checked })
    }).catch(() => {});
  }
  showToastNotification(`Read Receipts ${checked ? 'Turned ON' : 'Turned OFF'}`, 'success');
}

function closeMobileProfileSettings() {
  const modal = document.getElementById('mobile-settings-modal');
  if (modal) modal.style.display = 'none';
}

async function saveMobileSettings() {
  const nameInput = document.getElementById('mob-settings-name-input');
  const langSelect = document.getElementById('mob-settings-lang');

  const newName = nameInput ? nameInput.value.trim() : '';
  const newLang = langSelect ? langSelect.value : 'en';

  try {
    await fetch('/api/contacts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: currentUser.phone,
        display_name: newName,
        language: newLang
      })
    });

    currentUser.display_name = newName;
    localStorage.setItem('inai_user_name', newName);

    if (newLang !== currentLanguage) {
      setInaiLanguage(newLang);
    }

    const drawerName = document.getElementById('drawer-username');
    if (drawerName) drawerName.innerText = newName || currentUser.phone;

    showToastNotification('Settings saved successfully! ✓', 'success');
    closeMobileProfileSettings();
  } catch (err) {
    showToastNotification('Failed to update settings', 'error');
  }
}

// Helpers for reading pane star and delete
function toggleCurrentStar() {
  if (!activeConversation || !activeConversation.latestMessage) return;
  toggleStar(activeConversation.latestMessage.id);
}

function toggleCurrentImportant() {
  if (!activeConversation || !activeConversation.latestMessage) return;
  toggleImportant(activeConversation.latestMessage.id);
}

function deleteCurrentEmail() {
  if (!activeConversation) return;
  activeConversation.messages.forEach(m => {
    executeBulkActionOnSingle(m.id, 'delete');
  });
  closeReadingPane();
}

function archiveCurrentEmail() {
  if (!activeConversation) return;
  activeConversation.messages.forEach(m => {
    executeBulkActionOnSingle(m.id, 'archive');
  });
  closeReadingPane();
}

function insertEmojiQuick(emoji) {
  const input = document.getElementById('mob-chat-input');
  if (!input) return;
  input.value += emoji;
  input.focus();
}

function openAttachmentPickerModal() {
  showToastNotification('Direct document & media attachments ready 📎', 'info');
}

// ==================== REAL-TIME MULTI-LANGUAGE TRANSLATION ====================
const INAI_TRANSLATIONS = {
  en: {
    all_mail: 'All Mail',
    inbox: 'Inbox',
    important: 'Important',
    starred: 'Starred',
    sent: 'Sent',
    drafts: 'Drafts',
    archive: 'Archive',
    spam: 'Spam',
    trash: 'Trash',
    mailboxes: 'MAILBOXES',
    source_all: 'All Mail',
    source_inai: 'INAI Network',
    source_external: 'External (Gmail...)',
    search_hint: 'Search phone numbers, contacts, subjects...'
  },
  hi: {
    all_mail: 'सभी मेल',
    inbox: 'इनबॉक्स',
    important: 'महत्वपूर्ण',
    starred: 'तारांकित',
    sent: 'भेजे गए',
    drafts: 'ड्राफ्ट',
    archive: 'संग्रह',
    spam: 'स्पैम',
    trash: 'कचरा',
    mailboxes: 'मेल संदूक',
    source_all: 'सभी मेल',
    source_inai: 'INAI नेटवर्क',
    source_external: 'बाहरी मेल (Gmail...)',
    search_hint: 'फोन नंबर, संपर्क, विषय खोजें...'
  },
  ta: {
    all_mail: 'அனைத்து அஞ்சல்',
    inbox: 'இன்பாக்ஸ்',
    important: 'முக்கியமானவை',
    starred: 'நட்சத்திரமிட்டவை',
    sent: 'அனுப்பியவை',
    drafts: 'வரைவுகள்',
    archive: 'காப்பகம்',
    spam: 'ஸ்பேம்',
    trash: 'குப்பை',
    mailboxes: 'அஞ்சல் பெட்டிகள்',
    source_all: 'அனைத்து அஞ்சல்',
    source_inai: 'INAI பிணையம்',
    source_external: 'வெளிப்புறம் (Gmail...)',
    search_hint: 'எண்கள், முகவரிகளைத் தேடுங்கள்...'
  },
  te: {
    all_mail: 'అన్ని మెయిళ్ళు',
    inbox: 'ఇన్‌బాక్స్',
    important: 'ముఖ్యమైనవి',
    starred: 'స్టార్ చేసినవి',
    sent: 'పంపినవి',
    drafts: 'డ్రాఫ్టులు',
    archive: 'ఆర్కైవ్',
    spam: 'స్పామ్',
    trash: 'ట్రాష్',
    mailboxes: 'మెయిల్‌బాక్స్‌లు',
    source_all: 'అన్ని మెయిళ్ళు',
    source_inai: 'INAI నెట్‌వర్క్',
    source_external: 'బాహ్య (Gmail...)',
    search_hint: 'నంబర్లు, విషయాలను వెతకండి...'
  },
  kn: {
    all_mail: 'ಎಲ್ಲಾ ಮೇಲ್',
    inbox: 'ಇನ್‌ಬಾಕ್ಸ್',
    important: 'ಮುಖ್ಯವಾದವು',
    starred: 'ಸ್ಟಾರ್ ಮಾಡಿದವು',
    sent: 'ಕಳುಹಿಸಿದವು',
    drafts: 'ಕರಡುಗಳು',
    archive: 'ಆರ್ಕೈವ್',
    spam: 'ಸ್ಪ್ಯಾಮ್',
    trash: 'ಕಸದಬುಟ್ಟಿ',
    mailboxes: 'ಮೇಲ್‌ಬಾಕ್ಸ್‌ಗಳು',
    source_all: 'ಎಲ್ಲಾ ಮೇಲ್',
    source_inai: 'INAI ನೆಟ್‌ವರ್ಕ್',
    source_external: 'ಬಾಹ್ಯ (Gmail...)',
    search_hint: 'ಸಂಖ್ಯೆ, ವಿಷಯಗಳನ್ನು ಹುಡುಕಿ...'
  },
  bn: {
    all_mail: 'সব ইমেল',
    inbox: 'ইনবক্স',
    important: 'গুরুত্বপূর্ণ',
    starred: 'তারকাচিহ্নিত',
    sent: 'প্রেরিত',
    drafts: 'খসড়া',
    archive: 'সংরক্ষণাগার',
    spam: 'স্প্যাম',
    trash: 'ট্র্যাশ',
    mailboxes: 'মেলবক্স',
    source_all: 'সব ইমেল',
    source_inai: 'INAI নেটওয়ার্ক',
    source_external: 'বাহ্যিক (Gmail...)',
    search_hint: 'নম্বর, বিষয় অনুসন্ধান করুন...'
  },
  es: {
    all_mail: 'Todo el correo',
    inbox: 'Recibidos',
    important: 'Importante',
    starred: 'Destacados',
    sent: 'Enviados',
    drafts: 'Borradores',
    archive: 'Archivados',
    spam: 'Spam',
    trash: 'Papelera',
    mailboxes: 'BUZONES',
    source_all: 'Todo el correo',
    source_inai: 'Red INAI',
    source_external: 'Externo (Gmail...)',
    search_hint: 'Buscar números, contactos, asuntos...'
  }
};

function toggleMobLangMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('mob-lang-menu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

function setInaiLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('inai_lang', lang);

  const langCodeEl = document.getElementById('mob-current-lang-code');
  if (langCodeEl) langCodeEl.innerText = lang.toUpperCase();

  const menu = document.getElementById('mob-lang-menu');
  if (menu) menu.style.display = 'none';

  applyInaiLanguage();
  showToastNotification(`Language set to ${lang.toUpperCase()} 🌐`);
}

function applyInaiLanguage() {
  const t = INAI_TRANSLATIONS[currentLanguage] || INAI_TRANSLATIONS.en;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.innerText = t[key];
  });

  const searchInput = document.getElementById('chat-search');
  if (searchInput && t.search_hint) searchInput.placeholder = t.search_hint;

  const titleEl = document.getElementById('mob-folder-title');
  if (titleEl) titleEl.innerText = getFolderFriendlyName(currentFolder);
}

window.addEventListener('click', (e) => {
  const langMenu = document.getElementById('mob-lang-menu');
  if (langMenu && !e.target.closest('.lang-dropdown-wrapper')) {
    langMenu.style.display = 'none';
  }
});

// AI Translation in Reading Pane
async function toggleMessageTranslation() {
  if (!activeEmail) return;

  const bodyEl = document.getElementById('mob-read-body');
  const subjEl = document.getElementById('mob-read-subject');
  if (!bodyEl || !subjEl) return;

  if (isMessageTranslated) {
    subjEl.innerText = originalMessageSubject;
    bodyEl.innerHTML = originalMessageBody;
    isMessageTranslated = false;
    showToastNotification('Original message restored', 'info');
    return;
  }

  const targetLang = getSmartTranslationTarget() || (currentLanguage === 'en' ? 'hi' : currentLanguage);
  showToastNotification(`Translating to ${targetLang.toUpperCase()}...`, 'info');

  try {
    const plainText = (activeEmail.body_text || bodyEl.innerText || '').trim();
    const cleanSubj = activeEmail.subject || '';

    const [subjRes, bodyRes] = await Promise.all([
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanSubj, targetLang })
      }).then(r => r.json()).catch(() => null),
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: plainText, targetLang })
      }).then(r => r.json()).catch(() => null)
    ]);

    const translatedSubject = (subjRes && subjRes.translatedText) ? subjRes.translatedText : cleanSubj;
    const translatedBody = (bodyRes && bodyRes.translatedText) ? bodyRes.translatedText.replace(/\n/g, '<br>') : plainText.replace(/\n/g, '<br>');

    subjEl.innerHTML = `<span style="font-size:11px; background: rgba(4,106,56,0.12); color: var(--green-main); padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-right: 6px;">AI ${targetLang.toUpperCase()}</span> ` + escapeHtml(translatedSubject);
    bodyEl.innerHTML = `
      <div style="padding: 8px 12px; background: rgba(4,106,56,0.06); border-left: 3px solid var(--green-main); border-radius: 6px; margin-bottom: 12px; font-size: 11.5px; color: var(--green-main); font-weight: 600;">
        ⚡ Real-time AI Translation (${targetLang.toUpperCase()})
      </div>
      <div>${translatedBody}</div>
    `;

    isMessageTranslated = true;
    showToastNotification(`Translated message to ${targetLang.toUpperCase()} ✓`, 'success');
  } catch (err) {
    showToastNotification('Translation failed, showing original', 'warning');
  }
}


// ==================== COMPOSE & STANDALONE AUTO-CONTACT FETCH ====================
async function fetchContactsSilently() {
  if (!currentUser || !currentUser.phone) return;
  try {
    const res = await fetch(`/api/contacts?phone=${encodeURIComponent(currentUser.phone)}`);
    const data = await res.json();
    cachedContacts = data.contacts || [];
  } catch (err) {}
}

async function verifyAndRenderRecipientStatus(val, pillElementId) {
  const container = document.getElementById(pillElementId);
  if (!container) return;

  const raw = String(val || '').trim();
  if (!raw) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // 1. External email address (e.g. soumithjv2@gmail.com, user@yahoo.in)
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
  const isInternalDomain = raw.toLowerCase().includes('alphastack.wwisvnr.com') || raw.toLowerCase().includes('phonemail.com');

  if (isEmail && !isInternalDomain) {
    container.style.display = 'flex';
    container.innerHTML = `
      <div class="verify-chip verified-external">
        <svg class="verify-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>Verified External Email: <strong>${escapeHtml(raw)}</strong> &bull; Ready via Secure Hostinger SMTP Outbound</span>
      </div>
    `;
    return;
  }

  // 2. Phone number or internal INAI address
  const cleanPhone = raw.replace(/\D/g, '').slice(-10);
  if (cleanPhone.length === 10) {
    const formatted = `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`;
    let contactName = lookupContactName(cleanPhone);

    container.style.display = 'flex';
    container.innerHTML = `
      <div class="verify-chip verified-inai">
        <svg class="verify-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Verifying INAI Member status...</span>
      </div>
    `;

    try {
      const res = await fetch('/api/contacts/filter-phonemail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumbers: [cleanPhone] })
      });
      const data = await res.json();
      const isRegistered = data.registeredContacts && data.registeredContacts.length > 0;
      const regUser = isRegistered ? data.registeredContacts[0] : null;
      if (regUser && regUser.display_name && !/^User\s*\d+/i.test(regUser.display_name)) {
        contactName = regUser.display_name;
      }

      if (isRegistered) {
        container.innerHTML = `
          <div class="verify-chip verified-inai">
            <svg class="verify-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Verified INAI Network Member: ${contactName ? `<strong>${escapeHtml(contactName)}</strong> ` : ''}(${formatted}) &bull; Instant Delivery</span>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="verify-chip unreg-inai">
            <div class="unreg-header-line">
              <svg class="verify-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>Recipient ${contactName ? `<strong>${escapeHtml(contactName)}</strong> ` : ''}(${formatted}) is <strong>not registered on INAI</strong></span>
            </div>
            <div class="unreg-sms-row">
              <label class="unreg-sms-label" title="Send SMS message preview & invite link via TextBee">
                <input type="checkbox" id="mob-send-textbee-sms" checked>
                <span>Send SMS preview & invitation via <strong>TextBee</strong> 📱</span>
              </label>
              <span class="textbee-badge-tag">TextBee SMS</span>
            </div>
          </div>
        `;
      }
    } catch (e) {
      container.innerHTML = `
        <div class="verify-chip unreg-inai">
          <div class="unreg-header-line">
            <svg class="verify-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Recipient: ${contactName ? `<strong>${escapeHtml(contactName)}</strong> ` : ''}(${formatted}) &bull; Not on INAI</span>
          </div>
          <div class="unreg-sms-row">
            <label class="unreg-sms-label">
              <input type="checkbox" id="mob-send-textbee-sms" checked>
              <span>Send SMS preview & invitation via <strong>TextBee</strong> 📱</span>
            </label>
            <span class="textbee-badge-tag">TextBee</span>
          </div>
        </div>
      `;
    }
    return;
  }

  container.style.display = 'none';
  container.innerHTML = '';
}

function openTraditionalCompose(recipient = '', subject = '', body = '') {
  document.getElementById('trad-to').value = recipient;
  document.getElementById('trad-subject').value = subject;
  document.getElementById('trad-body').value = body;
  document.getElementById('traditional-modal').style.display = 'flex';

  const verifyPill = document.getElementById('mob-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }
  if (recipient) {
    verifyAndRenderRecipientStatus(recipient, 'mob-recipient-verify-pill');
  }

  setupContactsAutocomplete();
}

function closeTraditionalCompose() {
  document.getElementById('traditional-modal').style.display = 'none';
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
  const verifyPill = document.getElementById('mob-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }
}

function openReplyCompose(isForward = false) {
  if (!activeEmail) return;
  const isSentByMe = Boolean(activeEmail.sender_email && currentUser && activeEmail.sender_email.includes(currentUser.phone));
  const to = isForward ? '' : (isSentByMe ? (activeEmail.recipient_phone || '') : activeEmail.sender_email);
  const subj = isForward ? `Fwd: ${activeEmail.subject || ''}` : `Re: ${activeEmail.subject || ''}`;
  const quoted = `\n\n--- On ${new Date(activeEmail.created_at).toLocaleString()}, ${activeEmail.sender_email} wrote ---\n${activeEmail.body_text || ''}`;
  openTraditionalCompose(to, subj, quoted);
}

let mobVerifyDebounce = null;
function setupContactsAutocomplete() {
  const input = document.getElementById('trad-to');
  const picker = document.getElementById('mobile-contacts-picker');
  if (!input || !picker) return;

  input.oninput = () => {
    const val = input.value.trim();
    if (mobVerifyDebounce) clearTimeout(mobVerifyDebounce);
    mobVerifyDebounce = setTimeout(() => verifyAndRenderRecipientStatus(val, 'mob-recipient-verify-pill'), 180);

    const q = val.toLowerCase();
    if (!q || cachedContacts.length === 0) {
      picker.style.display = 'none';
      return;
    }

    const matches = cachedContacts.filter(c => 
      ((c.name || c.display_name) && (c.name || c.display_name).toLowerCase().includes(q)) || 
      (c.phone && c.phone.includes(q)) ||
      (c.phone_number && c.phone_number.includes(q)) ||
      ((c.email || c.email_address) && (c.email || c.email_address).toLowerCase().includes(q))
    ).slice(0, 5);

    if (matches.length === 0) {
      picker.style.display = 'none';
      return;
    }

    picker.innerHTML = matches.map(c => {
      const p = c.phone || c.phone_number || '';
      const em = c.email || c.email_address || '';
      const targetVal = p || em;
      const dName = c.name || c.display_name || p || em;
      return `
      <div class="contact-picker-item" onclick="selectContactRecipient('${escapeHtml(targetVal)}')">
        <div>
          <strong style="color: var(--text-main);">${escapeHtml(dName)}</strong>
          <div style="font-size: 11px; color: var(--text-dim);">${formatPhoneDisplay(p || '')} ${em ? `&bull; ${escapeHtml(em)}` : ''}</div>
        </div>
        <span class="badge-source-tag badge-phonemail-pill">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>INAI</span>
        </span>
      </div>
    `}).join('');

    picker.style.display = 'block';
  };
}

function selectContactRecipient(recipient) {
  const input = document.getElementById('trad-to');
  if (input) {
    input.value = recipient;
    verifyAndRenderRecipientStatus(recipient, 'mob-recipient-verify-pill');
  }
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
}

async function submitTraditionalCompose() {
  const to = (document.getElementById('trad-to').value || '').trim();
  const subject = (document.getElementById('trad-subject').value || '').trim();
  const body = (document.getElementById('trad-body').value || '').trim();

  if (!to) {
    showToastNotification('Please enter a recipient', 'warning');
    return;
  }
  if (!body) {
    showToastNotification('Please enter a message', 'warning');
    return;
  }

  const sendSms = Boolean(document.getElementById('mob-send-textbee-sms')?.checked);

  showToastNotification('Sending message...', 'info');

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_phone: currentUser.phone,
        to,
        subject,
        body,
        send_sms: sendSms
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.sms_dispatched) {
        showToastNotification('Message sent! Recipient notified via TextBee SMS 📱', 'success');
      } else {
        showToastNotification('Message sent successfully! 🚀', 'success');
      }
      closeTraditionalCompose();
      // Invalidate cache and reload
      emailFolderCache = {};
      loadEmails(currentFolder);
    } else {
      showToastNotification(data.error || 'Failed to send message', 'error');
    }
  } catch (err) {
    showToastNotification('Failed to send message', 'error');
  }
}

// ==================== DATE FILTER MODAL & HANDLERS ====================
function openDateFilterModal() {
  const modal = document.getElementById('mob-date-filter-modal');
  if (modal) modal.style.display = 'flex';
  updateDateFilterUI();
}

function closeDateFilterModal(e) {
  if (e && e.target && e.target.closest('.modal-card') && !e.target.classList.contains('close-modal-btn')) return;
  const modal = document.getElementById('mob-date-filter-modal');
  if (modal) modal.style.display = 'none';
}

function selectDatePreset(preset) {
  activeDateFilter = preset;
  updateDateFilterUI();
  closeDateFilterModal();
  renderEmailList(allEmails);
  showToastNotification(`Filtered by: ${getDatePresetLabel(preset)}`, 'info');
}

function applyCustomDateFilter() {
  const startEl = document.getElementById('mob-custom-date-start');
  const endEl = document.getElementById('mob-custom-date-end');
  const startVal = startEl ? startEl.value : '';
  const endVal = endEl ? endEl.value : '';

  if (!startVal && !endVal) {
    showToastNotification('Please select a start or end date', 'warning');
    return;
  }

  activeDateFilter = 'custom';
  customDateStart = startVal;
  customDateEnd = endVal;
  updateDateFilterUI();
  closeDateFilterModal();
  renderEmailList(allEmails);
  showToastNotification('Custom date filter applied ✓', 'success');
}

function getDatePresetLabel(p) {
  switch (p) {
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'week': return 'Last 7 Days';
    case 'month': return 'Last 30 Days';
    case 'custom': return 'Custom Range';
    default: return 'All Dates';
  }
}

function updateDateFilterUI() {
  // Update modal active button
  ['all', 'today', 'yesterday', 'week', 'month'].forEach(p => {
    const btn = document.getElementById(`btn-date-${p}`);
    if (btn) {
      if (activeDateFilter === p) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  // Update quick filter pill
  const pill = document.getElementById('pill-filter-date');
  const pillText = document.getElementById('pill-date-text');
  const pillBadge = document.getElementById('badge-date-active');

  if (pill && pillText) {
    if (activeDateFilter === 'all') {
      pillText.innerText = 'Date';
      pill.classList.remove('active', 'active-date');
      if (pillBadge) pillBadge.style.display = 'none';
    } else {
      pillText.innerText = getDatePresetLabel(activeDateFilter);
      pill.classList.add('active', 'active-date');
      if (pillBadge) pillBadge.style.display = 'inline-block';
    }
  }
}

function isDateInFilter(dateVal) {
  if (activeDateFilter === 'all') return true;
  if (!dateVal) return false;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000;
  const t = d.getTime();

  if (activeDateFilter === 'today') {
    return t >= startOfToday && t < endOfToday;
  }
  if (activeDateFilter === 'yesterday') {
    const startOfYesterday = startOfToday - 86400000;
    return t >= startOfYesterday && t < startOfToday;
  }
  if (activeDateFilter === 'week') {
    const startOfWeek = startOfToday - 7 * 86400000;
    return t >= startOfWeek;
  }
  if (activeDateFilter === 'month') {
    const startOfMonth = startOfToday - 30 * 86400000;
    return t >= startOfMonth;
  }
  if (activeDateFilter === 'custom') {
    if (customDateStart) {
      const cStart = new Date(customDateStart).getTime();
      if (t < cStart) return false;
    }
    if (customDateEnd) {
      const cEnd = new Date(customDateEnd).getTime() + 86400000;
      if (t >= cEnd) return false;
    }
    return true;
  }
  return true;
}

// ==================== SMART LANGUAGE TRANSLATION & PREFERENCES ====================
function setSmartTranslationTarget(lang) {
  localStorage.setItem('inai_trans_target_lang', lang || 'en');
  showToastNotification(`Default translation target set to ${(lang || 'en').toUpperCase()} ✓`, 'info');
}

function getSmartTranslationTarget() {
  return localStorage.getItem('inai_trans_target_lang') || 'en';
}

function toggleAutoTranslatePreference(checked) {
  localStorage.setItem('inai_auto_translate_suggest', checked ? 'true' : 'false');
  showToastNotification(`Smart translation suggestions ${checked ? 'enabled' : 'disabled'}`, 'info');
}

async function triggerSmartTranslateDraft(context) {
  const isChat = context === 'chat';
  const inputEl = isChat ? document.getElementById('mob-chat-input') : document.getElementById('trad-body');
  const previewWrap = isChat ? document.getElementById('mob-chat-trans-preview-wrap') : document.getElementById('mob-trad-trans-preview-wrap');

  if (!inputEl || !previewWrap) return;
  const text = inputEl.value.trim();
  if (!text) {
    showToastNotification('Please type your draft message first', 'info');
    return;
  }

  const targetLang = getSmartTranslationTarget();
  previewWrap.style.display = 'block';
  previewWrap.innerHTML = `
    <div class="smart-trans-preview-card">
      <div style="padding: 12px; text-align: center; color: var(--text-dim); font-size: 12px;">
        ⚡ Translating draft with AI to ${targetLang.toUpperCase()}...
      </div>
    </div>
  `;

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        targetLang: targetLang,
        sourceLang: 'auto'
      })
    });
    const data = await res.json();
    if (!data.success && !data.translatedText) {
      throw new Error(data.error || 'Translation failed');
    }

    smartDraftTranslation = {
      context,
      originalText: text,
      translatedText: data.translatedText || text,
      targetLang: data.targetLang || targetLang,
      detectedSourceLang: data.detectedSourceLang || 'auto'
    };

    previewWrap.innerHTML = `
      <div class="smart-trans-preview-card">
        <div class="smart-trans-header">
          <div class="smart-trans-title">
            <span class="tiranga-tag-mini">AI SMART TRANSLATION</span>
            <span>Preview before sending</span>
          </div>
          <button type="button" class="smart-trans-close" onclick="closeDraftTransPreview('${context}')" title="Close Preview">✕</button>
        </div>
        <div class="smart-trans-content">
          <div class="smart-trans-box original">
            <div class="smart-trans-label">ORIGINAL (${(data.detectedSourceLang || 'DETECTED').toUpperCase()})</div>
            <div class="smart-trans-text">${escapeHtml(text)}</div>
          </div>
          <div class="smart-trans-arrow">↓</div>
          <div class="smart-trans-box translated">
            <div class="smart-trans-label">TRANSLATED (${(data.targetLang || targetLang).toUpperCase()})</div>
            <div class="smart-trans-text">${escapeHtml(data.translatedText || text)}</div>
          </div>
        </div>
        <div class="smart-trans-actions">
          <button type="button" class="smart-trans-btn btn-send-trans" onclick="sendTranslatedDraft('${context}', 'translated')">
            Send Translated ✓
          </button>
          <button type="button" class="smart-trans-btn btn-send-both" onclick="sendTranslatedDraft('${context}', 'both')">
            Send Both (Original + Translation)
          </button>
          <button type="button" class="smart-trans-btn btn-apply-text" onclick="applyTranslatedDraftToEditor('${context}')">
            Insert in Editor
          </button>
        </div>
      </div>
    `;
  } catch (err) {
    previewWrap.innerHTML = `
      <div class="smart-trans-preview-card" style="padding: 10px 14px; font-size: 12px; color: #ef4444; display: flex; align-items: center; justify-content: space-between;">
        <span>Translation temporarily unavailable. Original text preserved.</span>
        <button type="button" class="smart-trans-close" onclick="closeDraftTransPreview('${context}')">✕</button>
      </div>
    `;
  }
}

function closeDraftTransPreview(context) {
  const isChat = context === 'chat';
  const previewWrap = isChat ? document.getElementById('mob-chat-trans-preview-wrap') : document.getElementById('mob-trad-trans-preview-wrap');
  if (previewWrap) {
    previewWrap.style.display = 'none';
    previewWrap.innerHTML = '';
  }
  smartDraftTranslation = null;
}

function applyTranslatedDraftToEditor(context) {
  if (!smartDraftTranslation) return;
  const isChat = context === 'chat';
  const inputEl = isChat ? document.getElementById('mob-chat-input') : document.getElementById('trad-body');
  if (inputEl) {
    inputEl.value = smartDraftTranslation.translatedText;
    if (isChat) autoExpandChatInput(inputEl);
  }
  closeDraftTransPreview(context);
  showToastNotification('Translation inserted into draft ✓', 'success');
}

async function sendTranslatedDraft(context, mode) {
  if (!smartDraftTranslation) return;
  const isChat = context === 'chat';
  const inputEl = isChat ? document.getElementById('mob-chat-input') : document.getElementById('trad-body');
  if (!inputEl) return;

  let finalBody = '';
  if (mode === 'translated') {
    finalBody = smartDraftTranslation.translatedText;
  } else if (mode === 'both') {
    finalBody = `${smartDraftTranslation.originalText}\n\n---\n[Translated to ${smartDraftTranslation.targetLang.toUpperCase()}]:\n${smartDraftTranslation.translatedText}`;
  } else {
    finalBody = smartDraftTranslation.originalText;
  }

  inputEl.value = finalBody;
  closeDraftTransPreview(context);

  if (isChat) {
    submitChatMessage();
  } else {
    submitTraditionalCompose();
  }
}

// ==================== FEATURE 1: FIND FRIENDS ON INAI ====================
function openFindFriendsModal() {
  const modal = document.getElementById('find-friends-modal');
  if (modal) modal.style.display = 'flex';
  const input = document.getElementById('find-friends-manual-input');
  if (input) input.value = '';
}

function closeFindFriendsModal(e) {
  if (e && e.target && e.target.closest('.modal-card') && !e.target.classList.contains('close-modal-btn')) return;
  const modal = document.getElementById('find-friends-modal');
  if (modal) modal.style.display = 'none';
}

async function selectDeviceContactsForFriends() {
  if ('contacts' in navigator && 'ContactsManager' in window) {
    try {
      const props = ['name', 'tel'];
      const opts = { multiple: true };
      const selected = await navigator.contacts.select(props, opts);
      if (selected && selected.length > 0) {
        processSelectedContactsForFriends(selected);
      }
    } catch (err) {
      console.warn('Contact picker cancelled or failed:', err);
      showToastNotification('Could not access contacts. You can enter phone numbers below.', 'info');
    }
  } else {
    showToastNotification('Native contact picker is not supported on this browser. Please enter phone number(s) below.', 'info');
    const input = document.getElementById('find-friends-manual-input');
    if (input) input.focus();
  }
}

async function checkManualFriendsInput() {
  const input = document.getElementById('find-friends-manual-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToastNotification('Please enter at least one phone number', 'warning');
    return;
  }

  const tokens = val.split(/[,;\n\s]+/).filter(Boolean);
  const candidates = [];
  tokens.forEach(tok => {
    const clean = tok.replace(/\D/g, '').slice(-10);
    if (clean.length === 10) {
      candidates.push({
        name: '',
        rawPhone: tok,
        cleanPhone: clean
      });
    }
  });

  if (candidates.length === 0) {
    showToastNotification('Please enter valid 10-digit mobile numbers', 'warning');
    return;
  }

  await queryAndRenderFriends(candidates);
}

async function processSelectedContactsForFriends(deviceContacts) {
  const candidates = [];
  deviceContacts.forEach(c => {
    const name = Array.isArray(c.name) ? c.name[0] : (c.name || '');
    const phones = Array.isArray(c.tel) ? c.tel : [c.tel];
    phones.forEach(p => {
      if (!p) return;
      const clean = String(p).replace(/\D/g, '').slice(-10);
      if (clean.length === 10) {
        candidates.push({
          name: name,
          rawPhone: p,
          cleanPhone: clean
        });
      }
    });
  });

  if (candidates.length === 0) {
    showToastNotification('No valid 10-digit phone numbers found in selected contacts', 'warning');
    return;
  }

  await queryAndRenderFriends(candidates);
}

async function queryAndRenderFriends(candidates) {
  const resultsContainer = document.getElementById('find-friends-results');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div style="text-align: center; padding: 25px 10px; color: var(--text-dim);">
      <div style="margin-bottom: 8px;">🔍 Checking INAI network...</div>
      <div style="font-size: 11.5px;">Verifying contacts on PhoneMail infrastructure</div>
    </div>
  `;

  // Deduplicate by cleanPhone
  const uniqueMap = new Map();
  candidates.forEach(c => {
    if (!uniqueMap.has(c.cleanPhone)) {
      uniqueMap.set(c.cleanPhone, c);
    }
  });
  const uniqueCandidates = Array.from(uniqueMap.values());
  const phoneNumbers = uniqueCandidates.map(c => c.cleanPhone);

  try {
    const res = await fetch('/api/contacts/filter-phonemail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumbers })
    });
    const data = await res.json();
    const registeredList = data.registeredContacts || [];
    const registeredMap = new Map(registeredList.map(r => [r.phone_number, r]));

    // Render results with exact requested UI format
    let html = '';
    uniqueCandidates.forEach(cand => {
      const isRegistered = registeredMap.has(cand.cleanPhone);
      const regUser = isRegistered ? registeredMap.get(cand.cleanPhone) : null;
      const displayName = (regUser && regUser.display_name) || cand.name || `User ${cand.cleanPhone}`;
      const formattedPhone = `+91 ${cand.cleanPhone.substring(0, 5)} ${cand.cleanPhone.substring(5)}`;

      if (isRegistered) {
        html += `
          <div class="friend-result-card on-inai">
            <div class="friend-info">
              <div class="friend-name-row">
                <span class="friend-name">${escapeHtml(displayName)}</span>
              </div>
              <div class="friend-phone">${escapeHtml(formattedPhone)}</div>
              <div class="friend-status-row" style="margin-top: 3px;">
                <span class="friend-badge inai">🟢 On INAI</span>
              </div>
            </div>
            <div class="friend-action-wrap">
              <button type="button" class="friend-action-btn message-btn" onclick="messageInaiContact('${cand.cleanPhone}', '${escapeHtml(displayName)}')">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>Message</span>
              </button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="friend-result-card not-on-inai">
            <div class="friend-info">
              <div class="friend-name-row">
                <span class="friend-name">${escapeHtml(displayName)}</span>
              </div>
              <div class="friend-phone">${escapeHtml(formattedPhone)}</div>
              <div class="friend-status-row" style="margin-top: 3px;">
                <span class="friend-badge not-inai">⚪ Not on INAI</span>
              </div>
            </div>
            <div class="friend-action-wrap">
              <button type="button" class="friend-action-btn invite-btn" onclick="inviteFriend('${escapeHtml(displayName)}', '${cand.cleanPhone}')">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Invite</span>
              </button>
            </div>
          </div>
        `;
      }
    });

    resultsContainer.innerHTML = html;
  } catch (err) {
    resultsContainer.innerHTML = `
      <div style="text-align: center; color: #ef4444; padding: 20px 10px;">
        Failed to check contacts. Please try again.
      </div>
    `;
  }
}

function messageInaiContact(phone, displayName) {
  closeFindFriendsModal();
  // Check if conversation already exists
  const existingConv = allConversations.find(c => {
    return (c.participant_raw && c.participant_raw.includes(phone)) ||
           (c.key && c.key.includes(phone)) ||
           (c.participant_phone === phone);
  });

  if (existingConv) {
    openConversation(existingConv.id);
    showToastNotification(`Opened conversation with ${displayName} ✓`, 'success');
  } else {
    // Open traditional compose prefilled with recipient
    const tradTo = document.getElementById('trad-to');
    if (tradTo) {
      tradTo.value = `${phone}@alphastack.wwisvnr.com`;
    }
    const tradSubj = document.getElementById('trad-subject');
    if (tradSubj) tradSubj.value = 'Hello via INAI';
    openTraditionalCompose();
    showToastNotification(`New conversation with ${displayName} ✓`, 'success');
  }
}

function inviteFriend(name, phone) {
  const inviteText = `Hey ${name || 'there'}! I'm using INAI (PhoneMail) for instant, secure communication by phone number. Join me at ${window.location.origin}/mobile/`;
  if (navigator.share) {
    navigator.share({
      title: 'Join me on INAI',
      text: inviteText,
      url: `${window.location.origin}/mobile/`
    }).catch(() => {});
  } else {
    const waUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(inviteText)}`;
    window.open(waUrl, '_blank');
  }
  showToastNotification(`Invitation prepared for ${name || phone} ✓`, 'info');
}

// Delegated click listener to open email images in fullscreen lightbox
document.addEventListener('click', (e) => {
  const img = e.target.closest('.trad-email-body-content img, .email-body-html-wrap img, .chat-message-text img, .email-attached-image-wrap img');
  if (img && img.src && !img.closest('#mob-image-lightbox')) {
    e.stopPropagation();
    openImageLightbox(img.src, img.alt);
  }
});

// ==================== INITIALIZATION ====================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    restoreSession();
    loadPhoneEmailScript();
  });
} else {
  restoreSession();
  loadPhoneEmailScript();
}
