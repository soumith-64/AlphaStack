// ==================== INAI MOBILE WEBAPP CORE CONTROLLER ====================
// Real-time Phone-to-Email Platform for Bharat
// =========================================================================

// Clean URL: Keep address bar as clean "alphastack.wwisvnr.com" (strip /mobile)
try {
  if (window.location.pathname.startsWith('/mobile')) {
    window.history.replaceState(null, document.title, '/' + (window.location.search || ''));
  }
} catch(e) {}

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
  if (!digits || digits === 'undefined') return '';
  const p = String(digits).replace(/\D/g, '').slice(-10);
  if (p.length === 10) {
    const formatted = `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
    return tag ? `${formatted} (.${tag})` : formatted;
  }
  return String(digits);
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

function clearCorruptedMobileSession() {
  try {
    localStorage.removeItem('phonemail-mobile-user');
    localStorage.removeItem('inai_user');
    localStorage.removeItem('phonemail-user');
    sessionStorage.removeItem('phonemail-mobile-user');
    sessionStorage.removeItem('phonemail-user');
  } catch(e) {}
  document.documentElement.classList.remove('has-saved-session');
  currentUser = null;
}

function normalizeMobileUser(user) {
  if (!user || typeof user !== 'object') return null;

  // 1. Direct phone fields
  let rawPhone = user.phone || user.phone_number || user.phoneNumber || '';
  let cleanPhone = String(rawPhone).replace(/\D/g, '').slice(-10);

  // 2. Email fallback (e.g. 8667611163@alphastack.wwisvnr.com or 8667611163.primary@...)
  if (cleanPhone.length !== 10) {
    const rawEmail = user.email || user.email_address || user.emailAddress || '';
    if (rawEmail) {
      const prefix = rawEmail.split('@')[0] || '';
      const emailDigits = prefix.replace(/\D/g, '').slice(-10);
      if (emailDigits.length === 10) {
        cleanPhone = emailDigits;
      }
    }
  }

  // 3. User ID fallback (e.g. user_8667611163 or 8667611163)
  if (cleanPhone.length !== 10 && user.id) {
    const idDigits = String(user.id).replace(/\D/g, '').slice(-10);
    if (idDigits.length === 10) {
      cleanPhone = idDigits;
    }
  }

  // 4. Saved phone fallback from localStorage
  if (cleanPhone.length !== 10 && typeof localStorage !== 'undefined') {
    try {
      const savedPhone = (localStorage.getItem('phonemail_saved_phone') || '').replace(/\D/g, '').slice(-10);
      if (savedPhone.length === 10) {
        cleanPhone = savedPhone;
      }
    } catch (e) {}
  }

  // Strictly enforce 10-digit phone number. An INAI user without a phone cannot operate.
  if (cleanPhone.length !== 10) {
    return null;
  }

  const rawName = user.name || user.display_name || user.displayName || '';
  const cleanName = (rawName && !rawName.startsWith('User ') ? rawName : (user.display_name || `User ${cleanPhone}`)).trim();
  const rawEmail = user.email || user.email_address || '';
  const cleanEmail = (rawEmail.includes('@') && rawEmail.includes(cleanPhone))
    ? rawEmail.trim()
    : `${cleanPhone}@alphastack.wwisvnr.com`;

  return {
    ...user,
    id: user.id || `user_${cleanPhone}`,
    phone: cleanPhone,
    phone_number: cleanPhone,
    name: cleanName,
    display_name: cleanName,
    email: cleanEmail,
    email_address: cleanEmail,
    avatar_url: user.avatar_url || ''
  };
}

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
      const rawUser = JSON.parse(saved);
      const user = normalizeMobileUser(rawUser);
      if (user && user.phone && user.phone.length === 10) {
        currentUser = user;
        saveMobileSession(currentUser);
        document.documentElement.classList.add('has-saved-session');
        initAppView();

        // Cross-device profile sync: fetch latest profile & name from database
        fetch(`/api/auth/me?phone=${encodeURIComponent(currentUser.phone)}`)
          .then(r => r.json())
          .then(data => {
            if (data && data.user) {
              const refreshed = normalizeMobileUser({ ...currentUser, ...data.user });
              if (refreshed) {
                saveMobileSession(refreshed);
                const drawerName = document.getElementById('drawer-username');
                if (drawerName) drawerName.innerText = refreshed.name || `User ${refreshed.phone}`;
                const drawerEmail = document.getElementById('drawer-email');
                if (drawerEmail) drawerEmail.innerText = formatPhoneDisplay(refreshed.phone);
              }
            }
          })
          .catch(() => {});
        return;
      } else {
        clearCorruptedMobileSession();
      }
    } catch (e) {
      clearCorruptedMobileSession();
    }
  }

  clearCorruptedMobileSession();
  // Show Onboarding
  const onb = document.getElementById('onboarding-container');
  const app = document.getElementById('app-container');
  if (onb) onb.style.display = 'flex';
  if (app) app.style.display = 'none';
  goToScreen('screen-phone');
}

function saveMobileSession(user) {
  if (!user) return;
  const normalized = normalizeMobileUser(user);
  if (!normalized || !normalized.phone || normalized.phone.length !== 10) return;
  currentUser = normalized;
  const remEl = document.getElementById('mob-remember-me');
  const remember = remEl ? remEl.checked : true;
  const str = JSON.stringify(currentUser);
  if (remember) {
    localStorage.setItem('phonemail-mobile-user', str);
    localStorage.setItem('inai_user', str);
    localStorage.setItem('phonemail-user', str);
    localStorage.setItem('phonemail_saved_phone', currentUser.phone);
  }
  sessionStorage.setItem('phonemail-mobile-user', str);
  document.documentElement.classList.add('has-saved-session');
}

function initAppView() {
  if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
    currentUser = normalizeMobileUser(currentUser);
    if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
      restoreSession();
      return;
    }
  }

  document.getElementById('onboarding-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  // Ensure conversation and reading panes start hidden on fresh app view
  const initialReadingPane = document.getElementById('reading-pane');
  if (initialReadingPane) {
    initialReadingPane.style.setProperty('display', 'none', 'important');
    initialReadingPane.classList.remove('active');
  }
  const initialTradView = document.getElementById('mob-traditional-reading-view');
  if (initialTradView) {
    initialTradView.style.setProperty('display', 'none', 'important');
  }

  const formattedPhone = formatPhoneDisplay(currentUser.phone);
  const displayName = currentUser.name || currentUser.display_name || (currentUser.phone ? `User ${currentUser.phone}` : 'INAI Member');

  // Update User Header Info
  const initials = getInitials(displayName);
  const myFallbackSvg = generateDefaultAvatar(currentUser.phone, displayName);
  const myAvatarUrl = currentUser.avatar_url || myFallbackSvg;

  const avatarEl = document.getElementById('mob-user-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(displayName)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${myFallbackSvg}';">
    `;
    avatarEl.title = `${displayName} (${formattedPhone})`;
  }

  const drawerAvatar = document.getElementById('mob-drawer-avatar');
  if (drawerAvatar) {
    drawerAvatar.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(displayName)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${myFallbackSvg}';">
    `;
  }

  const drawerName = document.getElementById('drawer-username');
  if (drawerName) drawerName.innerText = displayName;

  const drawerEmail = document.getElementById('drawer-email');
  if (drawerEmail) drawerEmail.innerText = formattedPhone;

  // Setup Socket.IO for real-time notifications
  setupSocket();

  // Apply Language
  applyInaiLanguage();

  // Update view mode controls on startup
  updateMobileViewModeControls();

  // Load All Mail with 0-delay instant caching
  loadEmails('ALL');

  // Also load conversations for messenger view
  if (typeof loadConversations === 'function') {
    loadConversations();
  }

  // Pre-fetch contacts silently in background for instant autocomplete
  fetchContactsSilently();
}

function setupSocket() {
  try {
    if (typeof io !== 'undefined') {
      socket = io();
      socket.on('connect', () => {
        if (currentUser && currentUser.phone) {
          socket.emit('join:user', currentUser.phone);
          socket.emit('join', currentUser.phone);
        }
      });
      socket.on('email:incoming', (data) => {
        console.log('⚡ [MOBILE SOCKET] Inbound email received:', data);
        const senderDisplay = data.from || (data.email && data.email.sender_email) || 'Network Contact';
        showToastNotification(`📩 New message from ${senderDisplay}!`, 'success');
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

        // If current active conversation is open and matches this incoming email, append message live
        if (activeConversation && data.email) {
          const emailConvId = data.email.conversation_id || data.conversationId;
          const counterpartClean = activeConversation.participant_raw ? activeConversation.participant_raw.replace(/\D/g, '').slice(-10) : '';
          const senderClean = (data.email.sender_email || '').replace(/\D/g, '').slice(-10);

          if (emailConvId === activeConversation.id || (counterpartClean && senderClean && senderClean === counterpartClean)) {
            const alreadyExists = activeConversation.messages.some(m => m.id === data.email.id);
            if (!alreadyExists) {
              activeConversation.messages.push(data.email);
              renderChatTimeline(activeConversation);
            }
          }
        }
        emailFolderCache = {};
        loadEmails(currentFolder);
      });
      socket.on('email:new', (data) => {
        console.log('⚡ [MOBILE SOCKET] email:new event:', data);
        if (data && data.senderPhone && currentUser && data.senderPhone !== currentUser.phone) {
          showToastNotification('📩 New email received', 'success');
        }
        emailFolderCache = {};
        loadEmails(currentFolder);
      });
      socket.on('email:received', (data) => {
        emailFolderCache = {};
        loadEmails(currentFolder);
      });
      socket.on('new_email', (data) => {
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
      body: JSON.stringify({ phone: pendingPhone, phoneNumber: pendingPhone })
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
  const peBtn = document.getElementById('btn_ph_login') || document.querySelector('.pe_signin_button button');

  // 1. If Phone.Email SDK button is already in DOM, click it
  if (peBtn) {
    try {
      peBtn.click();
      return;
    } catch (e) {}
  }

  if (btn) {
    btn.style.opacity = '0.75';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Connecting to Phone.Email gateway...';
  }

  const clientId = '13311688567845248231';
  const redirectUrl = window.location.href.split('?')[0].split('#')[0];
  const authUrl = `https://auth.phone.email/log-in?client_id=${clientId}&auth_type=8&origin=${encodeURIComponent(redirectUrl)}`;

  const w = 500, h = 600;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);

  // MUST open via window.open so Phone.Email has access to window.opener!
  // If window.location.href is used, window.opener is null and Phone.Email's Continue button throws an uncaught error
  try {
    const popup = window.open(authUrl, 'peLoginWindow', `toolbar=0,scrollbars=0,location=0,statusbar=0,menubar=0,resizable=0,width=${w},height=${h},top=${top},left=${left}`);
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.open(authUrl, '_blank');
    }
  } catch (err) {
    window.open(authUrl, '_blank');
  }

  setTimeout(() => {
    if (btn) {
      btn.style.opacity = '1';
      const subCaption = btn.querySelector('.btn-sub-caption');
      if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
    }
  }, 2500);
}

