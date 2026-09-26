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
let activeTradEmail = null;
let mobileInboxMode = localStorage.getItem('mobile_inbox_mode') || 'messenger'; // 'messenger' | 'traditional'
let activeCustomAvatarDataUrl = '';

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
  const clean = String(name).replace(/<[^>]*>/g, '').replace(/[()]/g, '').trim();
  const words = clean.split(/\s+/).filter(w => /^[a-zA-Z0-9]/.test(w));
  if (words.length >= 2) {
    const first = (words[0].match(/[a-zA-Z0-9]/) || [''])[0];
    const second = (words[1].match(/[a-zA-Z0-9]/) || [''])[0];
    if (first && second) return (first + second).toUpperCase();
  }
  const letterMatch = clean.match(/[a-zA-Z]/);
  if (letterMatch) return letterMatch[0].toUpperCase();
  const numMatch = clean.match(/\d{1,2}/);
  if (numMatch) return numMatch[0];
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
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100">
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
  return email.recipient_phone ? formatPhoneDisplay(email.recipient_phone) : '';
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
  const myAvatarUrl = currentUser.avatar_url || generateDefaultAvatar(currentUser.phone, currentUser.name);

  const avatarEl = document.getElementById('mob-user-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(currentUser.name || 'User')}" class="avatar-inner-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="avatar-fallback-initial" style="display:none;">${initials}</span>
    `;
    avatarEl.title = `${currentUser.name || 'User'} (+91 ${currentUser.phone})`;
  }

  const drawerAvatar = document.getElementById('mob-drawer-avatar');
  if (drawerAvatar) {
    drawerAvatar.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(currentUser.name || 'User')}" class="avatar-inner-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="avatar-fallback-initial" style="display:none;">${initials}</span>
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
  const peBtn = document.querySelector('.pe_signin_button');
  if (peBtn) {
    peBtn.click();
  } else {
    // Fallback: focus phone input
    const input = document.getElementById('mobile-phone-input');
    if (input) {
      input.focus();
      showToastNotification('Enter your phone number to receive instant OTP');
    }
  }
}

// Window receiver for official Phone.Email SDK
window.phoneEmailReceiver = async function(userObj) {
  if (!userObj || !userObj.user_json_url) return;
  try {
    const res = await fetch('/api/auth/phone-email-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_json_url: userObj.user_json_url })
    });
    const data = await res.json();
    if (data.success && data.user) {
      saveMobileSession(data.user);
      initAppView();
      showToastNotification(`Welcome back, ${data.user.name || 'User'}! 🇮🇳`, 'success');
    }
  } catch (err) {
    showToastNotification('Authentication failed', 'error');
  }
};

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

async function executeBulkActionOnSingle(id, action) {
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

function toggleMobileInboxMode() {
  mobileInboxMode = (mobileInboxMode === 'messenger') ? 'traditional' : 'messenger';
  localStorage.setItem('mobile_inbox_mode', mobileInboxMode);
  updateMobileViewModeControls();
  renderEmailList(allEmails);
  showToastNotification(`Switched to ${mobileInboxMode === 'messenger' ? 'Messenger' : 'Traditional'} View`, 'info');
}

function updateMobileViewModeControls() {
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
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 50px 20px;">
          <div style="margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">No Emails Found</h3>
          <p style="font-size: 12.5px;">No messages in ${getFolderFriendlyName(currentFolder)}.</p>
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
  cardWrapper.className = `email-card-wrapper`;

  const dateObj = new Date(email.created_at);
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const timeDisplay = isToday 
    ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const isSentFolder = currentFolder.toUpperCase() === 'SENT';
  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const recipientsDisplay = getRecipientsDisplay(email);

  const isFromPhoneMail = isPhoneMailSender(email.sender_email);
  const sourceBadgeHtml = isFromPhoneMail
    ? `<span class="badge-source-tag badge-phonemail-pill" title="Sent via INAI Network"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="#eab308" stroke="#ca8a04" stroke-width="1.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>INAI</span></span>`
    : `<span class="badge-source-tag badge-external-pill" title="Sent via External Mail Service"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>External</span></span>`;

  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const displaySender = (isSentFolder || isSentByMe) 
    ? `To: ${recipientsDisplay || 'Recipient'}` 
    : formattedSender;

  const participantForAvatar = (isSentFolder || isSentByMe) ? (email.recipient_phone || recipientsDisplay) : email.sender_email;
  const rowAvatar = getAvatarUrl(participantForAvatar, displaySender);
  const fallbackSvg = generateDefaultAvatar(participantForAvatar, displaySender);
  const rowInitial = getInitials(displaySender);
  const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);

  cardWrapper.innerHTML = `
    <!-- Foreground Card Surface -->
    <div class="email-card-surface ${email.is_read === 0 ? 'unread' : ''} ${isSelected ? 'selected' : ''}">
      <div class="email-checkbox-wrap" onclick="toggleEmailSelection('${email.id}', event)">
        <label class="custom-checkbox" onclick="event.stopPropagation()">
          <input type="checkbox" class="row-checkbox" id="mob-check-${email.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmailSelection('${email.id}', event)">
          <span class="checkmark"></span>
        </label>
      </div>

      <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </span>

      <div class="item-avatar-circle" onclick="openContactInfoModal('${escapeHtml(participantForAvatar)}'); event.stopPropagation();" title="View ${escapeHtml(displaySender)} Digital ID Card">
        <img src="${rowAvatar}" alt="${escapeHtml(displaySender)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${fallbackSvg}';">
        <span class="avatar-fallback-initial" style="display:none;">${rowInitial}</span>
      </div>

      <div class="item-content-preview">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
          <span style="font-size: 14px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw;">
            ${escapeHtml(displaySender)}
          </span>
          <span class="item-date-col">${timeDisplay}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 3px;">
          ${sourceBadgeHtml}
          ${isImportant ? '<span style="font-size: 9px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 1.5px 6px; border-radius: 4px;">PRIORITY</span>' : ''}
        </div>
        <div class="item-subject-title">${escapeHtml(email.subject || '(No Subject)')}</div>
        <div class="item-body-snippet">${escapeHtml(cleanBodySnippet)}</div>
      </div>
    </div>
  `;

  const surface = cardWrapper.querySelector('.email-card-surface');
  surface.addEventListener('click', (e) => {
    openMobileTraditionalEmail(email.id);
  });

  return cardWrapper;
}