// Window receiver for official Phone.Email SDK
let isVerifyingPhoneEmail = false;
window.phoneEmailListener = async function(userObj) {
  if (!userObj || !userObj.user_json_url) return;
  if (isVerifyingPhoneEmail) return;
  isVerifyingPhoneEmail = true;

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
      isVerifyingPhoneEmail = false;
      if (btn) {
        btn.style.opacity = '1';
        const subCaption = btn.querySelector('.btn-sub-caption');
        if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
      }
      showToastNotification(data.error || 'Failed to authenticate phone number with Phone.Email', 'error');
    }
  } catch (err) {
    isVerifyingPhoneEmail = false;
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
        body: JSON.stringify({ phone: pendingPhone, phoneNumber: pendingPhone, otp, clientType: 'MOBILE_APP' })
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
      body: JSON.stringify({ phone: pendingPhone, phoneNumber: pendingPhone, name: fullName })
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
    if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
      currentUser = normalizeMobileUser(currentUser);
      if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
        restoreSession();
        return;
      }
    }
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
  syncMobileFolderStats();
}

function parseEmailDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal > 1e11 ? dateVal : dateVal * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  let s = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T');
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  if (/^\d{10,13}$/.test(s)) {
    const num = parseInt(s, 10);
    const dNum = new Date(num > 1e11 ? num : num * 1000);
    if (!isNaN(dNum.getTime())) return dNum;
  }
  return null;
}

async function syncMobileFolderStats() {
  if (!currentUser || !currentUser.phone) return;
  try {
    const res = await fetch(`/api/emails/stats?phone=${encodeURIComponent(currentUser.phone)}`);
    const stats = await res.json();
    if (!stats) return;

    const unreadBadge = document.getElementById('badge-unread-count');
    if (unreadBadge) {
      const activeUnread = currentFolder === 'INBOX' ? stats.inbox_unread : stats.all_unread;
      unreadBadge.innerText = activeUnread > 0 ? activeUnread : '';
      unreadBadge.style.display = activeUnread > 0 ? 'inline-flex' : 'none';
    }

    const badgeInbox = document.getElementById('mob-badge-inbox');
    if (badgeInbox) {
      badgeInbox.innerText = stats.inbox_unread > 0 ? stats.inbox_unread : '';
      badgeInbox.style.display = stats.inbox_unread > 0 ? 'inline-block' : 'none';
    }

    const badgeAll = document.getElementById('mob-badge-all');
    if (badgeAll) {
      badgeAll.innerText = stats.all_unread > 0 ? stats.all_unread : '';
      badgeAll.style.display = stats.all_unread > 0 ? 'inline-block' : 'none';
    }

    const badgeDrafts = document.getElementById('mob-badge-drafts');
    if (badgeDrafts) {
      badgeDrafts.innerText = stats.drafts_total > 0 ? stats.drafts_total : '';
      badgeDrafts.style.display = stats.drafts_total > 0 ? 'inline-block' : 'none';
    }
  } catch (err) {
    console.warn('Could not sync mobile folder stats:', err);
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
      allConversations.forEach(c => {
        if (c.id === id || (c.latestMessage && c.latestMessage.id === id) || (c.messages && c.messages.some(m => m.id === id))) {
          c.is_important = data.is_important;
        }
      });
      if (emailFolderCache[currentFolder]) {
        emailFolderCache[currentFolder] = [...allEmails];
      }
      renderEmailList(allEmails);

      if (activeEmail && activeEmail.id === id) {
        activeEmail.is_important = data.is_important;
      }
      if (activeConversation) {
        if (activeConversation.id === id || (activeConversation.latestMessage && activeConversation.latestMessage.id === id) || (activeConversation.messages && activeConversation.messages.some(m => m.id === id))) {
          activeConversation.is_important = data.is_important;
        }
      }
      const impBtn = document.getElementById('mob-pane-important-btn');
      if (impBtn) {
        impBtn.style.color = data.is_important ? '#ef4444' : 'var(--text-dim)';
        const svg = impBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', data.is_important ? '#ef4444' : 'none');
      }
      if (activeTradEmail && activeTradEmail.id === id) {
        activeTradEmail.is_important = data.is_important;
      }
      const tradImpBtn = document.getElementById('mob-trad-important-btn');
      if (tradImpBtn) {
        tradImpBtn.style.color = data.is_important ? '#ef4444' : 'inherit';
        const svg = tradImpBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', data.is_important ? '#ef4444' : 'none');
      }
      showToastNotification(data.is_important ? 'Marked as Priority ❤️' : 'Removed from Priority');
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
    conv.participant_phone = counterpart;
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
  if (activeQuickFilter === filter && filter !== 'all') {
    activeQuickFilter = 'all';
  } else {
    activeQuickFilter = filter;
  }
  ['all', 'unread', 'attachments', 'favorites'].forEach(f => {
    const pill = document.getElementById(`pill-filter-${f}`) || document.getElementById(`quick-pill-${f}`);
    if (pill) {
      if (f === activeQuickFilter) pill.classList.add('active');
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
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${isImportant ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
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
          ${isImportant ? '<span class="trad-priority-tag"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" stroke="none" style="margin-right: 2px;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>PRIORITY</span>' : ''}
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
  let email = allEmails.find(e => String(e.id) === String(emailId));
  if (!email && activeConversation && activeConversation.messages) {
    email = activeConversation.messages.find(m => String(m.id) === String(emailId));
  }
  if (!email) return;

  if (currentFolder === 'DRAFTS' || email.folder === 'DRAFTS') {
    openDraftInMobileCompose(email);
    return;
  }

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
  updateTradImportantButton(email.is_important === 1);

  readingView.style.display = 'flex';
  const scrollArea = readingView.querySelector('.trad-reading-scroll-area');
  if (scrollArea) scrollArea.scrollTop = 0;

  try {
    if (!window.history.state || window.history.state.view !== 'traditional_reading') {
      window.history.pushState({ view: 'traditional_reading', emailId: email.id }, '');
    }
  } catch(e) {}
}

function closeMobileTraditionalReading(shouldPopHistory = true) {
  const readingView = document.getElementById('mob-traditional-reading-view');
  if (readingView) readingView.style.display = 'none';
  activeTradEmail = null;
  if (shouldPopHistory && window.history.state && window.history.state.view === 'traditional_reading') {
    window.history.back();
  }
}

function updateTradStarButton(isStarred) {
  const btn = document.getElementById('mob-trad-star-btn');
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    btn.style.color = isStarred ? '#eab308' : 'inherit';
  }
}

function updateTradImportantButton(isImportant) {
  const btn = document.getElementById('mob-trad-important-btn');
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="${isImportant ? '#ef4444' : 'none'}" stroke="${isImportant ? '#ef4444' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    btn.style.color = isImportant ? '#ef4444' : 'inherit';
  }
}

async function toggleCurrentTradImportant() {
  if (!activeTradEmail) return;
  toggleImportant(activeTradEmail.id);
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
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${isImportant ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
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
            ${isImportant ? '<span style="color: #ef4444; display: inline-flex;" title="Priority"><svg viewBox="0 0 24 24" width="13" height="13" fill="#ef4444" stroke="#ef4444" stroke-width="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>' : ''}
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

  if (currentFolder === 'DRAFTS') {
    const draftMsg = conv.latestMessage || (conv.messages && conv.messages[0]);
    if (draftMsg) {
      openDraftInMobileCompose(draftMsg);
      return;
    }
  }

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
  if (subEl) {
    const subtitleText = conv.display_subtitle || '⚡ INAI Verified';
    subEl.innerHTML = `<span class="pulse-dot"></span><span>${escapeHtml(subtitleText)}</span>`;
  }

  // Star status
  const starBtn = document.getElementById('mob-pane-star-btn');
  if (starBtn) {
    starBtn.style.color = conv.is_starred === 1 ? '#f59e0b' : 'var(--text-dim)';
  }

  // Priority / Heart status
  const impBtn = document.getElementById('mob-pane-important-btn');
  if (impBtn) {
    const isImp = conv.is_important === 1;
    impBtn.style.color = isImp ? '#ef4444' : 'var(--text-dim)';
    const svg = impBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isImp ? '#ef4444' : 'none');
  }

  // Populate chronological chat timeline
  renderChatTimeline(conv);

  // Reset quote banner and input
  cancelQuotedReply();
  const input = document.getElementById('mob-chat-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
    if (!input._hasScrollHook) {
      input._hasScrollHook = true;
      input.addEventListener('focus', () => {
        setTimeout(() => {
          const tl = document.getElementById('mob-chat-timeline');
          if (tl) tl.scrollTop = tl.scrollHeight;
          input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 250);
      });
    }
  }

  // Show WhatsApp chat pane
  const pane = document.getElementById('reading-pane');
  if (pane) {
    pane.style.setProperty('display', 'flex', 'important');
    pane.classList.add('active');
  }

  // Push history state so iOS edge-swipe and browser back work seamlessly
  try {
    if (!window.history.state || window.history.state.view !== 'conversation') {
      window.history.pushState({ view: 'conversation', convId: conv.id }, '');
    }
  } catch(e) {}

  // Scroll timeline to bottom
  const timeline = document.getElementById('mob-chat-timeline');
  if (timeline) {
    setTimeout(() => {
      timeline.scrollTop = timeline.scrollHeight;
    }, 60);
    setTimeout(() => {
      timeline.scrollTop = timeline.scrollHeight;
    }, 220);
  }
}

function renderChatTimeline(conv) {
  const timeline = document.getElementById('mob-chat-timeline');
  if (!timeline) return;
  timeline.innerHTML = '';

  // End-to-end verified encryption badge
  const securityBanner = document.createElement('div');
  securityBanner.className = 'chat-security-banner';
  securityBanner.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
    <span>Messages & attachments routed securely through verified INAI network</span>
  `;
  timeline.appendChild(securityBanner);

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

    // Extract inline or attached voice mail audio
    let voiceMailAudioSrc = '';
    let voiceMailDuration = '0:00';
    let voiceMailTranscript = '';

    if (msg.body_html) {
      const audioMatch = msg.body_html.match(/<audio[^>]+src=["']([^"']+)["']/i);
      if (audioMatch && audioMatch[1]) {
        voiceMailAudioSrc = audioMatch[1];
        const durMatch = msg.body_html.match(/data-duration=["']([^"']+)["']/i);
        if (durMatch && durMatch[1]) voiceMailDuration = durMatch[1];
        const transMatch = msg.body_html.match(/class=["'][^"']*voicemail-transcript-box[^"']*["'][^>]*>[\s\S]*?<span[^>]*>"?([^"<]+)"?<\/span>/i);
        if (transMatch && transMatch[1]) voiceMailTranscript = transMatch[1];
      }
    }
    if (!voiceMailAudioSrc && msg.attachments && msg.attachments.length > 0) {
      const audioAtt = msg.attachments.find(a => 
        (a.content_type && a.content_type.startsWith('audio/')) || 
        (a.filename && /\.(webm|mp3|ogg|wav|m4a|aac)$/i.test(a.filename))
      );
      if (audioAtt) {
        voiceMailAudioSrc = audioAtt.url || `/api/attachments/${audioAtt.id}`;
      }
    }
    if (!voiceMailTranscript && msg.body_text) {
      const txtTransMatch = msg.body_text.match(/"([^"\n]+)"/) || msg.body_text.match(/Transcription:\s*"?([^"\n]+)"?/i);
      if (txtTransMatch) voiceMailTranscript = txtTransMatch[1];
      const durTxtMatch = msg.body_text.match(/Voice Mail\s*\(([^)]+)\)/i);
      if (durTxtMatch) voiceMailDuration = durTxtMatch[1];
    }

    let cleanText = (msg.body_text || '').replace(/\[image:[^\]]*\]/gi, '').trim();
    if (!cleanText && msg.body_html) {
      cleanText = msg.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const isPureVoiceMail = voiceMailAudioSrc && (!cleanText || cleanText.startsWith('🎙️ Voice Mail'));
    const hasLongContent = !isPureVoiceMail && (cleanText.length > 180 || Boolean(previewImageSrc) || (msg.body_html && msg.body_html.length > 250));
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

    // WhatsApp-grade Voice Note Bubble Player
    const voiceNoteHtml = voiceMailAudioSrc ? `
      <div class="chat-voice-note-player" id="voice-player-${msg.id}">
        <button type="button" class="voice-play-toggle" onclick="toggleAudioBubblePlayback('${msg.id}', '${voiceMailAudioSrc}', this)" title="Play / Pause Voice Mail">
          <svg class="play-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          <svg class="pause-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
        
        <div class="voice-waveform-area" onclick="seekAudioBubble('${msg.id}', event)">
          <div class="voice-waveform-bars" id="waveform-bars-${msg.id}">
            <span class="wave-bar" style="height: 35%;"></span>
            <span class="wave-bar" style="height: 60%;"></span>
            <span class="wave-bar" style="height: 90%;"></span>
            <span class="wave-bar" style="height: 45%;"></span>
            <span class="wave-bar" style="height: 75%;"></span>
            <span class="wave-bar" style="height: 100%;"></span>
            <span class="wave-bar" style="height: 65%;"></span>
            <span class="wave-bar" style="height: 40%;"></span>
            <span class="wave-bar" style="height: 85%;"></span>
            <span class="wave-bar" style="height: 95%;"></span>
            <span class="wave-bar" style="height: 70%;"></span>
            <span class="wave-bar" style="height: 50%;"></span>
            <span class="wave-bar" style="height: 80%;"></span>
            <span class="wave-bar" style="height: 60%;"></span>
            <span class="wave-bar" style="height: 30%;"></span>
            <span class="wave-bar" style="height: 75%;"></span>
            <span class="wave-bar" style="height: 90%;"></span>
            <span class="wave-bar" style="height: 40%;"></span>
          </div>
          <div class="voice-time-row">
            <span class="voice-timer" id="voice-timer-${msg.id}">0:00</span>
            <span class="voice-total-duration">${voiceMailDuration || 'Voice Note'}</span>
          </div>
        </div>

        <div class="voice-avatar-badge">
          <span class="voice-mic-badge">🎙️</span>
        </div>
        
        <button type="button" class="voice-speed-chip" onclick="toggleAudioSpeed('${msg.id}', this)" title="Playback speed">1x</button>
      </div>
      ${voiceMailTranscript ? `
        <div class="voice-transcript-accordion">
          <button type="button" class="btn-toggle-transcript" onclick="toggleTranscriptView('${msg.id}')">
            <span>📝 AI Transcript</span>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="voice-transcript-text" id="voice-transcript-${msg.id}" style="display: none;">
            "${escapeHtml(voiceMailTranscript)}"
          </div>
        </div>
      ` : ''}
    ` : '';

    // Body display with snippet & actions
    const bodyContentHtml = `
      ${imageHtml}
      ${voiceNoteHtml}
      ${(!isPureVoiceMail && snippetText) ? `
        <div class="chat-message-text" id="body-text-${msg.id}">
          ${escapeHtml(snippetText).replace(/\n/g, '<br>')}
        </div>
      ` : ''}
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
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
    msg = activeConversation.messages.find(m => String(m.id) === String(msgId));
  }
  if (!msg) {
    msg = allEmails.find(e => String(e.id) === String(msgId));
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

function closeReadingPane(shouldPopHistory = true) {
  closeChatOverflow();
  const pane = document.getElementById('reading-pane');
  if (pane) {
    pane.style.setProperty('display', 'none', 'important');
    pane.classList.remove('active');
  }
  activeConversation = null;
  activeConversationId = null;
  activeReplyingMessage = null;
  if (shouldPopHistory && window.history.state && window.history.state.view === 'conversation') {
    window.history.back();
  }
}

function toggleChatOverflowMenu(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const menu = document.getElementById('mob-chat-overflow-menu');
  if (!menu) return;
  if (menu.style.display === 'none' || !menu.style.display) {
    menu.style.display = 'flex';
  } else {
    menu.style.display = 'none';
  }
}

function closeChatOverflow() {
  const menu = document.getElementById('mob-chat-overflow-menu');
  if (menu) menu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#mob-chat-overflow-menu') && !e.target.closest('.chat-top-action-btn')) {
    closeChatOverflow();
  }
});

function openComposeFromActiveConversation() {
  if (activeConversation) {
    const to = activeConversation.participant_raw || (activeConversation.latestMessage ? activeConversation.latestMessage.sender_email : '');
    openTraditionalCompose(to);
  } else {
    openTraditionalCompose();
  }
}

// ==================== REPLY BEHAVIOR & CONSTRAINTS ====================
function triggerReplyToMessage(msgId, e) {
  if (e) e.stopPropagation();

  if (!activeConversation) return;
  const msg = activeConversation.messages.find(m => String(m.id) === String(msgId));
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

// ==================== MOBILE IMAGE ATTACHMENTS & UPLOADS ====================
let activeChatAttachedImage = null;
let activeTradAttachedImage = null;

function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('Please select a valid image file.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          name: file.name || 'photo.jpg',
          size: Math.round(dataUrl.length * 0.75),
          dataUrl: dataUrl
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function triggerMobileChatImageUpload() {
  const input = document.getElementById('mob-chat-img-input');
  if (input) input.click();
}

async function handleMobileChatImageSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    showToastNotification('Attaching photo...', 'info');
    const result = await compressImageFile(file);
    activeChatAttachedImage = result;

    const tray = document.getElementById('mob-chat-img-preview-tray');
    const thumb = document.getElementById('mob-chat-img-thumb');
    const nameEl = document.getElementById('mob-chat-img-name');

    if (thumb) thumb.src = result.dataUrl;
    if (nameEl) nameEl.innerText = result.name;
    if (tray) tray.style.display = 'flex';

    const chatInput = document.getElementById('mob-chat-input');
    if (chatInput) {
      chatInput.placeholder = 'Add a caption or send photo...';
      chatInput.focus();
    }
    showToastNotification('Photo attached! Tap Send to deliver 📸', 'success');
  } catch (err) {
    showToastNotification(err.message || 'Error processing image', 'error');
  }
}

function removeMobileChatAttachedImage() {
  activeChatAttachedImage = null;
  const input = document.getElementById('mob-chat-img-input');
  if (input) input.value = '';
  const tray = document.getElementById('mob-chat-img-preview-tray');
  if (tray) tray.style.display = 'none';
  const chatInput = document.getElementById('mob-chat-input');
  if (chatInput) chatInput.placeholder = 'Type a message or reply...';
}

function triggerMobileTradImageUpload() {
  const input = document.getElementById('mob-trad-img-input');
  if (input) input.click();
}

async function handleMobileTradImageSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    showToastNotification('Processing image...', 'info');
    const result = await compressImageFile(file);
    activeTradAttachedImage = result;

    const tray = document.getElementById('mob-trad-img-preview-tray');
    const thumb = document.getElementById('mob-trad-img-thumb');
    const nameEl = document.getElementById('mob-trad-img-name');

    if (thumb) thumb.src = result.dataUrl;
    if (nameEl) nameEl.innerText = result.name;
    if (tray) tray.style.display = 'flex';

    showToastNotification('Photo attached to email 📸', 'success');
  } catch (err) {
    showToastNotification(err.message || 'Error processing image', 'error');
  }
}

function removeMobileTradAttachedImage() {
  activeTradAttachedImage = null;
  const input = document.getElementById('mob-trad-img-input');
  if (input) input.value = '';
  const tray = document.getElementById('mob-trad-img-preview-tray');
  if (tray) tray.style.display = 'none';
}

async function submitChatMessage() {
  if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
    currentUser = normalizeMobileUser(currentUser);
    if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
      showToastNotification('Session invalid. Please verify your phone number.', 'error');
      restoreSession();
      return;
    }
  }

  const input = document.getElementById('mob-chat-input');
  if (!input) return;
  const body = input.value.trim();
  if (!body && !activeChatAttachedImage) return;

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

  const imageSnapshot = activeChatAttachedImage ? activeChatAttachedImage.dataUrl : null;

  try {
    const payload = {
      sender_phone: currentUser.phone,
      to: to,
      subject: subject,
      body: body || '[Photo attached]',
      images: imageSnapshot ? [imageSnapshot] : [],
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
      removeMobileChatAttachedImage();

      // Append temporary outgoing message to timeline
      const now = new Date();
      const newMsg = {
        id: data.email ? data.email.id : `tmp_${Date.now()}`,
        sender_email: `${currentUser.phone}@alphastack.wwisvnr.com`,
        sender_name: currentUser.display_name || currentUser.phone,
        subject: subject,
        body_text: body || '[Photo attached]',
        body_html: imageSnapshot 
          ? `<div>${escapeHtml(body || '')}</div><div class="bubble-image-preview"><img src="${imageSnapshot}" alt="Photo"></div>`
          : (body || ''),
        created_at: now.toISOString(),
        is_read: 1,
        has_replied: 0,
        quoted_sender: activeReplyingMessage ? formatSenderDisplay(activeReplyingMessage.sender_email, false, activeReplyingMessage.sender_name) : null,
        quoted_text: activeReplyingMessage ? (activeReplyingMessage.body_text || '').substring(0, 90) : null
      };

      activeConversation.messages.push(newMsg);
      activeConversation.latestMessage = newMsg;
      activeConversation.latest_snippet = (body || '[Photo attached]').substring(0, 90);
      activeConversation.created_at = newMsg.created_at;

      renderChatTimeline(activeConversation);

      const timeline = document.getElementById('mob-chat-timeline');
      if (timeline) {
        timeline.scrollTop = timeline.scrollHeight;
      }

      showToastNotification(imageSnapshot ? 'Photo sent in email! 📸' : 'Reply sent ✓', 'success');
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
function openDigitalIdModal(initialTab = 'card') {
  openContactInfoModal(currentUser ? currentUser.phone : null, '', initialTab);
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

async function openContactInfoModal(phoneOrEmail, customName = '', initialTab = 'card') {
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

  // Set view to requested tab
  switchIdCardTab(initialTab || 'card');

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

async function downloadDigitalIdCard() {
  try {
    const nameEl = document.getElementById('id-card-name');
    const phoneEl = document.getElementById('id-card-phone');
    const emailEl = document.getElementById('id-card-email');
    const qrEl = document.getElementById('id-card-qr-img');
    const dateEl = document.getElementById('id-card-issue-date');

    const name = (nameEl ? nameEl.innerText : (currentUser ? currentUser.name || currentUser.display_name : 'INAI User')).trim();
    const phone = (phoneEl ? phoneEl.innerText : (currentUser ? currentUser.phone : '')).trim();
    const email = (emailEl ? emailEl.innerText : (currentUser ? `${currentUser.phone}@alphastack.wwisvnr.com` : '')).trim();
    const issueDate = (dateEl ? dateEl.innerText : new Date().toISOString().split('T')[0]).trim();

    // High-resolution canvas for crystal clear image export (1200 x 750)
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 750;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function roundRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    // Gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 750);
    bgGrad.addColorStop(0, '#0a1026');
    bgGrad.addColorStop(0.5, '#101a36');
    bgGrad.addColorStop(1, '#070b18');

    ctx.save();
    roundRect(ctx, 20, 20, 1160, 710, 36);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // Glowing border
    ctx.lineWidth = 4;
    const borderGrad = ctx.createLinearGradient(20, 20, 1180, 730);
    borderGrad.addColorStop(0, '#38bdf8');
    borderGrad.addColorStop(0.5, '#6366f1');
    borderGrad.addColorStop(1, '#10b981');
    ctx.strokeStyle = borderGrad;
    ctx.stroke();
    ctx.restore();

    // Indian Tiranga accent ribbon
    const triHeight = 8;
    const triY = 56;
    const triWidth = 1100 / 3;
    ctx.fillStyle = '#FF9933';
    ctx.fillRect(50, triY, triWidth, triHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(50 + triWidth, triY, triWidth, triHeight);
    ctx.fillStyle = '#138808';
    ctx.fillRect(50 + triWidth * 2, triY, triWidth, triHeight);

    // Header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PHONEMAIL DIGITAL IDENTITY CARD', 50, 115);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('INAI PROTOCOL • E2E VERIFIED IDENTITY', 50, 145);

    // EMV chip simulation
    const chipX = 50;
    const chipY = 180;
    const chipW = 80;
    const chipH = 62;
    ctx.save();
    roundRect(ctx, chipX, chipY, chipW, chipH, 8);
    const goldGrad = ctx.createLinearGradient(chipX, chipY, chipX + chipW, chipY + chipH);
    goldGrad.addColorStop(0, '#fcd34d');
    goldGrad.addColorStop(0.5, '#d97706');
    goldGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#78350f';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(chipX + 26, chipY);
    ctx.lineTo(chipX + 26, chipY + chipH);
    ctx.moveTo(chipX + 54, chipY);
    ctx.lineTo(chipX + 54, chipY + chipH);
    ctx.moveTo(chipX, chipY + 31);
    ctx.lineTo(chipX + chipW, chipY + 31);
    ctx.stroke();
    ctx.restore();

    // User Avatar circle
    const avatarX = 85;
    const avatarY = 350;
    const avatarR = 55;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = name ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'U';
    ctx.fillText(initials, avatarX, avatarY);
    ctx.restore();

    // User Details
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Full Name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(name || 'INAI Member', 165, 335);

    // Phone Number
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, monospace';
    ctx.fillText(phone || '+91 -', 165, 375);

    // INAI Address
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, monospace';
    ctx.fillText(email || 'user@alphastack.wwisvnr.com', 165, 415);

    // Sub-ID badge
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(165, 435, 180, 32);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('SUB-ID: .primary', 180, 457);

    // Meta details
    ctx.fillStyle = '#64748b';
    ctx.font = '600 17px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`ISSUED: ${issueDate}`, 50, 560);
    ctx.fillText('ALGORITHM: SHA-256 E2E • GOV COMPLIANT', 50, 590);
    ctx.fillText('GATEWAY: PHONE-TO-EMAIL REAL-TIME BRIDGE', 50, 620);

    // Status pill
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    roundRect(ctx, 50, 645, 290, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('⚡ 100% VERIFIED IDENTITY', 70, 671);

    // QR Code on right side
    const qrSize = 220;
    const qrX = 900;
    const qrY = 220;

    let qrDrawn = false;
    if (qrEl && qrEl.complete && qrEl.naturalWidth > 0) {
      try {
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 16);
        ctx.fill();
        ctx.drawImage(qrEl, qrX, qrY, qrSize, qrSize);
        qrDrawn = true;
      } catch (e) {}
    }

    if (!qrDrawn) {
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 16);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN TO EMAIL', qrX + qrSize / 2, qrY + qrSize / 2 - 10);
      ctx.font = '13px monospace';
      ctx.fillText(email, qrX + qrSize / 2, qrY + qrSize / 2 + 20);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan to Send Direct Email', qrX + qrSize / 2, qrY + qrSize + 40);

    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10) || 'user';
    const dataUrl = canvas.toDataURL('image/png');
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = dataUrl;
    downloadAnchor.download = `PhoneMail_Digital_ID_${cleanPhone}.png`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);

    showToastNotification('Digital ID Card downloaded successfully! 🪪', 'success');
  } catch (err) {
    console.error('Error downloading digital id card:', err);
    showToastNotification('Failed to download Digital ID: ' + err.message, 'error');
  }
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
  if (!activeConversation) return;
  const msgId = activeConversation.latestMessage ? activeConversation.latestMessage.id : (activeConversation.messages && activeConversation.messages[0] ? activeConversation.messages[0].id : activeConversation.id);
  if (msgId) {
    toggleImportant(msgId);
  }
}

function deleteCurrentEmail() {
  if (!activeConversation) return;
  activeConversation.messages.forEach(m => {
    executeBulkActionOnSingle(m.id, 'delete');
  });
  closeReadingPane();
}

async function blockCurrentMobileSender() {
  let senderEmail = null;
  let senderName = null;

  if (activeTradEmail) {
    senderEmail = activeTradEmail.sender_email;
    senderName = activeTradEmail.sender_name || senderEmail;
  } else if (activeEmail) {
    senderEmail = activeEmail.sender_email;
    senderName = activeEmail.sender_name || senderEmail;
  } else if (activeConversation) {
    senderEmail = activeConversation.participant_raw || (activeConversation.latestMessage && activeConversation.latestMessage.sender_email);
    senderName = activeConversation.sender_name || senderEmail;
  }

  if (!senderEmail || !currentUser || !currentUser.phone) {
    showToastNotification('Sender information not found', 'warning');
    return;
  }

  if (!confirm(`Are you sure you want to block ${senderName || senderEmail}? All future emails from this sender will be routed to Spam.`)) {
    return;
  }

  try {
    const res = await fetch('/api/emails/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPhone: currentUser.phone,
        sender: senderEmail
      })
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification(`Blocked ${senderName || senderEmail}. Future emails routed to Spam.`, 'success');
      closeReadingPane();
      closeTraditionalReadingPane();
      emailFolderCache = {};
      loadEmails(currentFolder);
      syncMobileFolderStats();
    } else {
      showToastNotification(data.error || 'Failed to block sender', 'error');
    }
  } catch (err) {
    showToastNotification('Error blocking sender: ' + err.message, 'error');
  }
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
  triggerMobileChatImageUpload();
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
    source_all: 'All',
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

let activeMobileDraftId = null;

function openDraftInMobileCompose(email) {
  if (!email) return;
  activeMobileDraftId = email.id;

  let recipientText = '';
  if (email.recipients) {
    try {
      const parsed = typeof email.recipients === 'string' ? JSON.parse(email.recipients) : email.recipients;
      if (Array.isArray(parsed)) recipientText = parsed.join(', ');
      else recipientText = String(email.recipients);
    } catch (e) {
      recipientText = String(email.recipients);
    }
  } else if (email.recipient_emails) {
    try {
      const parsed = typeof email.recipient_emails === 'string' ? JSON.parse(email.recipient_emails) : email.recipient_emails;
      if (Array.isArray(parsed)) recipientText = parsed.join(', ');
      else recipientText = String(email.recipient_emails);
    } catch (e) {
      recipientText = String(email.recipient_emails);
    }
  }

  openTraditionalCompose(recipientText, email.subject || '', email.body_text || email.body || '');
}

async function saveMobileDraft() {
  if (!currentUser || !currentUser.phone) {
    showToastNotification('Please log in to save drafts', 'error');
    return;
  }
  const to = (document.getElementById('trad-to')?.value || '').trim();
  const subject = (document.getElementById('trad-subject')?.value || '').trim();
  const body = (document.getElementById('trad-body')?.value || '').trim();

  if (!to && !subject && !body) {
    showToastNotification('Draft is empty. Enter recipient, subject, or content.', 'warning');
    return;
  }

  const recipients = to ? to.split(',').map(r => r.trim()).filter(Boolean) : [];

  try {
    const res = await fetch('/api/emails/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderPhone: currentUser.phone,
        toRecipients: recipients,
        subject: subject || '(No Subject)',
        bodyText: body || '',
        draftId: activeMobileDraftId
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeMobileDraftId = data.draftId;
      showToastNotification('Draft saved successfully! 📝', 'success');
      syncMobileFolderStats();
      if (currentFolder === 'DRAFTS') {
        emailFolderCache = {};
        loadEmails('DRAFTS');
      }
    } else {
      showToastNotification(data.error || 'Failed to save draft', 'error');
    }
  } catch (err) {
    showToastNotification('Error saving draft: ' + err.message, 'error');
  }
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
  removeMobileTradAttachedImage();
  document.getElementById('traditional-modal').style.display = 'none';
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
  const verifyPill = document.getElementById('mob-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }
  activeMobileDraftId = null;
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
  if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
    currentUser = normalizeMobileUser(currentUser);
    if (!currentUser || !currentUser.phone || currentUser.phone.length !== 10) {
      showToastNotification('Session invalid. Please verify your phone number.', 'error');
      restoreSession();
      return;
    }
  }

  const to = (document.getElementById('trad-to')?.value || '').trim();
  const subject = (document.getElementById('trad-subject')?.value || '').trim();
  const body = (document.getElementById('trad-body')?.value || '').trim();

  if (!to) {
    showToastNotification('Please enter a recipient', 'warning');
    return;
  }
  if (!body && !activeTradAttachedImage && !activeTradVoiceMail) {
    showToastNotification('Please enter a message, attach an image, or record a voice mail', 'warning');
    return;
  }

  const sendSms = Boolean(document.getElementById('mob-send-textbee-sms')?.checked);
  const imageSnapshot = activeTradAttachedImage ? activeTradAttachedImage.dataUrl : null;
  const voiceSnapshot = activeTradVoiceMail ? { ...activeTradVoiceMail } : null;

  showToastNotification('Sending message...', 'info');

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_phone: currentUser.phone,
        to,
        subject,
        body: body || (voiceSnapshot ? `🎙️ Voice Mail (${voiceSnapshot.duration})` : '[Photo attached]'),
        images: imageSnapshot ? [imageSnapshot] : [],
        voiceMail: voiceSnapshot,
        send_sms: sendSms
      })
    });
    const data = await res.json();
    if (data.success) {
      if (activeMobileDraftId) {
        fetch(`/api/emails/draft/${activeMobileDraftId}`, { method: 'DELETE' }).catch(() => {});
        activeMobileDraftId = null;
      }
      if (data.sms_dispatched) {
        showToastNotification('Message & Voice sent! Recipient notified via TextBee SMS 📱', 'success');
      } else {
        showToastNotification(voiceSnapshot ? 'Voice Mail sent! 🎙️🚀' : (imageSnapshot ? 'Email with image sent! 📸🚀' : 'Message sent successfully! 🚀'), 'success');
      }
      closeTraditionalCompose();
      removeMobileTradVoiceMail();
      // Invalidate cache and reload
      emailFolderCache = {};
      loadEmails(currentFolder);
      syncMobileFolderStats();
    } else {
      showToastNotification(data.error || 'Failed to send message', 'error');
    }
  } catch (err) {
    console.error('Send error:', err);
    showToastNotification(err.message || 'Failed to send message', 'error');
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
  const d = parseEmailDate(dateVal);
  if (!d) return false;

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

// ==================== BROWSER HISTORY & BACK GESTURE SUPPORT ====================
window.addEventListener('popstate', (e) => {
  const readingPane = document.getElementById('reading-pane');
  const tradView = document.getElementById('mob-traditional-reading-view');
  const modalWrapper = document.getElementById('traditional-modal');
  const infoModal = document.getElementById('mob-contact-info-modal');

  if (modalWrapper && modalWrapper.style.display === 'flex') {
    closeTraditionalCompose();
    return;
  }
  if (infoModal && infoModal.style.display === 'flex') {
    closeContactInfoModal();
    return;
  }
  if (tradView && tradView.style.display === 'flex') {
    closeMobileTraditionalReading(false);
    return;
  }
  if (readingPane && readingPane.style.display === 'flex') {
    closeReadingPane(false);
    return;
  }
});

// Horizontal swipe gesture on chat top bar to easily exit thread
document.addEventListener('DOMContentLoaded', () => {
  const topBar = document.querySelector('.whatsapp-top-bar');
  if (topBar) {
    let startX = 0;
    topBar.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) startX = e.touches[0].clientX;
    }, { passive: true });
    topBar.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const diffX = e.changedTouches[0].clientX - startX;
        if (diffX > 60) {
          closeReadingPane();
        }
      }
    }, { passive: true });
  }
});