function openMobileTraditionalEmail(emailId) {
  const email = allEmails.find(e => e.id === emailId);
  if (!email) return;

  activeTradEmail = email;
  activeEmail = email;

  // Immediately remove unread class and green line from DOM card
  const cardWrapper = document.getElementById(`mob-email-${email.id}`) || document.querySelector(`[data-id="${email.id}"]`);
  if (cardWrapper) {
    const surface = cardWrapper.querySelector('.email-card-surface');
    if (surface) surface.classList.remove('unread');
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

  // Populate and show traditional email view modal
  const fromEl = document.getElementById('trad-view-from');
  if (fromEl) fromEl.innerText = formatSenderDisplay(email.sender_email, false, email.sender_name);

  const toInput = document.getElementById('trad-view-to');
  if (toInput) toInput.value = getRecipientsDisplay(email) || 'Me';

  const subjEl = document.getElementById('trad-view-subject');
  if (subjEl) subjEl.innerText = email.subject || '(No Subject)';

  const dateEl = document.getElementById('trad-view-date');
  if (dateEl) dateEl.innerText = new Date(email.created_at).toLocaleString();

  const bodyEl = document.getElementById('trad-view-body');
  if (bodyEl) {
    bodyEl.innerHTML = email.body_html || escapeHtml(email.body_text || '').replace(/\n/g, '<br>');
  }

  const modal = document.getElementById('traditional-view-modal');
  if (modal) modal.style.display = 'flex';
}

function createMobileConversationCard(conv) {
  const cardWrapper = document.createElement('div');
  const isSelected = selectedEmailIds.has(conv.id);
  const isStarred = conv.is_starred === 1;
  const isImportant = conv.is_important === 1;

  cardWrapper.id = `mob-conv-${conv.id}`;
  cardWrapper.dataset.id = conv.id;
  cardWrapper.className = `email-card-wrapper conversation-thread-wrapper`;

  const dateObj = new Date(conv.created_at);
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const timeDisplay = isToday 
    ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const sourceBadgeHtml = conv.is_phonemail
    ? `<span class="badge-source-tag badge-phonemail-pill" title="Sent via INAI Network"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="#eab308" stroke="#ca8a04" stroke-width="1.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>INAI</span></span>`
    : `<span class="badge-source-tag badge-external-pill" title="Sent via External Mail Service"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>External</span></span>`;

  const msgCountBadge = conv.message_count > 1 
    ? `<span class="conv-count-chip">${conv.message_count} msgs</span>` 
    : '';

  const unreadPill = conv.unread_count > 0 
    ? `<span class="conv-unread-dot" title="${conv.unread_count} unread">${conv.unread_count}</span>` 
    : '';

  cardWrapper.innerHTML = `
    <!-- Underlay Swipe Actions -->
    <div class="swipe-actions-underlay">
      <div class="swipe-right-actions">
        <button type="button" class="swipe-btn star" onclick="toggleStar('${conv.latestMessage.id}', event); snapClosed();" title="Star">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>${isStarred ? 'Unstar' : 'Star'}</span>
        </button>
        <button type="button" class="swipe-btn important" onclick="toggleImportant('${conv.latestMessage.id}', event); snapClosed();" title="Priority">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>Priority</span>
        </button>
      </div>
      <div class="swipe-left-actions">
        <button type="button" class="swipe-btn archive" onclick="executeBulkActionOnConversation('${conv.id}', 'archive', event)" title="Archive Conversation">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          <span>Archive</span>
        </button>
        <button type="button" class="swipe-btn delete" onclick="executeBulkActionOnConversation('${conv.id}', 'delete', event)" title="Delete Conversation">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>
      </div>
    </div>

    <!-- Foreground Card Surface -->
    <div class="email-card-surface ${conv.unread_count > 0 ? 'unread' : ''} ${isSelected ? 'selected' : ''}">
      <div class="email-checkbox-wrap" onclick="toggleEmailSelection('${conv.latestMessage.id}', event)">
        <label class="custom-checkbox" onclick="event.stopPropagation()">
          <input type="checkbox" class="row-checkbox" id="mob-check-${conv.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmailSelection('${conv.latestMessage.id}', event)">
          <span class="checkmark"></span>
        </label>
      </div>

      <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${conv.latestMessage.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </span>

      <div class="item-avatar-circle" onclick="openContactInfoModal('${escapeHtml(conv.participant_raw)}'); event.stopPropagation();" title="View ${escapeHtml(conv.display_title)} Digital ID Card">
        <img src="${conv.avatar_url || generateDefaultAvatar(conv.participant_raw, conv.display_title)}" alt="${escapeHtml(conv.display_title)}" class="avatar-inner-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <span class="avatar-fallback-initial" style="display:none;">${getInitials(conv.display_title || conv.participant_raw)}</span>
      </div>

      <div class="item-content-preview">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
          <span style="font-size: 14px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw;">
            ${escapeHtml(conv.display_title)}
          </span>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span class="item-date-col">${timeDisplay}</span>
            ${unreadPill}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 3px;">
          ${sourceBadgeHtml}
          ${msgCountBadge}
          ${isImportant ? '<span style="font-size: 9px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 1.5px 6px; border-radius: 4px;">PRIORITY</span>' : ''}
        </div>
        <div class="item-subject-title">${escapeHtml(conv.latest_subject)}</div>
        <div class="item-body-snippet">${escapeHtml(conv.latest_snippet)}</div>
      </div>
    </div>
  `;

  const surface = cardWrapper.querySelector('.email-card-surface');
  let startX = 0;
  let startY = 0;
  let currentTx = 0;
  let isDragging = false;
  let hasMovedHorizontally = false;

  function snapClosed() {
    currentTx = 0;
    surface.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    surface.style.transform = 'translateX(0px)';
  }

  cardWrapper.snapClosed = snapClosed;

  surface.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
    hasMovedHorizontally = false;
    surface.style.transition = 'none';
  }, { passive: true });

  surface.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const diffX = e.touches[0].clientX - startX;
    const diffY = e.touches[0].clientY - startY;

    if (!hasMovedHorizontally && Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 10) {
      isDragging = false;
      return;
    }

    if (Math.abs(diffX) > 18) {
      hasMovedHorizontally = true;
      let newTx = currentTx + diffX;
      if (newTx > 140) newTx = 140 + (newTx - 140) * 0.2;
      if (newTx < -140) newTx = -140 + (newTx + 140) * 0.2;
      surface.style.transform = `translateX(${newTx}px)`;
    }
  }, { passive: true });

  surface.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    surface.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    const endX = e.changedTouches[0].clientX;
    const diffX = endX - startX;

    if (hasMovedHorizontally && Math.abs(diffX) >= 18) {
      if (diffX < -45 || (currentTx < 0 && diffX < 20)) {
        currentTx = -136;
        surface.style.transform = 'translateX(-136px)';
      } else if (diffX > 45 || (currentTx > 0 && diffX > -20)) {
        currentTx = 136;
        surface.style.transform = 'translateX(136px)';
      } else {
        currentTx = 0;
        surface.style.transform = 'translateX(0px)';
      }
    } else {
      hasMovedHorizontally = false;
      if (currentTx !== 0) snapClosed();
    }
  }, { passive: true });

  surface.addEventListener('click', (e) => {
    if (hasMovedHorizontally) {
      e.stopPropagation();
      e.preventDefault();
      hasMovedHorizontally = false;
      return;
    }
    if (currentTx !== 0) {
      e.stopPropagation();
      e.preventDefault();
      snapClosed();
      return;
    }
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
    const chatAvatarUrl = conv.avatar_url || generateDefaultAvatar(conv.participant_raw, conv.display_title);
    avatarEl.innerHTML = `
      <img src="${chatAvatarUrl}" alt="${escapeHtml(conv.display_title)}" class="avatar-inner-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="avatar-fallback-initial" style="display:none;">${getInitials(conv.display_title)}</span>
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

    // Body formatting: Check if long email
    const rawBody = (msg.body_text || msg.body_html || '').trim();
    const isLongEmail = rawBody.length > 280;
    const previewBody = isLongEmail ? rawBody.substring(0, 250) + '...' : rawBody;

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

    // Body display
    const bodyContentHtml = `
      <div class="chat-message-text" id="body-text-${msg.id}">
        ${escapeHtml(previewBody).replace(/\n/g, '<br>')}
      </div>
      ${isLongEmail ? `
        <div class="chat-long-email-actions">
          <button type="button" class="btn-chat-link" onclick="toggleExpandMessage('${msg.id}', ${JSON.stringify(rawBody)})">
            Read full email ▾
          </button>
          <button type="button" class="btn-chat-link trad-link" onclick="openTraditionalViewFromChat('${msg.id}')">
            Traditional View ↗
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
      <div class="chat-bubble ${isOutgoing ? 'outgoing' : 'incoming'}">
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

function toggleExpandMessage(msgId, fullBody) {
  const el = document.getElementById(`body-text-${msgId}`);
  if (!el) return;
  el.innerHTML = escapeHtml(fullBody).replace(/\n/g, '<br>');
  const actions = el.parentElement.querySelector('.chat-long-email-actions');
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="btn-chat-link trad-link" onclick="openTraditionalViewFromChat('${msgId}')">
        Traditional View ↗
      </button>
    `;
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
  if (!activeConversation) return;

  let email = null;
  if (emailId) {
    email = activeConversation.messages.find(m => m.id === emailId);
  }
  if (!email) {
    email = activeConversation.latestMessage;
  }
  activeTradEmail = email;

  const modal = document.getElementById('traditional-view-modal');
  if (!modal) return;

  document.getElementById('trad-view-from').innerText = formatSenderDisplay(email.sender_email, true, email.sender_name);
  
  // To field is prefilled & LOCKED
  const toInput = document.getElementById('trad-view-to');
  if (toInput) {
    toInput.value = email.recipient_phone || (currentUser ? currentUser.phone : '');
    toInput.readOnly = true;
  }

  document.getElementById('trad-view-subject').innerText = email.subject || '(No Subject)';
  document.getElementById('trad-view-date').innerText = new Date(email.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  
  const bodyViewport = document.getElementById('trad-view-body');
  if (bodyViewport) {
    const rawContent = email.body_html || email.body_text || '';
    bodyViewport.innerHTML = rawContent.includes('<') ? rawContent : escapeHtml(rawContent).replace(/\n/g, '<br>');
  }

  modal.style.display = 'flex';
}

function closeTraditionalViewModal() {
  const modal = document.getElementById('traditional-view-modal');
  if (modal) modal.style.display = 'none';
}

function replyFromTraditionalView() {
  closeTraditionalViewModal();
  if (activeTradEmail) {
    triggerReplyToMessage(activeTradEmail.id);
  }
}

// ==================== DIGITAL ID CARD & PERSON INFO MODAL ====================
function openDigitalIdModal() {
  openContactInfoModal(currentUser ? currentUser.phone : null);
}

function openActiveContactInfoModal() {
  if (!activeConversation) return;
  openContactInfoModal(activeConversation.participant_raw);
}

async function openContactInfoModal(phoneOrEmail) {
  const target = phoneOrEmail || (activeConversation && activeConversation.participant_raw) || (currentUser && currentUser.phone);
  if (!target) return;

  activeContactForModal = target;
  const modal = document.getElementById('digital-id-modal');
  if (!modal) return;

  // Set default view to Digital ID Card
  switchIdCardTab('card');

  // Fill placeholder data
  const isPM = isPhoneMailSender(target);
  const cleanPhone = String(target).replace(/\D/g, '').slice(-10);
  const formattedPhone = cleanPhone.length === 10 ? `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}` : target;

  const nameEl = document.getElementById('id-card-name');
  const phoneEl = document.getElementById('id-card-phone');
  const emailEl = document.getElementById('id-card-email');
  const aliasTagEl = document.getElementById('id-card-alias-tag');
  const avatarEl = document.getElementById('id-card-avatar-img');
  const qrEl = document.getElementById('id-card-qr-img');
  const dateEl = document.getElementById('id-card-issue-date');

  const defaultEmail = isPM ? `${cleanPhone}@alphastack.wwisvnr.com` : target;
  const displayName = (activeConversation && activeConversation.sender_name) || (isPM ? `User ${cleanPhone.slice(-4)}` : target.split('@')[0]);

  if (nameEl) nameEl.innerText = displayName;
  if (phoneEl) phoneEl.innerText = formattedPhone;
  if (emailEl) emailEl.innerText = defaultEmail;
  if (aliasTagEl) aliasTagEl.innerText = 'Sub-ID: .primary';
  if (dateEl) dateEl.innerText = new Date().toISOString().split('T')[0];

  const avatarSvg = generateDefaultAvatar(target, displayName);
  if (avatarEl) {
    avatarEl.innerHTML = `<img src="${avatarSvg}" alt="${escapeHtml(displayName)}" class="avatar-inner-img">`;
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
  if (editPhone) editPhone.value = formattedPhone;
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
      if (c.display_name && nameEl) nameEl.innerText = c.display_name;
      if (c.email && emailEl) emailEl.innerText = c.email;
      if (c.bio && editBio) editBio.value = c.bio;
      if (editName && c.display_name) editName.value = c.display_name;
      if (editEmail && c.email) editEmail.value = c.email;
      if (c.avatar_url && avatarEl) {
        avatarEl.innerHTML = `<img src="${c.avatar_url}" alt="${escapeHtml(c.display_name || displayName)}" class="avatar-inner-img">`;
      }
      if (c.avatar_url && editAvatarPrev) {
        editAvatarPrev.innerHTML = `<img src="${c.avatar_url}" alt="${escapeHtml(c.display_name || displayName)}" class="avatar-inner-img">`;
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

  const mySvg = currentUser.avatar_url || generateDefaultAvatar(currentUser.phone, currentUser.display_name);
  if (avatarEl) {
    avatarEl.innerHTML = `<img src="${mySvg}" alt="User Avatar" class="avatar-inner-img">`;
    avatarEl.style.backgroundImage = 'none';
  }

  if (langSelect) langSelect.value = currentLanguage;

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
    showToastNotification('Original message restored');
    return;
  }

  const targetLang = currentLanguage === 'en' ? 'hi' : currentLanguage;
  showToastNotification(`Translating to ${targetLang.toUpperCase()}...`);

  try {
    const plainText = (activeEmail.body_text || bodyEl.innerText || '').trim();
    const cleanSubj = activeEmail.subject || '';

    const transUrl = (text, tl) => 
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

    const [subjRes, bodyRes] = await Promise.all([
      fetch(transUrl(cleanSubj, targetLang)).then(r => r.json()).catch(() => null),
      fetch(transUrl(plainText.substring(0, 1500), targetLang)).then(r => r.json()).catch(() => null)
    ]);

    let translatedSubject = cleanSubj;
    if (subjRes && subjRes[0]) {
      translatedSubject = subjRes[0].map(s => s[0]).join('');
    }

    let translatedBody = '';
    if (bodyRes && bodyRes[0]) {
      translatedBody = bodyRes[0].map(s => s[0]).join('').replace(/\n/g, '<br>');
    } else {
      translatedBody = plainText.replace(/\n/g, '<br>');
    }

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
    showToastNotification('Translation failed, showing original');
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

function openTraditionalCompose(recipient = '', subject = '', body = '') {
  document.getElementById('trad-to').value = recipient;
  document.getElementById('trad-subject').value = subject;
  document.getElementById('trad-body').value = body;
  document.getElementById('traditional-modal').style.display = 'flex';

  setupContactsAutocomplete();
}

function closeTraditionalCompose() {
  document.getElementById('traditional-modal').style.display = 'none';
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
}

function openReplyCompose(isForward = false) {
  if (!activeEmail) return;
  const isSentByMe = Boolean(activeEmail.sender_email && currentUser && activeEmail.sender_email.includes(currentUser.phone));
  const to = isForward ? '' : (isSentByMe ? (activeEmail.recipient_phone || '') : activeEmail.sender_email);
  const subj = isForward ? `Fwd: ${activeEmail.subject || ''}` : `Re: ${activeEmail.subject || ''}`;
  const quoted = `\n\n--- On ${new Date(activeEmail.created_at).toLocaleString()}, ${activeEmail.sender_email} wrote ---\n${activeEmail.body_text || ''}`;
  openTraditionalCompose(to, subj, quoted);
}

function setupContactsAutocomplete() {
  const input = document.getElementById('trad-to');
  const picker = document.getElementById('mobile-contacts-picker');
  if (!input || !picker) return;

  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q || cachedContacts.length === 0) {
      picker.style.display = 'none';
      return;
    }

    const matches = cachedContacts.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) || 
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q))
    ).slice(0, 5);

    if (matches.length === 0) {
      picker.style.display = 'none';
      return;
    }

    picker.innerHTML = matches.map(c => `
      <div class="contact-picker-item" onclick="selectContactRecipient('${escapeHtml(c.phone || c.email)}')">
        <div>
          <strong style="color: var(--text-main);">${escapeHtml(c.name || c.phone)}</strong>
          <div style="font-size: 11px; color: var(--text-dim);">${formatPhoneDisplay(c.phone || '')}</div>
        </div>
        <span class="badge-source-tag badge-phonemail-pill">⚡ INAI</span>
      </div>
    `).join('');

    picker.style.display = 'block';
  };
}

function selectContactRecipient(recipient) {
  const input = document.getElementById('trad-to');
  if (input) input.value = recipient;
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

  showToastNotification('Sending message...', 'info');

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_phone: currentUser.phone,
        to,
        subject,
        body
      })
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification('Message sent successfully! 🚀', 'success');
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

// ==================== INITIALIZATION ====================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    restoreSession();
  });
} else {
  restoreSession();
}