// ==================== VOICE MAIL RECORDING & PLAYBACK CONTROLLER ====================
let voiceMediaRecorder = null;
let voiceMediaStream = null;
let voiceAudioChunks = [];
let voiceTimerInterval = null;
let voiceRecordSeconds = 0;
let voiceActiveContext = null; // 'mobile-chat' | 'mobile-trad'
let voiceSpeechRecognition = null;
let voiceLiveTranscript = '';
let activeTradVoiceMail = null; // { dataUrl, duration, transcription }

// Global Audio Bubble Playback State
let currentActiveAudio = null;
let currentPlayingMsgId = null;

async function toggleVoiceRecording(context) {
  if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
    if (context === 'mobile-chat') {
      await sendVoiceRecording('mobile-chat');
    } else {
      await stopVoiceRecording(context);
    }
  } else {
    await startVoiceRecording(context);
  }
}

async function startVoiceRecording(context) {
  voiceActiveContext = context;
  voiceAudioChunks = [];
  voiceRecordSeconds = 0;
  voiceLiveTranscript = '';

  try {
    voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('Microphone permission denied or unavailable:', err);
    showToastNotification('Microphone access denied. Please allow microphone permissions in settings.', 'error');
    return;
  }

  // Determine best audio mime type supported
  let mimeType = 'audio/webm;codecs=opus';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
    if (MediaRecorder.isTypeSupported(mimeType)) {}
    else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
    else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
    else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
    else mimeType = '';
  } else {
    mimeType = '';
  }

  try {
    voiceMediaRecorder = mimeType ? new MediaRecorder(voiceMediaStream, { mimeType }) : new MediaRecorder(voiceMediaStream);
  } catch(e) {
    voiceMediaRecorder = new MediaRecorder(voiceMediaStream);
  }

  voiceMediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      voiceAudioChunks.push(e.data);
    }
  };

  // Start Live Speech-to-Text Recognition in Background
  try {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      voiceSpeechRecognition = new SpeechRec();
      voiceSpeechRecognition.continuous = true;
      voiceSpeechRecognition.interimResults = true;
      const langMap = { 'hi': 'hi-IN', 'ta': 'ta-IN', 'en': 'en-IN' };
      voiceSpeechRecognition.lang = (currentUser && langMap[currentUser.language]) ? langMap[currentUser.language] : 'en-US';
      voiceSpeechRecognition.onresult = (evt) => {
        let text = '';
        for (let i = 0; i < evt.results.length; i++) {
          text += evt.results[i][0].transcript + ' ';
        }
        voiceLiveTranscript = text.trim();
        const hintEl = document.getElementById('mob-voice-live-text');
        if (hintEl && voiceLiveTranscript) {
          hintEl.innerText = voiceLiveTranscript;
        }
      };
      voiceSpeechRecognition.start();
    }
  } catch (recErr) {
    console.warn('Speech recognition notice:', recErr.message);
  }

  voiceMediaRecorder.start(200);

  // Update UI for recording state
  if (context === 'mobile-chat') {
    const overlay = document.getElementById('mob-voice-recording-overlay');
    if (overlay) overlay.style.display = 'flex';
    const hintEl = document.getElementById('mob-voice-live-text');
    if (hintEl) hintEl.innerText = 'Listening...';
    const timerEl = document.getElementById('mob-voice-timer');
    if (timerEl) timerEl.innerText = '0:00';
  } else if (context === 'mobile-trad') {
    const btn = document.getElementById('mob-trad-voice-btn');
    if (btn) btn.classList.add('recording');
    const lbl = document.getElementById('mob-trad-voice-label');
    if (lbl) lbl.innerText = 'Recording (0:00)...';
  }

  // Timer interval
  clearInterval(voiceTimerInterval);
  voiceTimerInterval = setInterval(() => {
    voiceRecordSeconds++;
    const mins = Math.floor(voiceRecordSeconds / 60);
    const secs = voiceRecordSeconds % 60;
    const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const timerEl = document.getElementById('mob-voice-timer');
    if (timerEl) timerEl.innerText = timeStr;

    if (context === 'mobile-trad') {
      const lbl = document.getElementById('mob-trad-voice-label');
      if (lbl) lbl.innerText = `Recording (${timeStr})...`;
    }
  }, 1000);
}

function cancelVoiceRecording(context) {
  clearInterval(voiceTimerInterval);
  if (voiceSpeechRecognition) {
    try { voiceSpeechRecognition.stop(); } catch(e) {}
    voiceSpeechRecognition = null;
  }
  if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
    voiceMediaRecorder.stop();
  }
  if (voiceMediaStream) {
    voiceMediaStream.getTracks().forEach(t => t.stop());
    voiceMediaStream = null;
  }
  voiceAudioChunks = [];
  voiceRecordSeconds = 0;

  if (context === 'mobile-chat') {
    const overlay = document.getElementById('mob-voice-recording-overlay');
    if (overlay) overlay.style.display = 'none';
  } else if (context === 'mobile-trad') {
    const btn = document.getElementById('mob-trad-voice-btn');
    if (btn) btn.classList.remove('recording');
    const lbl = document.getElementById('mob-trad-voice-label');
    if (lbl) lbl.innerText = activeTradVoiceMail ? 'Re-record Voice' : 'Voice Mail';
  }
}

async function sendVoiceRecording(context) {
  clearInterval(voiceTimerInterval);
  if (voiceSpeechRecognition) {
    try { voiceSpeechRecognition.stop(); } catch(e) {}
    voiceSpeechRecognition = null;
  }

  if (!voiceMediaRecorder || voiceMediaRecorder.state === 'inactive') {
    cancelVoiceRecording(context);
    return;
  }

  const mins = Math.floor(voiceRecordSeconds / 60);
  const secs = voiceRecordSeconds % 60;
  const durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return new Promise((resolve) => {
    voiceMediaRecorder.onstop = async () => {
      if (voiceMediaStream) {
        voiceMediaStream.getTracks().forEach(t => t.stop());
        voiceMediaStream = null;
      }

      const mimeType = voiceMediaRecorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(voiceAudioChunks, { type: mimeType });

      // Convert to base64 Data URL
      const reader = new FileReader();
      reader.onloadend = async () => {
        const audioDataUrl = reader.result;

        if (context === 'mobile-chat') {
          const overlay = document.getElementById('mob-voice-recording-overlay');
          if (overlay) overlay.style.display = 'none';

          if (!activeConversation) return resolve();

          const to = activeConversation.participant_raw || activeConversation.participant_phone || (activeConversation.latestMessage ? activeConversation.latestMessage.sender_email : null);
          if (!to) {
            showToastNotification('Could not determine recipient for this chat', 'error');
            return resolve();
          }

          const cleanSubject = (activeConversation.latest_subject || activeConversation.subject || '').replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '');
          const subject = cleanSubject ? `Re: ${cleanSubject}` : `🎙️ Voice Mail (${durationStr})`;
          const body = `🎙️ Voice Mail (${durationStr})${voiceLiveTranscript ? `\n\n"${voiceLiveTranscript}"` : ''}`;

          try {
            const payload = {
              sender_phone: currentUser.phone,
              to: to,
              subject: subject,
              body: body,
              voiceMail: {
                dataUrl: audioDataUrl,
                duration: durationStr,
                transcription: voiceLiveTranscript
              },
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
              if (activeReplyingMessage) activeReplyingMessage.has_replied = 1;
              cancelQuotedReply();

              // Append outgoing voicemail note to timeline immediately
              const now = new Date();
              const newMsg = {
                id: data.email ? data.email.id : `tmp_${Date.now()}`,
                sender_email: `${currentUser.phone}@alphastack.wwisvnr.com`,
                sender_name: currentUser.display_name || currentUser.phone,
                subject: subject,
                body_text: body,
                body_html: `<div class="inai-voicemail-player" data-duration="${durationStr}" data-audio-src="${audioDataUrl}"><audio src="${audioDataUrl}"></audio>${voiceLiveTranscript ? `<div class="voicemail-transcript-box"><span>${voiceLiveTranscript}</span></div>` : ''}</div>`,
                created_at: now.toISOString(),
                is_read: 1,
                has_replied: 0
              };
              activeConversation.messages.push(newMsg);
              renderChatTimeline(activeConversation);

              showToastNotification('Voice mail sent! 🎙️🚀', 'success');
              if (navigator.vibrate) navigator.vibrate([40]);
            }
          } catch(err) {
            console.error('Failed to send voice mail:', err);
            showToastNotification('Failed to send voice mail', 'error');
          }
        } else if (context === 'mobile-trad') {
          activeTradVoiceMail = {
            dataUrl: audioDataUrl,
            duration: durationStr,
            transcription: voiceLiveTranscript
          };

          const btn = document.getElementById('mob-trad-voice-btn');
          if (btn) btn.classList.remove('recording');
          const lbl = document.getElementById('mob-trad-voice-label');
          if (lbl) lbl.innerText = 'Re-record Voice';

          const tray = document.getElementById('mob-trad-voice-preview-tray');
          if (tray) tray.style.display = 'block';
          const durEl = document.getElementById('mob-trad-voice-duration');
          if (durEl) durEl.innerText = `Voice Mail (${durationStr})`;
          const audEl = document.getElementById('mob-trad-voice-audio');
          if (audEl) audEl.src = audioDataUrl;

          showToastNotification(`Voice mail recorded (${durationStr}) 🎙️`, 'info');
        }
        resolve();
      };
      reader.readAsDataURL(audioBlob);
    };
    voiceMediaRecorder.stop();
  });
}

function stopVoiceRecording(context) {
  sendVoiceRecording(context);
}

function removeMobileTradVoiceMail() {
  activeTradVoiceMail = null;
  const tray = document.getElementById('mob-trad-voice-preview-tray');
  if (tray) tray.style.display = 'none';
  const audEl = document.getElementById('mob-trad-voice-audio');
  if (audEl) audEl.src = '';
  const lbl = document.getElementById('mob-trad-voice-label');
  if (lbl) lbl.innerText = 'Voice Mail';
}

// ==================== WHATSAPP AUDIO BUBBLE PLAYBACK ====================
function toggleAudioBubblePlayback(msgId, audioSrc, btnEl) {
  if (currentActiveAudio && currentPlayingMsgId === msgId) {
    if (currentActiveAudio.paused) {
      currentActiveAudio.play();
      updateAudioBubblePlayState(msgId, true);
    } else {
      currentActiveAudio.pause();
      updateAudioBubblePlayState(msgId, false);
    }
    return;
  }

  // Stop any previously playing audio
  if (currentActiveAudio) {
    currentActiveAudio.pause();
    if (currentPlayingMsgId) updateAudioBubblePlayState(currentPlayingMsgId, false);
    currentActiveAudio = null;
    currentPlayingMsgId = null;
  }

  const audio = new Audio(audioSrc);
  currentActiveAudio = audio;
  currentPlayingMsgId = msgId;

  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const progress = (audio.currentTime / audio.duration) * 100;
    const curMins = Math.floor(audio.currentTime / 60);
    const curSecs = Math.floor(audio.currentTime % 60);
    const timeStr = `${curMins}:${curSecs < 10 ? '0' : ''}${curSecs}`;

    const timerEl = document.getElementById(`voice-timer-${msgId}`);
    if (timerEl) timerEl.innerText = timeStr;

    // Highlight wave bars
    const waveContainer = document.getElementById(`waveform-bars-${msgId}`);
    if (waveContainer) {
      const bars = waveContainer.querySelectorAll('.wave-bar');
      const activeBarCount = Math.floor((progress / 100) * bars.length);
      bars.forEach((b, idx) => {
        if (idx <= activeBarCount) b.classList.add('played');
        else b.classList.remove('played');
      });
    }
  };

  audio.onended = () => {
    updateAudioBubblePlayState(msgId, false);
    const timerEl = document.getElementById(`voice-timer-${msgId}`);
    if (timerEl) timerEl.innerText = '0:00';
    const waveContainer = document.getElementById(`waveform-bars-${msgId}`);
    if (waveContainer) {
      waveContainer.querySelectorAll('.wave-bar').forEach(b => b.classList.remove('played'));
    }
    currentActiveAudio = null;
    currentPlayingMsgId = null;
  };

  audio.play().then(() => {
    updateAudioBubblePlayState(msgId, true);
  }).catch(err => {
    console.error('Audio playback error:', err);
  });
}

function updateAudioBubblePlayState(msgId, isPlaying) {
  const player = document.getElementById(`voice-player-${msgId}`);
  if (!player) return;
  const playIcon = player.querySelector('.play-icon');
  const pauseIcon = player.querySelector('.pause-icon');
  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }
}

function seekAudioBubble(msgId, event) {
  if (!currentActiveAudio || currentPlayingMsgId !== msgId || !currentActiveAudio.duration) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  currentActiveAudio.currentTime = ratio * currentActiveAudio.duration;
}

function toggleAudioSpeed(msgId, speedBtn) {
  if (!currentActiveAudio || currentPlayingMsgId !== msgId) return;
  let nextSpeed = 1;
  if (currentActiveAudio.playbackRate === 1) nextSpeed = 1.5;
  else if (currentActiveAudio.playbackRate === 1.5) nextSpeed = 2;
  else nextSpeed = 1;

  currentActiveAudio.playbackRate = nextSpeed;
  speedBtn.innerText = `${nextSpeed}x`;
}

function toggleTranscriptView(msgId) {
  const el = document.getElementById(`voice-transcript-${msgId}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ==================== APP INITIALIZATION & BROWSER RESUME ====================
function bootMobileApp() {
  restoreSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMobileApp);
} else {
  bootMobileApp();
}

// Handle iOS Safari / mobile background-foreground resume & bfcache
window.addEventListener('pageshow', (event) => {
  // If restored from bfcache or resumed, re-verify session and refresh inbox
  if (currentUser && currentUser.phone) {
    initAppView();
  } else {
    restoreSession();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (currentUser && currentUser.phone) {
      // Re-sync inbox silently without resetting view
      if (typeof loadEmails === 'function') {
        loadEmails(currentFolder);
      }
    } else {
      restoreSession();
    }
  }
});
