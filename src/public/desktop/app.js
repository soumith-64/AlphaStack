// Strict Device Guard: Phone/Mobile users are restricted to Mobile views (Traditional & Messenger)
if ((window.innerWidth <= 768 || /mobile|iphone|android|ipad|phone/i.test(navigator.userAgent)) && window.location.pathname !== '/') {
  window.location.replace('/');
}

// Clean URL: Keep address bar as clean "alphastack.wwisvnr.com" (strip /desktop)
try {
  if (window.location.pathname.startsWith('/desktop')) {
    window.history.replaceState(null, document.title, '/' + (window.location.search || ''));
  }
} catch(e) {}

// ==================== STATE MANAGEMENT ====================
let currentUser = null;

let currentFolder = 'ALL';
let currentMailSourceFilter = 'all'; // 'all' | 'phonemail' | 'external'
let currentQuickFilter = 'all'; // 'all' | 'unread' | 'attachments' | 'starred'
let currentDateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
let customDateStart = '';
let customDateEnd = '';
let searchTerm = '';
let allEmails = [];
let activeEmail = null;
let selectedEmailIndex = -1;
let socket = null;
let currentReplyToId = null;
let currentReplyConvId = null;
let cachedContacts = [];
let cachedDeviceContacts = [];
let selectedEmailIds = new Set();
let emailFolderCache = {};
let currentLanguage = localStorage.getItem('inai_lang') || 'en';
let isMessageTranslated = false;
let originalMessageBody = '';
let originalMessageSubject = '';
let allConversations = [];
let activeConversation = null;
let activeConversationId = null;
let activeReplyingMessage = null;
let activeContactForModal = null;
let activeContactModalIsSelf = true;
let currentEmailPage = 1;
const EMAIL_PAGE_SIZE = 50;

// ==================== RESPONSIVE SIDEBAR TOGGLE ====================
function toggleSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  if (window.innerWidth <= 900) {
    sidebar.classList.toggle('open');
    if (backdrop) backdrop.classList.toggle('active');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

// ==================== NOTIFICATION CHIME (WEB AUDIO API) ====================
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    
    // Note 1: High crisp D5 (587.33Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Note 2: Bright chime A5 (880.00Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.1);
    gain2.gain.setValueAtTime(0.18, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.5);
  } catch (e) {
    // browser auto-play restriction safety
  }
}

// ==================== STRING UTILITIES & DOMAIN PRIVACY ====================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Checks whether an email address is from an internal PhoneMail user
 * or an external mail provider (e.g. Gmail, Rediff, Yahoo, Outlook, etc.)
 */
function isPhoneMailSender(rawSender) {
  if (!rawSender) return false;
  const str = String(rawSender).toLowerCase();
  
  // Explicit external domains
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

  // Internal PhoneMail domain identifiers or 10-digit Indian phone pattern
  if (
    str.includes('@alphastack.wwisvnr.com') ||
    str.includes('@phonemail.com') ||
    /\b\d{10}\b/.test(str)
  ) {
    return true;
  }

  // Any external domain not matching alphastack or phonemail
  if (str.includes('@') && !str.includes('alphastack.wwisvnr.com') && !str.includes('phonemail.com')) {
    return false;
  }

  return true;
}

function formatPhoneDisplay(digits, tag = '') {
  const p = String(digits).replace(/\D/g, '').slice(-10);
  if (p.length === 10) {
    const formatted = `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
    return tag ? `${formatted} (.${tag})` : formatted;
  }
  return digits;
}

/**
 * Cleanly format sender:
 * - If from another PhoneMail user: HIDE @alphastack.wwisvnr.com and just show the phone number (+91 93815 64959)
 * - If from external (Gmail, Rediff, etc.): show display name and external email.
 */
function lookupContactName(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  if (!digits || digits.length !== 10) return '';

  // 1. Check in-memory cached contacts & device contacts
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

  // 2. Check localStorage persistent custom contact names map
  try {
    const customMap = JSON.parse(localStorage.getItem('inai_custom_contact_names') || '{}');
    if (customMap[digits]) return customMap[digits].trim();
  } catch (e) {}

  // 3. Check localStorage cached device names
  try {
    const namesMap = JSON.parse(localStorage.getItem('phonemail_cached_device_names') || '{}');
    for (const [k, v] of Object.entries(namesMap)) {
      if (String(k).replace(/\D/g, '').slice(-10) === digits && v && !/^User\s*\d+/i.test(v)) {
        return v.trim();
      }
    }
  } catch (e) {}

  // 4. Check allEmails for any email where sender or recipient had a real display name for these digits
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
      // Heuristic: check subject line for "hi [Name]" or "Hi [Name]"
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
  const angleMatch = str.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  if (angleMatch) {
    if (!name) name = (angleMatch[1] || '').trim().replace(/^["']+|["']+$/g, '');
    email = (angleMatch[2] || '').trim();
  } else {
    email = str.replace(/^[<"']+|[>"']+$/g, '').trim();
  }

  // Check for internal PhoneMail / INAI pattern (e.g. 7904775295@alphastack.wwisvnr.com or 7904775295)
  const isFromInai = isPhoneMailSender(email);
  const phoneAliasMatch = email.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  const plainPhoneMatch = email.match(/^(\d{10})@/);
  const digitsOnly = email.replace(/\D/g, '').slice(-10);
  const has10Digits = digitsOnly && digitsOnly.length === 10;

  if (isFromInai && (phoneAliasMatch || plainPhoneMatch || has10Digits)) {
    const phone = phoneAliasMatch ? phoneAliasMatch[1] : (plainPhoneMatch ? plainPhoneMatch[1] : digitsOnly);
    const tag = phoneAliasMatch && phoneAliasMatch[2] ? phoneAliasMatch[2] : '';
    const phoneFormatted = formatPhoneDisplay(phone, tag);

    // Try contact lookup if name is not set or generic
    if (!name || /^User\s*\d+/i.test(name) || name.replace(/\D/g, '') === phone) {
      const contactName = lookupContactName(phone);
      if (contactName) {
        name = contactName;
      }
    }

    // If we have a real name (e.g. "Soumith", "Rahul", etc.)
    if (name && !/^User\s*\d+/i.test(name) && name.replace(/\D/g, '') !== phone) {
      name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return `${name} (${phoneFormatted})`;
    }

    // Default for INAI user: always show Name and Phone number in bracket
    return `User (${phoneFormatted})`;
  }

  // External email (e.g. Gmail, Yahoo, Rediff, Hostinger)
  if (name && name.toLowerCase() !== email.toLowerCase()) {
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${name} (${email})`;
  }

  // Just email address (e.g. johndoe@gmail.com)
  return email;
}

function cleanRecipientAddress(addr) {
  if (!addr) return '';
  let str = String(addr).trim();

  // If format is "Name" <email/phone>
  const angleMatch = str.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  let explicitName = '';
  if (angleMatch) {
    explicitName = (angleMatch[1] || '').trim().replace(/^["']+|["']+$/g, '');
    str = (angleMatch[2] || '').trim();
  }

  const phoneAliasMatch = str.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  const plainPhoneMatch = str.match(/^(\d{10})@/);
  const digitsOnly = str.replace(/\D/g, '').slice(-10);

  if (phoneAliasMatch || plainPhoneMatch || (digitsOnly && digitsOnly.length === 10 && !str.includes('@'))) {
    const phone = phoneAliasMatch ? phoneAliasMatch[1] : (plainPhoneMatch ? plainPhoneMatch[1] : digitsOnly);
    const tag = phoneAliasMatch && phoneAliasMatch[2] ? phoneAliasMatch[2] : '';
    const phoneFormatted = formatPhoneDisplay(phone, tag);

    const contactName = explicitName || lookupContactName(phone);
    if (contactName && !/^User\s*\d+/i.test(contactName) && contactName.replace(/\D/g, '') !== phone) {
      return `${contactName} (${phoneFormatted})`;
    }
    return phoneFormatted;
  }

  if (explicitName && explicitName.toLowerCase() !== str.toLowerCase()) {
    return `${explicitName} (${str})`;
  }
  return str;
}

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return 'IN';
  // Strip "To:" or "From:" prefix if present
  let clean = String(nameOrEmail).replace(/^(?:To|From):\s*/i, '');
  // If format is "Name (+91 ...)", extract only the name part
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
    if (alpha.length >= 2) {
      if (/^[a-zA-Z]+$/.test(alpha)) {
        return (alpha[0] + alpha[1]).toUpperCase();
      }
    }
  }
  const letterMatch = clean.match(/[a-zA-Z]/);
  if (letterMatch) {
    return letterMatch[0].toUpperCase();
  }
  const digits = clean.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  return 'IN';
}

/**
 * Deterministic vivid SVG profile picture generator
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
  if (cleanId && typeof allContacts !== 'undefined' && Array.isArray(allContacts)) {
    const contact = allContacts.find(c => {
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

function normalizeSubject(sub) {
  if (!sub) return '(no subject)';
  let s = String(sub).trim();
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
    if (new Date(email.created_at) > new Date(conv.created_at)) {
      conv.created_at = email.created_at;
      conv.subject = email.subject || conv.subject;
    }
  });

  const convList = [];
  convMap.forEach(conv => {
    conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const latest = conv.messages[conv.messages.length - 1];
    conv.latestMessage = latest;
    conv.latest_subject = latest.subject || conv.subject || '(No Subject)';
    conv.latest_snippet = (latest.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);
    conv.message_count = conv.messages.length;
    conv.is_read = conv.messages.every(m => m.is_read === 1) ? 1 : 0;
    conv.unread_count = conv.messages.filter(m => m.is_read === 0).length;

    const isGroup = conv.key.startsWith('group_');
    conv.is_group = isGroup;

    const myClean = (myPhone || '').replace(/\D/g, '');
    let counterpart = '';
    let senderName = '';

    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      const s = extractCleanParticipant(m.sender_email);
      if (!s.includes(myClean)) {
        counterpart = s;
        senderName = m.sender_name || '';
        break;
      }
    }
    if (!counterpart) {
      counterpart = extractCleanParticipant(latest.recipient_phone || latest.sender_email);
      senderName = latest.sender_name || '';
    }

    conv.participant_raw = counterpart;
    conv.sender_name = senderName;

    const isPhoneMail = isPhoneMailSender(counterpart);
    conv.is_phonemail = isPhoneMail;

    if (isGroup) {
      conv.display_title = `Group (${conv.message_count} msgs)`;
      conv.display_subtitle = '👥 Group Conversation';
    } else {
      const formatted = formatSenderDisplay(counterpart, false, senderName);
      conv.display_title = formatted;
      conv.display_subtitle = isPhoneMail ? '⚡ INAI Verified' : '🌐 External Mail';
    }

    const seed = conv.display_title || counterpart;
    conv.avatar_url = latest.participant_avatar || generateDefaultAvatar(seed, conv.display_title);

    convList.push(conv);
  });

  convList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return convList;
}

function getRecipientsDisplay(email) {
  if (!email) return '';
  let list = [];
  if (email.recipient_emails) {
    try {
      const parsed = JSON.parse(email.recipient_emails);
      if (Array.isArray(parsed) && parsed.length > 0) {
        list = parsed.filter(Boolean);
      } else if (typeof parsed === 'string') {
        list = [parsed];
      }
    } catch (e) {
      const clean = String(email.recipient_emails).replace(/[\[\]"']/g, '').trim();
      if (clean) list = clean.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return list.map(cleanRecipientAddress).join(', ');
}

function getFolderFriendlyName(folder) {
  const map = {
    'ALL': 'All Mail',
    'INBOX': 'Inbox',
    'IMPORTANT': 'Important Messages',
    'STARRED': 'Starred Messages',
    'SENT': 'Sent Mail',
    'DRAFTS': 'Drafts',
    'ARCHIVE': 'Archive',
    'SPAM': 'Spam Filter',
    'TRASH': 'Trash Bin'
  };
  return map[folder] || folder;
}

// ==================== MODERN POPUP TOAST & NOTIFICATION SYSTEM ====================
function showNotify(options) {
  let opts = typeof options === 'string' ? { message: options, type: 'info' } : (options || {});
  const container = document.getElementById('app-toast-container') || document.body;
  const toast = document.createElement('div');
  const type = opts.type || 'info';
  const duration = opts.duration !== undefined ? opts.duration : 4000;
  toast.className = `app-toast ${type}`;

  const iconMap = {
    success: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const defaultTitles = {
    success: 'Success',
    error: 'Error',
    warning: 'Attention',
    info: 'PhoneMail'
  };

  const title = opts.title || defaultTitles[type] || 'Notice';
  const message = opts.message || '';

  toast.innerHTML = `
    <div class="app-toast-icon-wrap">${iconMap[type] || iconMap.info}</div>
    <div class="app-toast-content">
      <div class="app-toast-title">${escapeHtml(title)}</div>
      <div class="app-toast-message">${escapeHtml(message)}</div>
    </div>
    <button type="button" class="app-toast-close" title="Dismiss">✕</button>
  `;

  const closeBtn = toast.querySelector('.app-toast-close');
  const dismiss = () => {
    toast.classList.remove('visible');
    toast.classList.add('hiding');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  };
  closeBtn.onclick = dismiss;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

showNotify.success = (msg, title) => showNotify({ type: 'success', message: msg, title: title || 'Success' });
showNotify.error = (msg, title) => showNotify({ type: 'error', message: msg, title: title || 'Error' });
showNotify.warning = (msg, title) => showNotify({ type: 'warning', message: msg, title: title || 'Attention' });
showNotify.info = (msg, title) => showNotify({ type: 'info', message: msg, title: title || 'PhoneMail' });

function showToastNotification(msg, type = 'info') {
  if (typeof type === 'string' && showNotify[type]) {
    showNotify[type](msg);
  } else {
    showNotify({ message: msg, type: 'info' });
  }
}

function showPromptDialog({ title, message, placeholder = '', defaultValue = '', confirmText = 'Search', cancelText = 'Cancel', onConfirm }) {
  const overlay = document.getElementById('app-dialog-overlay');
  if (!overlay) {
    const val = prompt(`${title}\n${message}`, defaultValue);
    if (val !== null && onConfirm) onConfirm(val);
    return;
  }

  overlay.innerHTML = `
    <div class="app-dialog-card">
      <div class="app-dialog-header">
        <div class="app-dialog-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <div class="app-dialog-title">${escapeHtml(title)}</div>
      </div>
      <div class="app-dialog-body">${escapeHtml(message)}</div>
      <input type="text" class="app-dialog-input" id="app-dialog-input-field" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
      <div class="app-dialog-actions">
        <button type="button" class="action-btn" id="dialog-cancel-btn" style="padding: 7px 14px; font-size: 13px;">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn-primary" id="dialog-confirm-btn" style="min-width: 90px; padding: 7px 16px; font-size: 13px;">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;
  overlay.style.display = 'flex';

  const input = document.getElementById('app-dialog-input-field');
  const cancelBtn = document.getElementById('dialog-cancel-btn');
  const confirmBtn = document.getElementById('dialog-confirm-btn');

  setTimeout(() => input && input.focus(), 60);

  const closeDialog = () => {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  };

  cancelBtn.onclick = closeDialog;
  confirmBtn.onclick = () => {
    const val = input.value.trim();
    closeDialog();
    if (onConfirm) onConfirm(val);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      confirmBtn.click();
    } else if (e.key === 'Escape') {
      closeDialog();
    }
  };
}

// ==================== THEME MANAGEMENT (TIRANGA LIGHT & DARK) ====================
function initTheme() {
  const savedTheme = localStorage.getItem('phonemail-theme') || 'light';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('phonemail-theme', theme);
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (toggleBtn) {
    toggleBtn.innerText = theme === 'dark' ? '☀️' : '🌙';
    toggleBtn.title = theme === 'dark' ? 'Switch to Tiranga Light Mode' : 'Switch to Tiranga Dark Mode';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const nextTheme = current === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  showToastNotification(`Switched to Tiranga ${nextTheme === 'dark' ? 'Dark' : 'Light'} Mode 🇮🇳`);
}

// Auto-run theme initialization immediately
initTheme();

// ==================== SESSION PERSISTENCE & PHONE.EMAIL LISTENER ====================
function saveDesktopSession(user) {
  currentUser = user;
  const remEl = document.getElementById('auth-remember-me');
  const remember = remEl ? remEl.checked : true;
  const str = JSON.stringify(user);
  if (remember) {
    localStorage.setItem('phonemail-user', str);
    localStorage.setItem('inai_user', str);
    localStorage.setItem('phonemail-mobile-user', str);
    if (user.phone) localStorage.setItem('phonemail_saved_phone', user.phone);
  }
  sessionStorage.setItem('phonemail-user', str);
  document.documentElement.classList.add('has-saved-session');
}

let isVerifyingPhoneEmailDesktop = false;
window.phoneEmailListener = async (userObj) => {
  if (!userObj || !userObj.user_json_url) return;
  if (isVerifyingPhoneEmailDesktop) return;
  isVerifyingPhoneEmailDesktop = true;

  const { user_json_url } = userObj;
  console.log('📱 [Phone.Email Verification Success] JSON URL:', user_json_url);
  showToastNotification('Phone verified via Phone.Email! Entering mailbox...');

  try {
    const res = await fetch('/api/auth/phone-email-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_json_url, clientType: 'WEB_CLIENT' })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };

      saveDesktopSession(currentUser);
      document.getElementById('desktop-auth-container').style.display = 'none';
      document.getElementById('desktop-main-container').style.display = 'flex';
      playNotificationChime();
      initDesktopApp();
      showNotify.success(`Welcome to PhoneMail, ${currentUser.name}! 🇮🇳`, 'Signed In');
    } else {
      isVerifyingPhoneEmailDesktop = false;
      showNotify.error(data.error || 'Failed to authenticate phone number with Phone.Email', 'Auth Failed');
    }
  } catch (err) {
    isVerifyingPhoneEmailDesktop = false;
    showNotify.error('Verification communication error: ' + err.message, 'Network Error');
  }
};

function loadPhoneEmailScript() {
  if (document.getElementById('pe-signin-script')) return;
  const script = document.createElement('script');
  script.id = 'pe-signin-script';
  script.src = 'https://www.phone.email/sign_in_button_v1.js';
  script.async = true;
  document.body.appendChild(script);
}

function triggerPhoneEmailLogin() {
  const btn = document.getElementById('phonemail-hero-btn');
  const peBtn = document.getElementById('btn_ph_login') || document.querySelector('.pe_signin_button button');

  // If the Phone.Email SDK button is already generated, click it
  if (peBtn) {
    try {
      peBtn.click();
      return;
    } catch (e) {}
  }

  if (btn) {
    btn.style.opacity = '0.75';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Connecting to Phone.Email secure gateway...';
  }

  // Fallback: open official secure login popup directly
  const clientId = '13311688567845248231';
  const redirectUrl = window.location.href.split('?')[0].split('#')[0];
  const authUrl = `https://auth.phone.email/log-in?client_id=${clientId}&auth_type=8&origin=${encodeURIComponent(redirectUrl)}`;
  const w = 500, h = 600;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
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
      if (subCaption) subCaption.innerText = 'Real-Time OTP via SMS & WhatsApp';
    }
  }, 2500);
}

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

// ==================== TELEGRAM-STYLE REAL-TIME AUTHENTICATION ====================
let desktopPendingPhone = '';
let desktopLiveOtp = '';
let otpCountdownTimer = null;
let otpCountdownSeconds = 45;
let webOtpAbortController = null;

// Phone number auto-detection for simple login
function autoDetectDesktopPhone() {
  const phoneInput = document.getElementById('desktop-phone-input');
  if (!phoneInput) return;

  const savedPhone = localStorage.getItem('phonemail_saved_phone') || (currentUser && currentUser.phone);
  if (savedPhone) {
    const clean = savedPhone.replace(/\D/g, '').slice(-10);
    phoneInput.value = clean;
    phoneInput.focus();
    showNotify.info(`Auto-detected phone number: +91 ${clean}`, 'Number Detected');
  }
}

// WebOTP API: Automatic SMS OTP detection for instant verification
async function startWebOtpDetection(onOtpReceived) {
  if (!('OTPCredential' in window) && !('credentials' in navigator)) {
    console.log('WebOTP not natively supported on this browser');
    return;
  }

  try {
    if (webOtpAbortController) {
      webOtpAbortController.abort();
    }
    webOtpAbortController = new AbortController();

    const badge = document.getElementById('desk-webotp-badge');
    if (badge) badge.style.display = 'flex';

    const content = await navigator.credentials.get({
      otp: { transport: ['sms'] },
      signal: webOtpAbortController.signal
    });

    if (content && content.code) {
      console.log('⚡ [WebOTP] Intercepted OTP code:', content.code);
      const cleanCode = content.code.replace(/\D/g, '').slice(0, 6);
      if (cleanCode.length === 6) {
        showNotify.success('OTP code detected automatically from SMS!', 'WebOTP Auto-Detected');
        const cells = document.querySelectorAll('.telegram-otp-cell');
        cleanCode.split('').forEach((d, i) => {
          if (cells[i]) {
            cells[i].value = d;
            cells[i].classList.add('filled');
            cells[i].classList.remove('error');
          }
        });
        if (onOtpReceived) onOtpReceived(cleanCode);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.log('WebOTP listener notice:', err.message);
    }
  }
}

// Initialize Telegram 6-cell OTP input behaviors
function initTelegramOtpInputs() {
  const cells = document.querySelectorAll('.telegram-otp-cell');
  if (!cells || cells.length === 0) return;

  cells.forEach((cell, idx) => {
    // Input handler: support single-cell 6-digit autofill & auto-advance
    cell.addEventListener('input', (e) => {
      const rawVal = cell.value.replace(/\D/g, '');

      // If full 6-digit OTP arrived into this cell (via iOS QuickType / Android autofill)
      if (rawVal.length === 6) {
        rawVal.split('').forEach((d, i) => {
          if (cells[i]) {
            cells[i].value = d;
            cells[i].classList.add('filled');
            cells[i].classList.remove('error');
          }
        });
        cells[5].focus();
        verifyDesktopOTP(rawVal);
        return;
      }

      const val = rawVal ? rawVal.slice(-1) : '';
      cell.value = val;

      if (cell.value) {
        cell.classList.add('filled');
        cell.classList.remove('error');
        // Auto-advance to next cell
        if (idx < cells.length - 1) {
          cells[idx + 1].focus();
          cells[idx + 1].select();
        }
      } else {
        cell.classList.remove('filled');
      }

      // Check if all 6 digits are filled -> Zero-click auto-submit
      const enteredOtp = getEnteredOTP();
      if (enteredOtp.length === 6) {
        verifyDesktopOTP(enteredOtp);
      }
    });

    // Keydown handler: backspace jump-back, arrow navigation
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!cell.value && idx > 0) {
          cells[idx - 1].focus();
          cells[idx - 1].value = '';
          cells[idx - 1].classList.remove('filled');
          cells[idx - 1].classList.remove('error');
          e.preventDefault();
        } else {
          cell.value = '';
          cell.classList.remove('filled');
          cell.classList.remove('error');
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        cells[idx - 1].focus();
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && idx < cells.length - 1) {
        cells[idx + 1].focus();
        e.preventDefault();
      }
    });

    // Paste handler: distribute 6 digits across all cells
    cell.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text') || '';
      const digits = pasteData.replace(/\D/g, '').slice(0, 6);
      if (!digits) return;

      digits.split('').forEach((d, i) => {
        if (cells[i]) {
          cells[i].value = d;
          cells[i].classList.add('filled');
          cells[i].classList.remove('error');
        }
      });

      if (digits.length === 6) {
        cells[5].focus();
        verifyDesktopOTP(digits);
      } else if (digits.length < 6 && cells[digits.length]) {
        cells[digits.length].focus();
      }
    });
  });
}

function getEnteredOTP() {
  const cells = document.querySelectorAll('.telegram-otp-cell');
  let code = '';
  cells.forEach(c => { code += (c.value || '').trim(); });
  return code;
}

function clearOtpCells() {
  const cells = document.querySelectorAll('.telegram-otp-cell');
  cells.forEach(c => {
    c.value = '';
    c.classList.remove('filled', 'error');
    c.disabled = false;
  });
  if (cells[0]) {
    setTimeout(() => {
      cells[0].focus();
      cells[0].select();
    }, 50);
  }
}

// STEP 1: Phone Submission
async function handleDesktopPhoneSubmit(event) {
  if (event) event.preventDefault();
  const phoneInput = document.getElementById('desktop-phone-input');
  const rawPhone = phoneInput ? phoneInput.value.trim() : '';

  if (!rawPhone || rawPhone.length < 10) {
    showNotify.warning('Please enter a valid 10-digit Indian phone number.', 'Invalid Phone Number');
    if (phoneInput) phoneInput.focus();
    return;
  }

  const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
  desktopPendingPhone = cleanPhone;

  const btn = document.getElementById('btn-phone-submit');
  const btnLabel = document.getElementById('btn-phone-label');
  if (btn) btn.disabled = true;
  if (btnLabel) btnLabel.innerText = 'Dispatching Live SMS... ⏳';

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      desktopLiveOtp = data.liveOtp || '123456';

      // Transition to Step 2: Telegram OTP card
      document.getElementById('desktop-card-phone').style.display = 'none';
      document.getElementById('desktop-card-otp').style.display = 'block';
      document.getElementById('desktop-card-profile').style.display = 'none';

      // Format phone number: +91 98765 43210
      const formatted = `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`;
      document.getElementById('tg-phone-display').innerText = formatted;

      // Update email preview in step 3
      const emailPrev = document.getElementById('profile-email-preview');
      if (emailPrev) {
        emailPrev.innerText = `${cleanPhone}.work@alphastack.wwisvnr.com`;
      }

      // Show live code hint card for instant verification testing
      const liveHint = document.getElementById('desktop-live-hint');
      const liveCodeSpan = document.getElementById('desktop-live-code');
      if (liveHint && liveCodeSpan) {
        liveCodeSpan.innerText = desktopLiveOtp;
        liveHint.style.display = 'flex';
      }

      // Reset cells and status
      clearOtpCells();
      setOtpStatus('');

      // Start 45s Telegram-style countdown timer and WebOTP detection
      startOtpCountdown();
      startWebOtpDetection(verifyDesktopOTP);
    } else {
      showNotify.error(data.error || 'Failed to dispatch verification code', 'OTP Failed');
    }
  } catch (err) {
    showNotify.error('Network error: ' + err.message, 'Connection Error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnLabel) btnLabel.innerText = 'Send Real-Time OTP';
  }
}

// STEP 2: Real-Time OTP Verification
async function verifyDesktopOTP(otp) {
  if (!otp || otp.length < 6) return;

  const cells = document.querySelectorAll('.telegram-otp-cell');
  cells.forEach(c => c.disabled = true);
  setOtpStatus('⏳ Verifying with PhoneMail engine...', 'neutral');

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: desktopPendingPhone,
        otp,
        clientType: 'WEB_CLIENT'
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (otpCountdownTimer) clearInterval(otpCountdownTimer);
      if (webOtpAbortController) {
        try { webOtpAbortController.abort(); } catch (e) {}
      }
      setOtpStatus('✓ Code verified successfully!', 'success');

      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };

      // Check if this is a NEW user registration (Telegram Profile Setup Step)
      if (data.isNewUser || (data.user.display_name && data.user.display_name.startsWith('User '))) {
        // Transition to Step 3: Profile Setup
        setTimeout(() => {
          document.getElementById('desktop-card-otp').style.display = 'none';
          document.getElementById('desktop-card-profile').style.display = 'block';
          const fnInput = document.getElementById('profile-first-name');
          if (fnInput) fnInput.focus();
        }, 400);
      } else {
        // Existing user -> Immediately launch inbox!
        saveDesktopSession(currentUser);
        setTimeout(() => {
          document.getElementById('desktop-auth-container').style.display = 'none';
          document.getElementById('desktop-main-container').style.display = 'flex';
          playNotificationChime();
          initDesktopApp();
          showToastNotification(`Welcome back, ${currentUser.name}! 🇮🇳`);
          checkOneTimeContactSyncPrompt();
        }, 400);
      }
    } else {
      // Telegram signature error shake
      triggerOtpShake(data.error || 'Invalid or expired code. Please try again.');
    }
  } catch (err) {
    triggerOtpShake('Connection error: ' + err.message);
  }
}

function triggerOtpShake(errMsg) {
  const grid = document.getElementById('desktop-otp-grid');
  const cells = document.querySelectorAll('.telegram-otp-cell');

  cells.forEach(c => {
    c.classList.add('error');
    c.disabled = false;
  });

  if (grid) {
    grid.classList.remove('otp-shake');
    void grid.offsetWidth; // trigger reflow
    grid.classList.add('otp-shake');
  }

  setOtpStatus(`❌ ${errMsg}`, 'error');

  // After shake, clear and focus first cell
  setTimeout(() => {
    if (grid) grid.classList.remove('otp-shake');
    clearOtpCells();
  }, 450);
}

function setOtpStatus(msg, type) {
  const banner = document.getElementById('desktop-otp-status');
  if (!banner) return;
  banner.innerText = msg;
  banner.className = 'otp-status-banner';
  if (type === 'error') banner.classList.add('error-text');
  if (type === 'success') banner.classList.add('success-text');
}

// Telegram Countdown Timer (45s)
function startOtpCountdown() {
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  otpCountdownSeconds = 45;

  const timerWrap = document.getElementById('otp-timer-wrap');
  const timerSecs = document.getElementById('otp-timer-seconds');
  const resendBtn = document.getElementById('btn-resend-sms');
  const voiceBtn = document.getElementById('btn-call-otp');

  if (timerWrap) timerWrap.style.display = 'inline-flex';
  if (resendBtn) resendBtn.disabled = true;
  if (voiceBtn) voiceBtn.disabled = true;

  updateTimerDisplay();

  otpCountdownTimer = setInterval(() => {
    otpCountdownSeconds--;
    updateTimerDisplay();

    if (otpCountdownSeconds <= 0) {
      clearInterval(otpCountdownTimer);
      if (timerWrap) timerWrap.style.display = 'none';
      if (resendBtn) resendBtn.disabled = false;
      if (voiceBtn) voiceBtn.disabled = false;
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timerSecs = document.getElementById('otp-timer-seconds');
  if (!timerSecs) return;
  const m = Math.floor(otpCountdownSeconds / 60);
  const s = otpCountdownSeconds % 60;
  timerSecs.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function resendTelegramOTP() {
  if (!desktopPendingPhone) return;
  const resendBtn = document.getElementById('btn-resend-sms');
  if (resendBtn) resendBtn.disabled = true;

  setOtpStatus('⏳ Sending new SMS code...', 'neutral');
  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: desktopPendingPhone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      desktopLiveOtp = data.liveOtp || '123456';
      const liveCodeSpan = document.getElementById('desktop-live-code');
      if (liveCodeSpan) liveCodeSpan.innerText = desktopLiveOtp;
      setOtpStatus('✓ New code sent via SMS!', 'success');
      clearOtpCells();
      startOtpCountdown();
    } else {
      setOtpStatus(data.error || 'Failed to resend SMS', 'error');
      if (resendBtn) resendBtn.disabled = false;
    }
  } catch (err) {
    setOtpStatus('Error resending: ' + err.message, 'error');
    if (resendBtn) resendBtn.disabled = false;
  }
}

async function requestVoiceCallOTP() {
  if (!desktopPendingPhone) return;
  const voiceBtn = document.getElementById('btn-call-otp');
  if (voiceBtn) voiceBtn.disabled = true;

  setOtpStatus('📞 Placing real-time Twilio voice call...', 'neutral');
  try {
    const res = await fetch('/api/auth/call-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: desktopPendingPhone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (data.liveOtp) {
        desktopLiveOtp = data.liveOtp;
        const liveCodeSpan = document.getElementById('desktop-live-code');
        if (liveCodeSpan) liveCodeSpan.innerText = desktopLiveOtp;
      }
      setOtpStatus('📞 Twilio is calling your phone! Answer to hear the code.', 'success');
      clearOtpCells();
    } else {
      setOtpStatus(data.error || 'Could not place voice call', 'error');
      if (voiceBtn) voiceBtn.disabled = false;
    }
  } catch (err) {
    setOtpStatus('Voice call error: ' + err.message, 'error');
    if (voiceBtn) voiceBtn.disabled = false;
  }
}

function quickFillLiveCode() {
  if (!desktopLiveOtp) return;
  const digits = String(desktopLiveOtp).split('');
  const cells = document.querySelectorAll('.telegram-otp-cell');
  cells.forEach((cell, i) => {
    if (digits[i]) {
      cell.value = digits[i];
      cell.classList.add('filled');
      cell.classList.remove('error');
    }
  });
  verifyDesktopOTP(desktopLiveOtp);
}

function backToPhoneStep() {
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  document.getElementById('desktop-card-otp').style.display = 'none';
  document.getElementById('desktop-card-profile').style.display = 'none';
  document.getElementById('desktop-card-phone').style.display = 'block';
  const phoneInput = document.getElementById('desktop-phone-input');
  if (phoneInput) {
    phoneInput.disabled = false;
    phoneInput.focus();
    phoneInput.select();
  }
}

// STEP 3: Profile Registration (New User)
function updateProfileAvatarPreview() {
  const fn = (document.getElementById('profile-first-name').value || '').trim();
  const ln = (document.getElementById('profile-last-name').value || '').trim();
  const circle = document.getElementById('profile-avatar-circle');
  if (circle) {
    const initial = fn ? fn.charAt(0).toUpperCase() : (ln ? ln.charAt(0).toUpperCase() : 'P');
    circle.innerText = initial;
  }
}

function selectSubTag(element, tag) {
  document.querySelectorAll('.alias-chip').forEach(c => c.classList.remove('selected'));
  if (element) element.classList.add('selected');
  const hidden = document.getElementById('profile-selected-subtag');
  if (hidden) hidden.value = tag;

  const emailPrev = document.getElementById('profile-email-preview');
  if (emailPrev && desktopPendingPhone) {
    emailPrev.innerText = `${desktopPendingPhone}.${tag}@alphastack.wwisvnr.com`;
  }
}

async function handleDesktopProfileSubmit(event) {
  if (event) event.preventDefault();
  const fn = (document.getElementById('profile-first-name').value || '').trim();
  const ln = (document.getElementById('profile-last-name').value || '').trim();
  const tag = (document.getElementById('profile-selected-subtag').value || 'work').trim();

  if (!fn) {
    showNotify.warning('Please enter your first name.', 'Profile Incomplete');
    document.getElementById('profile-first-name').focus();
    return;
  }

  const btn = document.getElementById('btn-profile-submit');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: desktopPendingPhone,
        firstName: fn,
        lastName: ln,
        aliasTag: tag
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name,
        email: data.user.email_address
      };

      saveDesktopSession(currentUser);

      document.getElementById('desktop-auth-container').style.display = 'none';
      document.getElementById('desktop-main-container').style.display = 'flex';
      playNotificationChime();
      initDesktopApp();
      showNotify.success(`Welcome to PhoneMail, ${currentUser.name}! 🇮🇳`, 'Registered');
      checkOneTimeContactSyncPrompt();
    } else {
      showNotify.error(data.error || 'Failed to complete profile', 'Registration Error');
    }
  } catch (err) {
    showNotify.error('Error saving profile: ' + err.message, 'Server Error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==================== ONE-TIME CONTACT SYNC & REAL-TIME DISCOVERY ====================
let realtimeSyncInterval = null;

function checkOneTimeContactSyncPrompt() {
  const perm = localStorage.getItem('phonemail_contact_sync_permission');
  if (perm === 'granted') {
    startRealtimeContactSync();
    return;
  }
  if (perm === 'declined') {
    return;
  }

  const modal = document.getElementById('contact-sync-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

async function acceptOneTimeContactSync() {
  const modal = document.getElementById('contact-sync-modal');
  if (modal) modal.style.display = 'none';

  localStorage.setItem('phonemail_contact_sync_permission', 'granted');

  if ('contacts' in navigator && 'ContactsManager' in window) {
    try {
      const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      if (selected && selected.length > 0) {
        const rawPhones = [];
        const namesMap = {};
        selected.forEach(c => {
          const name = Array.isArray(c.name) ? c.name[0] : (c.name || '');
          if (c.tel) {
            c.tel.forEach(t => {
              const clean = String(t).replace(/\D/g, '').slice(-10);
              if (clean.length === 10) {
                rawPhones.push(clean);
                if (name) namesMap[clean] = name;
              }
            });
          }
        });

        localStorage.setItem('phonemail_raw_device_numbers', JSON.stringify(rawPhones));
        localStorage.setItem('phonemail_cached_device_names', JSON.stringify(namesMap));
        showNotify.success('Contact permission granted! Syncing contacts in real time...', 'Contact Sync Active');
      }
    } catch (err) {
      console.log('Contact selection cancelled or unavailable:', err.message);
    }
  } else {
    showNotify.info('Real-time contact discovery activated for registered PhoneMail users.', 'Contact Sync Active');
  }

  startRealtimeContactSync();
  await syncContactsRealtime(false);
}

function declineOneTimeContactSync() {
  const modal = document.getElementById('contact-sync-modal');
  if (modal) modal.style.display = 'none';
  localStorage.setItem('phonemail_contact_sync_permission', 'declined');
}

function startRealtimeContactSync() {
  if (realtimeSyncInterval) clearInterval(realtimeSyncInterval);
  syncContactsRealtime(true);
  // Periodically re-sync in the background so friends newly registered appear in real time
  realtimeSyncInterval = setInterval(() => {
    syncContactsRealtime(true);
  }, 45000);
}

async function syncContactsRealtime(silent = true) {
  const perm = localStorage.getItem('phonemail_contact_sync_permission');
  if (perm !== 'granted') return;

  let rawPhones = [];
  try {
    rawPhones = JSON.parse(localStorage.getItem('phonemail_raw_device_numbers') || '[]');
  } catch (e) {}

  let namesMap = {};
  try {
    namesMap = JSON.parse(localStorage.getItem('phonemail_cached_device_names') || '{}');
  } catch (e) {}

  if (rawPhones.length === 0) return;

  try {
    const res = await fetch('/api/contacts/filter-phonemail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumbers: rawPhones })
    });
    const data = await res.json();
    const registered = data.registeredContacts || [];

    registered.forEach(r => {
      if (namesMap[r.phone_number] && (!r.display_name || r.display_name.startsWith('User '))) {
        r.device_name = namesMap[r.phone_number];
      }
    });

    const previousCount = cachedDeviceContacts.length;
    cachedDeviceContacts = registered;
    localStorage.setItem('phonemail_cached_device_contacts', JSON.stringify(registered));

    if (!silent && registered.length > previousCount && previousCount > 0) {
      const diff = registered.length - previousCount;
      showNotify.info(`Found ${diff} new contact(s) on PhoneMail!`, 'Real-time Contact Sync');
    }
  } catch (err) {
    console.log('Real-time contact sync background check:', err.message);
  }
}

// Attach OTP input listeners, auto-detect phone, and Phone.Email script on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  loadPhoneEmailScript();
  initTelegramOtpInputs();
  autoDetectDesktopPhone();
});


// ==================== WORKSPACE INITIALIZATION ====================
function updateProfileDisplay() {
  if (!currentUser) return;
  const avatarBadge = document.getElementById('user-avatar-badge');
  if (avatarBadge) {
    const myAvatarUrl = currentUser.avatar_url || generateDefaultAvatar(currentUser.phone, currentUser.name);
    const initial = getInitials(currentUser.name || 'User');
    avatarBadge.innerHTML = `
      <img src="${myAvatarUrl}" alt="${escapeHtml(currentUser.name || 'User')}" class="avatar-inner-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="avatar-fallback-initial" style="display:none;">${initial}</span>
    `;
    avatarBadge.title = `${currentUser.name || 'User'} (+91 ${currentUser.phone}) - Account & Digital ID`;
  }
  const sPhone = document.getElementById('settings-phone');
  if (sPhone) sPhone.innerText = currentUser.phone;
  const sEmail = document.getElementById('settings-email');
  if (sEmail) sEmail.innerText = currentUser.email;

  const topPhoneChip = document.getElementById('top-phone-chip');
  if (topPhoneChip) {
    topPhoneChip.innerText = `📞 +91 ${currentUser.phone}`;
  }
}

function initDesktopApp() {
  updateProfileDisplay();

  // Socket.io Push with targeted personal rooms
  try {
    socket = io();
    socket.emit('join:user', currentUser.phone);

    socket.on('email:incoming', (data) => {
      console.log('⚡ [SOCKET] Inbound personal email received:', data);
      playNotificationChime();
      const senderDisplay = data.from || (data.email && data.email.sender_email) || 'Network Contact';
      showToastNotification(`📩 New message from ${senderDisplay}!`);
      loadEmails();
    });

    socket.on('email:new', (data) => {
      console.log('⚡ [SOCKET] Inbound email event:', data);
      if (data && data.senderPhone && data.senderPhone !== currentUser.phone) {
        playNotificationChime();
        showToastNotification(`📩 New email received`);
      }
      loadEmails();
    });

    socket.on('email:sent', () => {
      loadEmails();
    });

    socket.on('contacts:sync', () => {
      syncContactsRealtime(true);
    });
  } catch (err) {
    console.warn('Socket real-time connection warning:', err);
  }

  // Setup Keyboard Shortcuts & Autocomplete
  setupKeyboardShortcuts();
  setupContactsAutocomplete();

  // Load Data
  loadEmails();
  loadDesktopAliases();

  // Continuously reload and display new incoming mails in real-time
  startContinuousEmailSync();

  // Load cached device contacts and fetch account network contacts
  try {
    const raw = localStorage.getItem('phonemail_cached_device_contacts');
    if (raw) cachedDeviceContacts = JSON.parse(raw);
  } catch(e) {}

  if (currentUser && currentUser.phone) {
    fetch(`/api/contacts?phone=${encodeURIComponent(currentUser.phone)}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.contacts) {
          cachedContacts = data.contacts;
          if (allEmails && allEmails.length > 0) renderEmailList(allEmails);
        }
      })
      .catch(() => {});
  }

  // Apply saved language preference
  if (typeof applyInaiLanguage === 'function') {
    applyInaiLanguage();
  }
}

// ==================== KEYBOARD ACCELERATORS ====================
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

    // Cmd+K / Ctrl+K -> Focus Search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const search = document.getElementById('desktop-search');
      if (search) {
        search.focus();
        search.select();
      }
      return;
    }

    // Escape -> Close Modals or Reading Pane
    if (e.key === 'Escape') {
      const compose = document.getElementById('desktop-compose-modal');
      const settings = document.getElementById('desktop-settings-modal');
      const readingPane = document.getElementById('reading-pane');

      if (compose && compose.style.display !== 'none') {
        closeComposeModal();
        return;
      }
      if (settings && settings.style.display !== 'none') {
        closeDesktopSettings();
        return;
      }
      if (readingPane && readingPane.style.display !== 'none') {
        closeReadingPane();
        return;
      }
    }

    if (!isTyping) {
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        openComposeModal();
        return;
      }

      if (e.key.toLowerCase() === 'j') {
        navigateEmailList(1);
        return;
      }

      if (e.key.toLowerCase() === 'k') {
        navigateEmailList(-1);
        return;
      }

      if (e.key === 'Enter' && selectedEmailIndex >= 0 && allEmails[selectedEmailIndex]) {
        openEmailDetails(allEmails[selectedEmailIndex]);
        return;
      }

      if (e.key.toLowerCase() === 's' && activeEmail) {
        toggleCurrentStar();
        return;
      }

      if ((e.key === '#' || e.key === 'Delete') && activeEmail) {
        deleteCurrentEmail();
        return;
      }
    }
  });
}

function navigateEmailList(delta) {
  if (!allEmails || allEmails.length === 0) return;
  selectedEmailIndex = Math.max(0, Math.min(allEmails.length - 1, selectedEmailIndex + delta));
  
  const rows = document.querySelectorAll('.email-card-item');
  rows.forEach((r, idx) => {
    if (idx === selectedEmailIndex) {
      r.classList.add('keyboard-focused');
      r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      r.classList.remove('keyboard-focused');
    }
  });
}



// ==================== EMAIL DATA LOADING & ZERO-DELAY CACHE ====================
async function syncAndLoadEmails() {
  showToastNotification('Syncing with Hostinger mail server... 🔄');
  try {
    await fetch('/api/emails/sync', { method: 'POST' });
  } catch (e) {}
  await loadEmails(currentFolder);
}

let desktopContinuousPollInterval = null;

function startContinuousEmailSync() {
  if (desktopContinuousPollInterval) clearInterval(desktopContinuousPollInterval);
  desktopContinuousPollInterval = setInterval(async () => {
    if (!currentUser || !currentUser.phone) return;
    if (selectedEmailIds && selectedEmailIds.size > 0) return;
    const composeModal = document.getElementById('desktop-compose-modal');
    if (composeModal && composeModal.style.display !== 'none') {
      syncFolderStats();
      return;
    }

    try {
      const res = await fetch(`/api/emails?folder=${currentFolder}&phone=${encodeURIComponent(currentUser.phone)}`);
      const data = await res.json();
      const freshEmails = data.emails || [];

      const currentIds = allEmails.map(e => `${e.id}_${e.is_read}_${e.is_starred}_${e.is_important}`).join(',');
      const freshIds = freshEmails.map(e => `${e.id}_${e.is_read}_${e.is_starred}_${e.is_important}`).join(',');

      if (currentIds !== freshIds) {
        allEmails = freshEmails;
        emailFolderCache[currentFolder] = allEmails;
        updateFolderCountsFromList(allEmails);
        if (!activeEmail) {
          renderEmailList(allEmails);
        } else {
          const updatedActive = allEmails.find(e => e.id === activeEmail.id);
          if (updatedActive) activeEmail = updatedActive;
        }
      }
      syncFolderStats();
    } catch (e) {
      // Silent error
    }
  }, 5000);
}

async function loadEmails(folder = currentFolder) {
  currentFolder = folder;
  clearEmailSelection();

  // 1. INSTANT 0ms RENDER FROM CACHE (NO DELAY BETWEEN FOLDERS)
  if (emailFolderCache[folder] && Array.isArray(emailFolderCache[folder])) {
    allEmails = emailFolderCache[folder];
    renderEmailList(allEmails);
    updateFolderCountsFromList(allEmails);
  } else {
    allEmails = [];
    const container = document.getElementById('email-items-container');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 70px 20px;">
          <div style="width: 30px; height: 30px; border: 3px solid var(--border-light); border-top-color: var(--green-main); border-radius: 50%; margin: 0 auto 12px; animation: spinLoader 0.8s linear infinite;"></div>
          <p style="font-size: 13px; font-weight: 500;">Loading messages...</p>
        </div>
      `;
    }
    updateFolderCountsFromList([]);
  }

  // 2. BACKGROUND REAL-TIME FETCH TO ENSURE FRESHNESS
  try {
    if (!currentUser || !currentUser.phone) return;
    const res = await fetch(`/api/emails?folder=${folder}&phone=${encodeURIComponent(currentUser.phone)}`);
    const data = await res.json();
    allEmails = data.emails || [];
    emailFolderCache[folder] = allEmails;

    updateFolderCountsFromList(allEmails);
    renderEmailList(allEmails);
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

function updateFolderCountsFromList(emails) {
  const countAll = emails.length;
  const countPhoneMail = emails.filter(e => isPhoneMailSender(e.sender_email)).length;
  const countExternal = emails.filter(e => !isPhoneMailSender(e.sender_email)).length;

  const elAll = document.getElementById('count-source-all');
  if (elAll) elAll.innerText = countAll;
  const elPM = document.getElementById('count-source-phonemail');
  if (elPM) elPM.innerText = countPhoneMail;
  const elExt = document.getElementById('count-source-external');
  if (elExt) elExt.innerText = countExternal;

  const unreadCount = emails.filter(e => e.is_read === 0).length;
  if (currentFolder === 'INBOX') {
    const badge = document.getElementById('inbox-count-badge');
    if (badge) {
      badge.innerText = unreadCount > 0 ? unreadCount : '';
      badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
  } else if (currentFolder === 'ALL') {
    const allBadge = document.getElementById('all-count-badge');
    if (allBadge) {
      allBadge.innerText = unreadCount > 0 ? unreadCount : '';
      allBadge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
  }

  const impCount = emails.filter(e => e.is_important === 1).length;
  const impBadge = document.getElementById('important-count-badge');
  if (impBadge && currentFolder === 'IMPORTANT') {
    impBadge.innerText = impCount > 0 ? impCount : '';
    impBadge.style.display = impCount > 0 ? 'inline-block' : 'none';
  }

  const indicator = document.getElementById('mail-page-indicator');
  if (indicator) {
    indicator.innerText = emails.length === 1 ? '1 message' : `${emails.length} messages`;
  }

  updateDesktopFilterBadges(emails);
  updateDesktopClearBtnVisibility();
  syncFolderStats();
}

async function syncFolderStats() {
  if (!currentUser || !currentUser.phone) return;
  try {
    const res = await fetch(`/api/emails/stats?phone=${encodeURIComponent(currentUser.phone)}`);
    const stats = await res.json();
    if (!stats) return;

    const inboxBadge = document.getElementById('inbox-count-badge');
    if (inboxBadge) {
      inboxBadge.innerText = stats.inbox_unread > 0 ? stats.inbox_unread : '';
      inboxBadge.style.display = stats.inbox_unread > 0 ? 'inline-block' : 'none';
    }

    const allBadge = document.getElementById('all-count-badge');
    if (allBadge) {
      allBadge.innerText = stats.all_unread > 0 ? stats.all_unread : '';
      allBadge.style.display = stats.all_unread > 0 ? 'inline-block' : 'none';
    }

    const draftsBadge = document.getElementById('nav-item-drafts')?.querySelector('.nav-badge');
    if (draftsBadge) {
      draftsBadge.innerText = stats.drafts_total > 0 ? stats.drafts_total : '';
      draftsBadge.style.display = stats.drafts_total > 0 ? 'inline-block' : 'none';
    }

    const impBadge = document.getElementById('important-count-badge');
    if (impBadge) {
      impBadge.innerText = stats.important_total > 0 ? stats.important_total : '';
      impBadge.style.display = stats.important_total > 0 ? 'inline-block' : 'none';
    }
  } catch (err) {
    console.warn('Could not sync folder stats:', err);
  }
}

function setMailSourceFilter(filter) {
  currentMailSourceFilter = filter;
  currentEmailPage = 1;
  ['all', 'phonemail', 'external'].forEach(f => {
    const btn = document.getElementById(`tab-source-${f}`);
    if (btn) {
      if (f === filter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  if (filter === 'all') {
    currentQuickFilter = 'all';
    ['unread', 'attachments', 'starred'].forEach(f => {
      const btn = document.getElementById(`desk-filter-${f}`);
      if (btn) btn.classList.remove('active');
    });
    updateDesktopClearBtnVisibility();
  }
  renderEmailList(allEmails);
}

// ==================== ADVANCED FILTER TOOLBAR HANDLERS ====================
function setDesktopQuickFilter(filter) {
  // Chip-toggle behavior: clicking active filter turns it off back to 'all'
  if (currentQuickFilter === filter) {
    currentQuickFilter = 'all';
  } else {
    currentQuickFilter = filter;
  }
  currentEmailPage = 1;
  ['unread', 'attachments', 'starred'].forEach(f => {
    const btn = document.getElementById(`desk-filter-${f}`);
    if (btn) {
      if (f === currentQuickFilter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  updateDesktopClearBtnVisibility();
  renderEmailList(allEmails);
}

function toggleDesktopDateDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('desk-date-menu');
  if (!menu) return;
  const isHidden = menu.style.display === 'none' || !menu.style.display;
  menu.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    setTimeout(() => {
      window.addEventListener('click', closeDesktopDateDropdown, { once: true });
    }, 10);
  }
}

function closeDesktopDateDropdown() {
  const menu = document.getElementById('desk-date-menu');
  if (menu) menu.style.display = 'none';
}

function setDesktopDateFilter(preset) {
  currentDateFilter = preset;
  if (preset !== 'custom') {
    customDateStart = '';
    customDateEnd = '';
    const startInput = document.getElementById('desk-custom-date-start');
    const endInput = document.getElementById('desk-custom-date-end');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
  }
  updateDesktopDateUI();
  closeDesktopDateDropdown();
  currentEmailPage = 1;
  updateDesktopClearBtnVisibility();
  renderEmailList(allEmails);
  if (preset !== 'all' && typeof showNotify !== 'undefined') {
    showNotify.info(`Filtered: ${getDesktopDatePresetLabel(preset)}`, 'Date Filter');
  }
}

function applyDesktopCustomDateFilter() {
  const startInput = document.getElementById('desk-custom-date-start');
  const endInput = document.getElementById('desk-custom-date-end');
  const startVal = startInput ? startInput.value : '';
  const endVal = endInput ? endInput.value : '';

  if (!startVal && !endVal) {
    if (typeof showNotify !== 'undefined') showNotify.warning('Please select a start or end date', 'Custom Filter');
    return;
  }

  currentDateFilter = 'custom';
  customDateStart = startVal;
  customDateEnd = endVal;
  updateDesktopDateUI();
  closeDesktopDateDropdown();
  currentEmailPage = 1;
  updateDesktopClearBtnVisibility();
  renderEmailList(allEmails);
  if (typeof showNotify !== 'undefined') {
    showNotify.success('Custom date range applied ✓', 'Date Filter');
  }
}

function getDesktopDatePresetLabel(p) {
  switch (p) {
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'week': return 'Last 7 Days';
    case 'month': return 'Last 30 Days';
    case 'custom':
      if (customDateStart && customDateEnd) return `${customDateStart} to ${customDateEnd}`;
      if (customDateStart) return `From ${customDateStart}`;
      if (customDateEnd) return `Until ${customDateEnd}`;
      return 'Custom Range';
    default: return 'All';
  }
}

function updateDesktopDateUI() {
  ['all', 'today', 'yesterday', 'week', 'month'].forEach(p => {
    const opt = document.getElementById(`desk-date-opt-${p}`);
    if (opt) {
      if (currentDateFilter === p) opt.classList.add('active');
      else opt.classList.remove('active');
    }
  });

  const btn = document.getElementById('desk-date-dropdown-btn');
  const label = document.getElementById('desk-date-btn-label');
  if (label) {
    label.innerText = currentDateFilter === 'all' ? 'Date' : getDesktopDatePresetLabel(currentDateFilter);
  }
  if (btn) {
    if (currentDateFilter !== 'all') btn.classList.add('active');
    else btn.classList.remove('active');
  }
}

function updateDesktopClearBtnVisibility() {
  const clearBtn = document.getElementById('desk-clear-filters');
  if (!clearBtn) return;
  const isFiltered = currentQuickFilter !== 'all' || currentDateFilter !== 'all' || (searchTerm && searchTerm.length > 0);
  clearBtn.style.display = isFiltered ? 'inline-block' : 'none';
}

function resetAllDesktopFilters() {
  currentQuickFilter = 'all';
  currentDateFilter = 'all';
  customDateStart = '';
  customDateEnd = '';
  searchTerm = '';
  const searchInput = document.getElementById('global-search-input') || document.querySelector('.search-input');
  if (searchInput) searchInput.value = '';

  const startInput = document.getElementById('desk-custom-date-start');
  const endInput = document.getElementById('desk-custom-date-end');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';

  ['unread', 'attachments', 'starred'].forEach(f => {
    const btn = document.getElementById(`desk-filter-${f}`);
    if (btn) btn.classList.remove('active');
  });

  updateDesktopDateUI();
  updateDesktopClearBtnVisibility();
  currentEmailPage = 1;
  renderEmailList(allEmails);
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

function isDateInDesktopFilter(dateVal) {
  if (currentDateFilter === 'all') return true;
  if (!dateVal) return false;
  const d = parseEmailDate(dateVal);
  if (!d) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000;
  const t = d.getTime();

  if (currentDateFilter === 'today') {
    return t >= startOfToday && t < endOfToday;
  }
  if (currentDateFilter === 'yesterday') {
    const startOfYesterday = startOfToday - 86400000;
    return t >= startOfYesterday && t < startOfToday;
  }
  if (currentDateFilter === 'week') {
    const startOfWeek = startOfToday - 7 * 86400000;
    return t >= startOfWeek;
  }
  if (currentDateFilter === 'month') {
    const startOfMonth = startOfToday - 30 * 86400000;
    return t >= startOfMonth;
  }
  if (currentDateFilter === 'custom') {
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

function updateDesktopFilterBadges(emails) {
  const list = emails || allEmails || [];
  const unreadCount = list.filter(e => e.is_read === 0).length;
  const attCount = list.filter(e => Boolean(e.has_attachments || (e.attachments && (Array.isArray(e.attachments) ? e.attachments.length > 0 : e.attachments !== '[]' && e.attachments !== '')))).length;
  const starCount = list.filter(e => e.is_starred === 1 || e.is_important === 1).length;

  const bUnread = document.getElementById('desk-badge-unread');
  if (bUnread) {
    bUnread.innerText = unreadCount;
    bUnread.style.display = unreadCount > 0 ? 'inline-block' : 'none';
  }
  const bAtt = document.getElementById('desk-badge-attachments');
  if (bAtt) {
    bAtt.innerText = attCount;
    bAtt.style.display = attCount > 0 ? 'inline-block' : 'none';
  }
  const bStar = document.getElementById('desk-badge-starred');
  if (bStar) {
    bStar.innerText = starCount;
    bStar.style.display = starCount > 0 ? 'inline-block' : 'none';
  }
}

// ==================== CHECKBOX SELECTION & BULK ACTIONS ====================
function updateBulkToolbar() {
  const toolbar = document.getElementById('bulk-actions-toolbar');
  const badge = document.getElementById('bulk-count-badge');
  const masterCheck = document.getElementById('select-all-check');
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

  const row = document.getElementById(`email-row-${id}`);
  if (row) {
    if (selectedEmailIds.has(id)) row.classList.add('selected');
    else row.classList.remove('selected');
  }
  const chk = document.getElementById(`check-${id}`);
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
        const chk = document.getElementById(`check-${id}`);
        if (chk) chk.checked = true;
      }
    });
  } else {
    clearEmailSelection();
  }
  updateBulkToolbar();
}

function toggleSelectTypeMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('select-type-menu');
  if (!menu) return;
  const isHidden = menu.style.display === 'none' || !menu.style.display;
  menu.style.display = isHidden ? 'block' : 'none';
}

function closeSelectTypeMenu() {
  const menu = document.getElementById('select-type-menu');
  if (menu) menu.style.display = 'none';
}

function selectByType(type) {
  closeSelectTypeMenu();
  selectedEmailIds.clear();
  
  const visibleCardItems = Array.from(document.querySelectorAll('.email-card-item'));
  const visibleIds = visibleCardItems.map(item => item.dataset.id).filter(Boolean);
  const visibleEmails = allEmails.filter(e => visibleIds.includes(e.id));

  visibleEmails.forEach(email => {
    let match = false;
    switch(type) {
      case 'all': match = true; break;
      case 'none': match = false; break;
      case 'read': match = email.is_read === 1; break;
      case 'unread': match = email.is_read === 0; break;
      case 'starred': match = email.is_starred === 1; break;
      case 'unstarred': match = email.is_starred === 0; break;
    }
    if (match) {
      selectedEmailIds.add(email.id);
    }
  });

  visibleCardItems.forEach(item => {
    const id = item.dataset.id;
    const isSelected = selectedEmailIds.has(id);
    if (isSelected) item.classList.add('selected');
    else item.classList.remove('selected');
    const chk = document.getElementById(`check-${id}`);
    if (chk) chk.checked = isSelected;
  });

  updateBulkToolbar();
}

async function markAllVisibleAsRead() {
  const visibleCardItems = Array.from(document.querySelectorAll('.email-card-item'));
  const visibleIds = visibleCardItems.map(item => item.dataset.id).filter(Boolean);
  const unreadEmails = allEmails.filter(e => visibleIds.includes(e.id) && e.is_read === 0);

  if (unreadEmails.length === 0) {
    showToastNotification('All visible messages are already read');
    return;
  }

  const ids = unreadEmails.map(e => e.id);
  unreadEmails.forEach(e => {
    e.is_read = 1;
    e.read_at = e.read_at || new Date().toISOString();
  });

  Object.keys(emailFolderCache).forEach(f => {
    if (Array.isArray(emailFolderCache[f])) {
      emailFolderCache[f].forEach(e => {
        if (ids.includes(e.id)) e.is_read = 1;
      });
    }
  });

  renderEmailList(allEmails);
  showToastNotification(`Marked ${ids.length} messages as read ✓`);

  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', ids })
    });
  } catch (err) {}
}

async function toggleReadStatus(id, e) {
  if (e) e.stopPropagation();
  const email = allEmails.find(item => item.id === id);
  if (!email) return;

  const newRead = email.is_read === 1 ? 0 : 1;
  email.is_read = newRead;
  if (newRead === 1) email.read_at = email.read_at || new Date().toISOString();
  else email.read_at = null;

  Object.keys(emailFolderCache).forEach(f => {
    if (Array.isArray(emailFolderCache[f])) {
      const cached = emailFolderCache[f].find(item => item.id === id);
      if (cached) cached.is_read = newRead;
    }
  });

  renderEmailList(allEmails);
  showToastNotification(`Marked as ${newRead === 1 ? 'read' : 'unread'} ✓`);

  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: newRead === 1 ? 'read' : 'unread', ids: [id] })
    });
  } catch (err) {}
}

function goToPrevPage() {
  if (currentEmailPage > 1) {
    currentEmailPage--;
    renderEmailList(allEmails);
  }
}

function goToNextPage() {
  currentEmailPage++;
  renderEmailList(allEmails);
}

function openInlineReplyComposer(mode) {
  if (mode === 'forward') {
    startForward();
  } else {
    const dock = document.getElementById('conversation-inline-dock');
    if (dock) {
      dock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const input = document.getElementById('desktop-thread-reply-input');
      if (input) input.focus();
    }
  }
}

function startForward() {
  if (!activeEmail) return;
  openComposeModal();
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = (activeEmail.subject || '').startsWith('Fwd:')
    ? activeEmail.subject
    : `Fwd: ${activeEmail.subject || ''}`;
  
  const senderDisplay = formatSenderDisplay(activeEmail.sender_email, false, activeEmail.sender_name);
  const timeDisplay = new Date(activeEmail.created_at).toLocaleString();
  const fwdHeader = `\n\n---------- Forwarded message ---------\nFrom: ${senderDisplay}\nDate: ${timeDisplay}\nSubject: ${activeEmail.subject || '(No Subject)'}\nTo: ${getRecipientsDisplay(activeEmail) || 'Me'}\n\n`;
  document.getElementById('desk-compose-body').value = fwdHeader + (activeEmail.body_text || '');
  setTimeout(() => document.getElementById('desk-compose-to').focus(), 80);
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

  // Immediate optimistic memory update
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
  } else if (action === 'archive' || action === 'delete' || action === 'spam' || action === 'report') {
    allEmails = allEmails.filter(e => !emailIds.includes(e.id));
  }

  if (emailFolderCache[currentFolder]) {
    emailFolderCache[currentFolder] = [...allEmails];
  }
  clearEmailSelection();
  renderEmailList(allEmails);

  showToastNotification(`Executing ${action} on ${count} item${count > 1 ? 's' : ''}...`);

  try {
    await fetch('/api/emails/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids: emailIds, emailIds: emailIds, folder: currentFolder })
    });
    const successMsg = (action === 'spam' || action === 'report') 
      ? `Reported ${count} message${count > 1 ? 's' : ''} as spam ✓` 
      : `Updated ${count} message${count > 1 ? 's' : ''} ✓`;
    showToastNotification(successMsg);
    syncFolderStats();
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
    const actionLabel = action === 'archive' 
      ? 'archived' 
      : ((action === 'spam' || action === 'report') ? 'reported and moved to Spam' : 'moved to trash');
    showToastNotification(`Message ${actionLabel} ✓`);
    syncFolderStats();
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
    showToastNotification(`Conversation ${action === 'archive' ? 'archived' : 'moved to trash'} ✓`);
  } catch (err) {}
}

// ==================== IMPORTANT TOGGLE ====================
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
        const impBtn = document.getElementById('pane-important-btn');
        if (impBtn) {
          impBtn.style.color = data.is_important ? '#ef4444' : 'var(--text-dim)';
          const svg = impBtn.querySelector('svg');
          if (svg) svg.setAttribute('fill', data.is_important ? '#ef4444' : 'none');
        }
      }
    }
  } catch (err) {
    console.error('Failed to toggle important:', err);
  }
}

function toggleCurrentImportant() {
  if (!activeEmail) return;
  toggleImportant(activeEmail.id);
}

function archiveCurrentEmail() {
  if (!activeEmail) return;
  executeBulkActionOnSingle(activeEmail.id, 'archive');
  closeReadingPane();
}

// ==================== EMAIL LIST RENDERING (NORMAL GMAIL WAY - NOT GROUPED) ====================
function renderEmailList(emails) {
  const container = document.getElementById('email-items-container');
  if (!container) return;
  container.innerHTML = '';

  const rawList = emails || [];
  let filtered = [...rawList];

  if (currentMailSourceFilter === 'phonemail') {
    filtered = filtered.filter(e => isPhoneMailSender(e.sender_email));
  } else if (currentMailSourceFilter === 'external') {
    filtered = filtered.filter(e => !isPhoneMailSender(e.sender_email));
  }

  // Quick Filter (Unread / Attachments / Starred)
  if (currentQuickFilter === 'unread') {
    filtered = filtered.filter(e => e.is_read === 0);
  } else if (currentQuickFilter === 'attachments') {
    filtered = filtered.filter(e => Boolean(e.has_attachments || (e.attachments && (Array.isArray(e.attachments) ? e.attachments.length > 0 : e.attachments !== '[]' && e.attachments !== ''))));
  } else if (currentQuickFilter === 'starred') {
    filtered = filtered.filter(e => e.is_starred === 1 || e.is_important === 1);
  }

  // Date Filter
  if (currentDateFilter !== 'all') {
    filtered = filtered.filter(e => isDateInDesktopFilter(e.created_at || e.timestamp || e.date));
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(e => 
      (e.subject || '').toLowerCase().includes(term) ||
      (e.sender_email || '').toLowerCase().includes(term) ||
      (e.sender_name || '').toLowerCase().includes(term) ||
      (e.body_text || '').toLowerCase().includes(term)
    );
  }

  if (filtered.length === 0) {
    let emptyMsg = `No messages found in ${getFolderFriendlyName(currentFolder)}.`;
    if (currentQuickFilter === 'unread') {
      emptyMsg = `No unread messages in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (currentQuickFilter === 'attachments') {
      emptyMsg = `No messages with attachments in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (currentQuickFilter === 'starred') {
      emptyMsg = `No starred or important messages in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (currentDateFilter !== 'all') {
      emptyMsg = `No messages found for date filter (${getDesktopDatePresetLabel(currentDateFilter)}).`;
    } else if (currentMailSourceFilter === 'phonemail') {
      emptyMsg = `No INAI network emails in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (currentMailSourceFilter === 'external') {
      emptyMsg = `No external (Gmail, Rediff, etc.) emails in ${getFolderFriendlyName(currentFolder)}.`;
    }
    const indicator = document.getElementById('mail-page-indicator');
    if (indicator) indicator.innerText = '0 of 0';
    const prevBtn = document.getElementById('btn-page-prev');
    if (prevBtn) prevBtn.disabled = true;
    const nextBtn = document.getElementById('btn-page-next');
    if (nextBtn) nextBtn.disabled = true;

    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 80px 20px;">
        <div style="margin-bottom: 14px;">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        </div>
        <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">No Messages</h3>
        <p style="font-size: 13px;">${emptyMsg}</p>
      </div>
    `;
    return;
  }

  // Gmail-Style Pagination Calculations
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / EMAIL_PAGE_SIZE));
  if (currentEmailPage > totalPages) currentEmailPage = totalPages;
  if (currentEmailPage < 1) currentEmailPage = 1;

  const startIdx = (currentEmailPage - 1) * EMAIL_PAGE_SIZE;
  const endIdx = Math.min(totalItems, startIdx + EMAIL_PAGE_SIZE);
  const pageItems = filtered.slice(startIdx, endIdx);

  // Update pagination indicator & navigation buttons
  const indicator = document.getElementById('mail-page-indicator');
  if (indicator) {
    indicator.innerText = `${startIdx + 1}–${endIdx} of ${totalItems}`;
  }

  const prevBtn = document.getElementById('btn-page-prev');
  if (prevBtn) prevBtn.disabled = currentEmailPage <= 1;

  const nextBtn = document.getElementById('btn-page-next');
  if (nextBtn) nextBtn.disabled = currentEmailPage >= totalPages;

  // Render individual email rows (standard Gmail view)
  pageItems.forEach(email => {
    try {
      const row = createEmailRowElement(email);
      if (row) container.appendChild(row);
    } catch (rowErr) {
      console.error('Error rendering email item:', email && email.id, rowErr);
    }
  });

  updateBulkToolbar();
}

function createEmailRowElement(email) {
  const row = document.createElement('div');
  const isSelected = selectedEmailIds.has(email.id);
  const isStarred = email.is_starred === 1;
  const isImportant = email.is_important === 1;

  row.id = `email-row-${email.id}`;
  row.dataset.id = email.id;
  row.className = `email-card-item ${email.is_read === 0 ? 'unread' : ''} ${isSelected ? 'selected' : ''} ${isImportant ? 'is-important' : ''}`;
  row.onclick = () => {
    openEmail(email.id);
  };

  const dateObj = new Date(email.created_at);
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const timeDisplay = isToday 
    ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const isSentFolder = currentFolder.toUpperCase() === 'SENT';
  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const recipientsDisplay = getRecipientsDisplay(email);

  const isFromPhoneMail = isPhoneMailSender(email.sender_email);
  const inaiIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const extIcon = `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  const sourceBadgeHtml = isFromPhoneMail
    ? `<span class="badge-source-tag badge-phonemail-pill" title="INAI Network Verified">${inaiIcon}<span>INAI</span></span>`
    : `<span class="badge-source-tag badge-external-pill" title="External Mail Service">${extIcon}<span>External</span></span>`;

  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const displaySender = (isSentFolder || isSentByMe) 
    ? `To: ${recipientsDisplay || 'Recipient'}` 
    : formattedSender;

  const participantForAvatar = (isSentFolder || isSentByMe) ? (email.recipient_phone || recipientsDisplay) : email.sender_email;
  const targetForInitials = (isSentFolder || isSentByMe) ? (recipientsDisplay || 'Recipient') : formattedSender;
  const rowAvatar = getAvatarUrl(participantForAvatar, targetForInitials);
  const fallbackSvg = generateDefaultAvatar(participantForAvatar, targetForInitials);
  const rowInitial = getInitials(targetForInitials);
  const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);

  row.innerHTML = `
    <!-- Row Controls: Checkbox and Star -->
    <div class="email-checkbox-wrap" onclick="toggleEmailSelection('${email.id}', event)">
      <label class="custom-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-checkbox" id="check-${email.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmailSelection('${email.id}', event)">
        <span class="checkmark"></span>
      </label>
    </div>

    <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? '#eab308' : 'none'}" stroke="${isStarred ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </span>

    <div class="item-avatar-circle" onclick="openContactInfoModal('${escapeHtml(participantForAvatar)}'); event.stopPropagation();" title="View ${escapeHtml(targetForInitials)} Digital ID Card">
      <img src="${rowAvatar}" alt="${escapeHtml(targetForInitials)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${fallbackSvg}';">
      <span class="avatar-fallback-initial" style="display:none;">${rowInitial}</span>
    </div>
    <div class="item-sender-col" title="${escapeHtml(displaySender)}">
      ${escapeHtml(displaySender)}
    </div>
    <div class="item-content-preview">
      ${sourceBadgeHtml}
      ${isImportant ? '<span style="display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 800; color: #e11d48; background: #ffe4e6; padding: 1px 6px; border-radius: 4px; margin-right: 4px;"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>PRIORITY</span>' : ''}
      <span class="item-subject-title">${escapeHtml(email.subject || '(No Subject)')}</span>
      <span class="item-body-snippet"> — ${escapeHtml(cleanBodySnippet)}</span>
    </div>
    <div class="item-date-col">${timeDisplay}</div>

    <!-- Desktop Hover Actions -->
    <div class="row-quick-actions" onclick="event.stopPropagation()">
      <button class="quick-action-btn" onclick="toggleReadStatus('${email.id}', event)" title="${email.is_read === 0 ? 'Mark as Read' : 'Mark as Unread'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          ${email.is_read === 0 
            ? '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>' 
            : '<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9"/><polyline points="22,6 12,13 2,6"/><circle cx="18" cy="18" r="3"/>'
          }
        </svg>
      </button>
      <button class="quick-action-btn" onclick="toggleImportant('${email.id}', event)" title="${isImportant ? 'Unmark Priority' : 'Mark Priority'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${isImportant ? '#ef4444' : 'none'}" stroke="${isImportant ? '#ef4444' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
      <button class="quick-action-btn" onclick="executeBulkActionOnSingle('${email.id}', 'archive', event)" title="Archive Email">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
      </button>
      <button class="quick-action-btn danger" onclick="executeBulkActionOnSingle('${email.id}', 'delete', event)" title="Delete Email">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `;

  return row;
}

function switchFolder(folder, element) {
  currentFolder = folder;
  currentEmailPage = 1;
  closeSelectTypeMenu();
  document.querySelectorAll('.folder-nav .nav-item').forEach(i => i.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  } else {
    const defaultNav = document.getElementById(`nav-item-${folder.toLowerCase()}`);
    if (defaultNav) defaultNav.classList.add('active');
  }
  
  const titleEl = document.getElementById('current-folder-title');
  if (titleEl) {
    titleEl.innerText = getFolderFriendlyName(folder);
  }

  closeMobileSidebar();
  closeReadingPane(false);
  loadEmails(folder);
}

// ==================== READING PANE VIEW (INDIVIDUAL EMAIL - NORMAL GMAIL WAY) ====================
function openEmail(emailId) {
  const email = allEmails.find(e => e.id === emailId);
  if (!email) return;

  if (currentFolder === 'DRAFTS' || email.folder === 'DRAFTS') {
    openDraftInCompose(email);
    return;
  }

  activeEmail = email;

  // Immediately remove unread class and green line from DOM row
  const rowEl = document.getElementById(`email-row-${email.id}`) || document.querySelector(`[data-id="${email.id}"]`);
  if (rowEl) {
    rowEl.classList.remove('unread');
    const subjTitle = rowEl.querySelector('.item-subject-title');
    if (subjTitle) subjTitle.style.fontWeight = 'normal';
  }

  // If unread, mark read locally and in database
  if (email.is_read === 0) {
    email.is_read = 1;
    email.read_at = email.read_at || new Date().toISOString();

    // Mark via backend API
    fetch(`/api/emails/${email.id}/read`, {
      method: 'POST'
    }).catch(() => {});

    // Update cached folders so returning to folder keeps it read
    Object.keys(emailFolderCache).forEach(f => {
      if (Array.isArray(emailFolderCache[f])) {
        const cached = emailFolderCache[f].find(e => e.id === email.id);
        if (cached) cached.is_read = 1;
      }
    });

    updateFolderCountsFromList(allEmails);
  }

  const listPane = document.getElementById('mail-list-pane');
  const readingPane = document.getElementById('reading-pane');
  if (listPane) listPane.style.display = 'none';
  if (readingPane) readingPane.style.display = 'flex';

  const subjEl = document.getElementById('full-subject');
  if (subjEl) subjEl.innerText = email.subject || '(No Subject)';

  const catTag = document.getElementById('reading-category-tag');
  if (catTag) catTag.innerText = 'EMAIL MESSAGE';

  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const recipientsDisplay = getRecipientsDisplay(email);
  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const replyTarget = isSentByMe ? (email.recipient_phone || recipientsDisplay || email.sender_email) : email.sender_email;
  const replyTargetName = isSentByMe ? (recipientsDisplay || 'Recipient') : formattedSender;

  const toLabel = document.getElementById('inline-dock-recipient-label');
  if (toLabel) {
    if (replyTargetName && replyTarget && replyTargetName.includes(replyTarget)) {
      toLabel.innerText = `To: ${replyTargetName}`;
    } else if (replyTargetName && replyTarget) {
      toLabel.innerText = `To: ${replyTargetName} (${replyTarget})`;
    } else {
      toLabel.innerText = `To: ${replyTargetName || replyTarget || 'Recipient'}`;
    }
  }

  // Populate email message in reading container
  renderDesktopEmailReadingView(email);

  // Reset reply input
  cancelDesktopQuotedReply();
  const replyInput = document.getElementById('desktop-thread-reply-input');
  if (replyInput) replyInput.value = '';

  // Star and Important status
  const starBtn = document.getElementById('pane-star-btn');
  if (starBtn) {
    starBtn.style.color = email.is_starred === 1 ? 'var(--accent-amber)' : 'var(--text-dim)';
  }
  const impBtn = document.getElementById('pane-important-btn');
  if (impBtn) {
    impBtn.style.color = email.is_important === 1 ? '#ef4444' : 'var(--text-dim)';
    const svg = impBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', email.is_important === 1 ? '#ef4444' : 'none');
  }
}

function getFormattedEmailBody(email) {
  if (!email) return '<span style="color: var(--text-dim); font-style: italic;">(No Content)</span>';

  let html = (email.body_html || '').trim();
  let text = (email.body_text || '').trim();

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
        <div class="email-body-text-fallback" style="margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border-color, #e2e8f0); line-height: 1.6; color: var(--text-main);">
          ${formattedText}
        </div>
      `;
    }

    return html;
  }

  // Fallback to plain text
  if (text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  return '<span style="color: var(--text-dim); font-style: italic;">(No Content)</span>';
}

function renderDesktopEmailReadingView(email) {
  const container = document.getElementById('reading-thread-container');
  if (!container) return;
  container.innerHTML = '';

  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const formattedSender = formatSenderDisplay(email.sender_email, false, email.sender_name);
  const timeDisplay = new Date(email.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const isPhoneMail = isPhoneMailSender(email.sender_email);

  const avatarUrl = getAvatarUrl(email.sender_email, formattedSender);
  const fallbackSvg = generateDefaultAvatar(email.sender_email, formattedSender);
  const initials = getInitials(formattedSender);

  // Attachments HTML
  let attachmentsHtml = '';
  let attList = [];
  if (email.attachments) {
    try {
      attList = typeof email.attachments === 'string' ? JSON.parse(email.attachments) : email.attachments;
    } catch(e) {}
  }
  if (Array.isArray(attList) && attList.length > 0) {
    attachmentsHtml = `
      <div class="thread-attachments-box" style="margin-top: 16px; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-dim); margin-bottom: 8px;">ATTACHMENTS (${attList.length})</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${attList.map(att => `
            <a href="${att.url || '#'}" download="${att.filename || 'attachment'}" style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 6px; text-decoration: none; color: var(--text-main); font-size: 12px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              <span>${escapeHtml(att.filename || 'Attachment')}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Extract inline or attached voice mail audio
  let voiceMailAudioSrc = '';
  let voiceMailDuration = '0:00';
  let voiceMailTranscript = '';

  if (email.body_html) {
    const audioMatch = email.body_html.match(/<audio[^>]+src=["']([^"']+)["']/i) || email.body_html.match(/data-audio-src=["']([^"']+)["']/i);
    if (audioMatch) {
      voiceMailAudioSrc = audioMatch[1];
      const durMatch = email.body_html.match(/data-duration=["']([^"']+)["']/i);
      if (durMatch && durMatch[1]) voiceMailDuration = durMatch[1];
      const transMatch = email.body_html.match(/class=["'][^"']*voicemail-transcript-box[^"']*["'][^>]*>[\s\S]*?<span[^>]*>"?([^"<]+)"?<\/span>/i);
      if (transMatch && transMatch[1]) voiceMailTranscript = transMatch[1];
    }
  }
  if (!voiceMailAudioSrc && Array.isArray(attList)) {
    const audioAtt = attList.find(a => (a.mimeType && a.mimeType.startsWith('audio/')) || (a.filename && a.filename.startsWith('voicemail_')));
    if (audioAtt) {
      voiceMailAudioSrc = audioAtt.url || `/api/attachments/${audioAtt.id}`;
    }
  }
  if (!voiceMailTranscript && email.body_text) {
    const txtTransMatch = email.body_text.match(/"([^"]+)"/);
    if (txtTransMatch) voiceMailTranscript = txtTransMatch[1];
    const durTxtMatch = email.body_text.match(/Voice Mail\s*\(([^)]+)\)/i);
    if (durTxtMatch) voiceMailDuration = durTxtMatch[1];
  }

  const isPureVoiceMail = voiceMailAudioSrc && (!email.body_text || email.body_text.trim().startsWith('🎙️ Voice Mail'));

  const voiceNoteHtml = voiceMailAudioSrc ? `
    <div class="chat-voice-note-player" id="voice-player-${email.id}">
      <button type="button" class="voice-play-toggle" onclick="toggleAudioBubblePlayback('${email.id}', '${voiceMailAudioSrc}', this)" title="Play / Pause Voice Mail">
        <svg class="play-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>
        <svg class="pause-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display: none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>

      <div class="voice-waveform-area" onclick="seekAudioBubble('${email.id}', event)">
        <div class="voice-waveform-bars" id="waveform-bars-${email.id}">
          <span class="wave-bar" style="height: 35%;"></span>
          <span class="wave-bar" style="height: 55%;"></span>
          <span class="wave-bar" style="height: 80%;"></span>
          <span class="wave-bar" style="height: 45%;"></span>
          <span class="wave-bar" style="height: 90%;"></span>
          <span class="wave-bar" style="height: 60%;"></span>
          <span class="wave-bar" style="height: 100%;"></span>
          <span class="wave-bar" style="height: 75%;"></span>
          <span class="wave-bar" style="height: 40%;"></span>
          <span class="wave-bar" style="height: 85%;"></span>
          <span class="wave-bar" style="height: 65%;"></span>
          <span class="wave-bar" style="height: 95%;"></span>
          <span class="wave-bar" style="height: 50%;"></span>
          <span class="wave-bar" style="height: 70%;"></span>
          <span class="wave-bar" style="height: 35%;"></span>
          <span class="wave-bar" style="height: 80%;"></span>
          <span class="wave-bar" style="height: 60%;"></span>
          <span class="wave-bar" style="height: 40%;"></span>
        </div>
        <div class="voice-time-row">
          <span class="voice-timer" id="voice-timer-${email.id}">0:00</span>
          <span class="voice-total-duration">${voiceMailDuration || 'Voice Note'}</span>
        </div>
      </div>

      <div class="voice-avatar-badge">
        <span class="voice-mic-badge">🎙️</span>
      </div>

      <button type="button" class="voice-speed-chip" onclick="toggleAudioSpeed('${email.id}', this)" title="Playback speed">1x</button>
    </div>
    ${voiceMailTranscript ? `
      <div class="voice-transcript-accordion">
        <button type="button" class="btn-toggle-transcript" onclick="toggleTranscriptView('${email.id}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>AI Audio Transcription</span>
        </button>
        <div class="voice-transcript-text" id="voice-transcript-${email.id}" style="display: none; margin-top: 6px; padding: 8px 12px; background: var(--bg-hover); border-radius: 6px; font-size: 13px; font-style: italic; color: var(--text-muted); border-left: 3px solid var(--green-main);">
          "${escapeHtml(voiceMailTranscript)}"
        </div>
      </div>
    ` : ''}
  ` : '';

  const rawBody = getFormattedEmailBody(email);

  const card = document.createElement('div');
  card.className = `thread-message-card ${isSentByMe ? 'outgoing' : 'incoming'}`;
  card.id = `email-view-card-${email.id}`;

  card.innerHTML = `
    <div class="thread-card-header">
      <div class="thread-sender-info">
        <div class="thread-avatar" onclick="openContactInfoModal('${escapeHtml(email.sender_email)}');" title="View ${escapeHtml(formattedSender)} Digital ID Card" style="cursor: pointer;">
          <img src="${avatarUrl}" alt="${escapeHtml(formattedSender)}" class="avatar-inner-img" onerror="this.onerror=null; this.src='${fallbackSvg}';">
          <span class="avatar-fallback-initial" style="display:none;">${initials}</span>
        </div>
        <div class="thread-meta-col">
          <div class="thread-sender-name">
            <span>${escapeHtml(formattedSender)}</span>
            <span class="badge-source-tag ${isPhoneMail ? 'badge-phonemail-pill' : 'badge-external-pill'}">
              ${isPhoneMail 
                ? '<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>INAI Network</span>' 
                : '<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>External Provider</span>'
              }
            </span>
            <span class="badge-source-tag badge-encrypted-pill" onclick="showEncryptionDetails('${escapeHtml(email.security_fingerprint || 'INAI-SEC-AES256')}', event)" title="Protected with AES-256-GCM authenticated payload encryption & TLS 1.3 transport. Tap for cryptographic certificate.">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>AES-256 Encrypted</span>
            </span>
          </div>
          <div class="thread-time" style="display: flex; align-items: center; gap: 8px;">
            <span>${timeDisplay}</span>
            <span style="color: var(--text-dim); font-size: 11px;">To: ${escapeHtml(getRecipientsDisplay(email) || 'Me')}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="thread-card-body" style="margin-top: 14px; font-size: 14px; line-height: 1.6; color: var(--text-main);">
      ${voiceNoteHtml}
      ${isPureVoiceMail ? '' : rawBody}
    </div>
    ${attachmentsHtml}
  `;

  container.appendChild(card);
}

function showEncryptionDetails(fingerprint, e) {
  if (e) e.stopPropagation();
  const fp = fingerprint || 'INAI-SEC-AES256-AUTHENTICATED';
  if (window.showNotify && window.showNotify.info) {
    window.showNotify.info(
      `🔐 Cryptographic Security Breakdown:\n` +
      `• Payload Cipher: AES-256-GCM (Authenticated Encryption)\n` +
      `• Transport: TLS 1.3 & SMTPS (Port 465 SSL)\n` +
      `• Storage: Zero-Knowledge Payload in MySQL/SQLite\n` +
      `• Digital Verification Stamp: ${fp}\n` +
      `• Network: Verified INAI Phone-to-Email Matrix`,
      'AES-256 Cryptographic Certificate'
    );
  } else {
    alert(`🔐 AES-256-GCM Encrypted Email\nStamp: ${fp}\nTransport: TLS 1.3 / Port 465 SSL`);
  }
}

function openEmailDetails(email) {
  if (!email) return;
  openEmail(email.id);
}


// ==================== DESKTOP THREAD REPLY LOGIC ====================
function triggerDesktopReply(msgId, e) {
  if (e) e.stopPropagation();
  const input = document.getElementById('desktop-thread-reply-input');
  if (input) input.focus();
}

function cancelDesktopQuotedReply() {
  activeReplyingMessage = null;
  const quoteBar = document.getElementById('desktop-quote-bar');
  if (quoteBar) quoteBar.style.display = 'none';
  const input = document.getElementById('desktop-thread-reply-input');
  if (input) input.placeholder = 'Type a reply to this email...';
}

async function submitDesktopThreadReply() {
  const targetEmail = activeEmail;
  if (!targetEmail) return;
  const input = document.getElementById('desktop-thread-reply-input');
  if (!input) return;
  const body = input.value.trim();
  if (!body && !desktopDockVoiceMail) {
    showToastNotification('Please enter a reply message or record a voice note', 'warning');
    return;
  }

  const isSentByMe = Boolean(targetEmail.sender_email && currentUser && targetEmail.sender_email.includes(currentUser.phone));
  let to = '';
  if (isSentByMe) {
    if (targetEmail.recipient_phone) {
      to = targetEmail.recipient_phone;
    } else if (targetEmail.recipient_emails) {
      try {
        const arr = JSON.parse(targetEmail.recipient_emails);
        if (Array.isArray(arr) && arr.length > 0) to = arr[0];
      } catch(e) {
        to = targetEmail.recipient_emails;
      }
    }
    if (!to) to = getRecipientsDisplay(targetEmail) || targetEmail.sender_email;
  } else {
    to = targetEmail.sender_email;
  }
  const cleanSubject = (targetEmail.subject || '').replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '');
  const subject = `Re: ${cleanSubject}`;

  const voiceSnapshot = desktopDockVoiceMail ? { ...desktopDockVoiceMail } : null;
  const finalBody = body || (voiceSnapshot ? `🎙️ Voice Mail (${voiceSnapshot.duration})` : '');

  try {
    const payload = {
      sender_phone: currentUser.phone,
      to: to,
      subject: subject,
      body: finalBody,
      voiceMail: voiceSnapshot,
      reply_to_id: targetEmail.id,
      conversation_id: targetEmail.conversation_id || null
    };

    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      input.value = '';
      cancelDesktopQuotedReply();
      removeDesktopDockVoiceMail();

      // Append new outgoing message card to container
      const container = document.getElementById('reading-thread-container');
      if (container) {
        const timeDisplay = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        const senderName = currentUser.name || currentUser.phone;
        const card = document.createElement('div');
        const replyMsgId = data.email ? data.email.id : `tmp_${Date.now()}`;
        card.className = 'thread-message-card outgoing';
        card.id = `email-view-card-${replyMsgId}`;

        const replyVoiceHtml = voiceSnapshot ? `
          <div class="chat-voice-note-player" id="voice-player-${replyMsgId}">
            <button type="button" class="voice-play-toggle" onclick="toggleAudioBubblePlayback('${replyMsgId}', '${voiceSnapshot.dataUrl}', this)" title="Play / Pause Voice Mail">
              <svg class="play-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>
              <svg class="pause-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display: none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            </button>
            <div class="voice-waveform-area" onclick="seekAudioBubble('${replyMsgId}', event)">
              <div class="voice-waveform-bars" id="waveform-bars-${replyMsgId}">
                <span class="wave-bar" style="height: 35%;"></span>
                <span class="wave-bar" style="height: 55%;"></span>
                <span class="wave-bar" style="height: 80%;"></span>
                <span class="wave-bar" style="height: 45%;"></span>
                <span class="wave-bar" style="height: 90%;"></span>
                <span class="wave-bar" style="height: 60%;"></span>
                <span class="wave-bar" style="height: 100%;"></span>
                <span class="wave-bar" style="height: 75%;"></span>
                <span class="wave-bar" style="height: 40%;"></span>
                <span class="wave-bar" style="height: 85%;"></span>
                <span class="wave-bar" style="height: 65%;"></span>
                <span class="wave-bar" style="height: 95%;"></span>
                <span class="wave-bar" style="height: 50%;"></span>
                <span class="wave-bar" style="height: 70%;"></span>
                <span class="wave-bar" style="height: 35%;"></span>
                <span class="wave-bar" style="height: 80%;"></span>
                <span class="wave-bar" style="height: 60%;"></span>
                <span class="wave-bar" style="height: 40%;"></span>
              </div>
              <div class="voice-time-row">
                <span class="voice-timer" id="voice-timer-${replyMsgId}">0:00</span>
                <span class="voice-total-duration">${voiceSnapshot.duration}</span>
              </div>
            </div>
            <div class="voice-avatar-badge">
              <span class="voice-mic-badge">🎙️</span>
            </div>
            <button type="button" class="voice-speed-chip" onclick="toggleAudioSpeed('${replyMsgId}', this)" title="Playback speed">1x</button>
          </div>
          ${voiceSnapshot.transcription ? `
            <div class="voice-transcript-accordion">
              <button type="button" class="btn-toggle-transcript" onclick="toggleTranscriptView('${replyMsgId}')">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>AI Audio Transcription</span>
              </button>
              <div class="voice-transcript-text" id="voice-transcript-${replyMsgId}" style="display: none; margin-top: 6px; padding: 8px 12px; background: var(--bg-hover); border-radius: 6px; font-size: 13px; font-style: italic; color: var(--text-muted); border-left: 3px solid var(--green-main);">
                "${escapeHtml(voiceSnapshot.transcription)}"
              </div>
            </div>
          ` : ''}
        ` : '';

        card.innerHTML = `
          <div class="thread-card-header">
            <div class="thread-sender-info">
              <div class="thread-avatar">
                <img src="${currentUser.avatar_url || generateDefaultAvatar(currentUser.phone, senderName)}" alt="${escapeHtml(senderName)}" class="avatar-inner-img">
              </div>
              <div class="thread-meta-col">
                <div class="thread-sender-name">
                  <span>${escapeHtml(senderName)}</span>
                  <span class="badge-source-tag badge-phonemail-pill"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>INAI Network</span></span>
                </div>
                <div class="thread-time">${timeDisplay} • Sent</div>
              </div>
            </div>
          </div>
          <div class="thread-card-body" style="margin-top: 14px; font-size: 14px; line-height: 1.6; color: var(--text-main);">
            ${replyVoiceHtml}
            ${body ? escapeHtml(body).replace(/\n/g, '<br>') : ''}
          </div>
        `;
        container.appendChild(card);
        card.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }

      showToastNotification(voiceSnapshot ? 'Voice Mail sent! 🎙️🚀' : 'Reply sent successfully! 🚀', 'success');
      emailFolderCache = {};
    } else {
      showToastNotification(data.error || 'Failed to send reply', 'error');
    }
  } catch (err) {
    showToastNotification('Failed to send reply', 'error');
  }
}

function closeReadingPane(shouldReload = true) {
  if (desktopVoiceActiveContext === 'desktop-dock') {
    cancelVoiceRecording('desktop-dock');
  }
  removeDesktopDockVoiceMail();
  if (currentActiveAudio) {
    currentActiveAudio.pause();
    currentActiveAudio = null;
    currentPlayingMsgId = null;
  }

  const readingPane = document.getElementById('reading-pane');
  if (readingPane) readingPane.style.display = 'none';
  
  const mailList = document.getElementById('mail-list-pane');
  if (mailList) mailList.style.display = 'flex';
  
  activeEmail = null;
  if (shouldReload) {
    loadEmails(currentFolder);
  }
}

// ==================== STAR & MOVE ACTIONS ====================
async function toggleStar(id, e) {
  if (e) e.stopPropagation();
  try {
    const res = await fetch(`/api/emails/${id}/star`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadEmails();
      if (activeEmail && activeEmail.id === id) {
        activeEmail.is_starred = data.is_starred;
        const starBtn = document.getElementById('pane-star-btn');
        if (starBtn) {
          starBtn.innerText = data.is_starred === 1 ? '★' : '☆';
          starBtn.style.color = data.is_starred === 1 ? 'var(--accent-amber)' : 'var(--text-dim)';
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function toggleCurrentStar() {
  if (activeEmail) toggleStar(activeEmail.id);
}

async function deleteCurrentEmail() {
  if (!activeEmail) return;
  const id = activeEmail.id;
  closeReadingPane();
  executeBulkActionOnSingle(id, 'delete');
}

async function reportCurrentEmailSpam() {
  if (!activeEmail) return;
  const id = activeEmail.id;
  const rawSender = activeEmail.sender_email;
  const senderName = activeEmail.sender_name || rawSender;
  if (!confirm(`Are you sure you want to report this email as spam? It will be moved to the Spam folder.`)) {
    return;
  }
  closeReadingPane(false);
  await executeBulkActionOnSingle(id, 'spam');
  syncFolderStats();
}

async function blockCurrentSender() {
  if (!activeEmail) return;
  const rawSender = activeEmail.sender_email;
  const senderName = activeEmail.sender_name || rawSender;
  if (!confirm(`Are you sure you want to block ${senderName}? All emails from this sender will be moved to Spam.`)) {
    return;
  }
  try {
    const res = await fetch('/api/emails/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPhone: currentUser.phone,
        sender: rawSender
      })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showNotify !== 'undefined') {
        showNotify.success(`Blocked ${senderName}. Future emails will go to Spam.`, 'Sender Blocked');
      }
      closeReadingPane();
      emailFolderCache = {};
      loadEmails(currentFolder);
    } else {
      if (typeof showNotify !== 'undefined') showNotify.error(data.error || 'Failed to block sender', 'Error');
    }
  } catch (err) {
    if (typeof showNotify !== 'undefined') showNotify.error(err.message, 'Block Error');
  }
}

// ==================== SEARCH & FILTER ====================
function filterEmails(query) {
  searchTerm = (query || '').toLowerCase().trim();
  currentEmailPage = 1;
  updateDesktopClearBtnVisibility();
  renderEmailList(allEmails);
}

// ==================== COMPOSE MODAL & CONTACTS AUTOCOMPLETE ====================
function renderContactsDropdown(contacts, headerTitle = 'Registered PhoneMail Users') {
  const input = document.getElementById('desk-compose-to');
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (!dropdown || !input) return;

  if (!contacts || contacts.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = `<div class="contacts-autocomplete-header">${escapeHtml(headerTitle)}</div>`;
  contacts.slice(0, 6).forEach(c => {
    const item = document.createElement('div');
    item.className = 'contact-autocomplete-item';
    const initial = getInitials(c.display_name || c.phone_number);
    item.innerHTML = `
      <div class="contact-item-avatar">${initial}</div>
      <div class="contact-item-info">
        <div class="contact-item-name">${escapeHtml(c.display_name || `User ${c.phone_number}`)}</div>
        <div class="contact-item-meta">
          <span>📞 +91 ${escapeHtml(c.phone_number)}</span>
          <span class="contact-item-badge" style="background: rgba(4, 106, 56, 0.12); color: #046A38; border: 1px solid rgba(4, 106, 56, 0.3);">✓ PhoneMail</span>
        </div>
      </div>
    `;
    item.onmousedown = (e) => {
      e.preventDefault();
      input.value = c.phone_number;
      dropdown.style.display = 'none';
      verifyAndRenderRecipientStatus(c.phone_number, 'desk-recipient-verify-pill');
      document.getElementById('desk-compose-subject').focus();
    };
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

async function pickDeviceContacts() {
  const input = document.getElementById('desk-compose-to');
  if ('contacts' in navigator && 'ContactsManager' in window) {
    try {
      const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      if (selected && selected.length > 0) {
        const rawPhones = [];
        selected.forEach(c => {
          if (c.tel) c.tel.forEach(t => rawPhones.push(t));
        });

        if (rawPhones.length === 0) {
          showNotify.warning('No phone numbers found in selected device contacts.', 'No Phone Numbers');
          return;
        }

        showNotify.info('Checking which device contacts are registered on PhoneMail...', 'Contact Sync');
        const res = await fetch('/api/contacts/filter-phonemail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumbers: rawPhones })
        });
        const data = await res.json();
        const registered = data.registeredContacts || [];

        if (registered.length === 0) {
          showNotify.info('None of the selected device contacts are registered on PhoneMail yet.', 'No Matches');
        } else {
          // Cache in localStorage for automatic future auto-completion & real-time sync
          try {
            localStorage.setItem('phonemail_cached_device_contacts', JSON.stringify(registered));
            localStorage.setItem('phonemail_contact_sync_permission', 'granted');
            localStorage.setItem('phonemail_raw_device_numbers', JSON.stringify(rawPhones));
            cachedDeviceContacts = registered;
            startRealtimeContactSync();
          } catch (e) {}

          if (registered.length === 1) {
            if (input) input.value = registered[0].phone_number;
            showNotify.success(`Selected ${registered[0].display_name} (+91 ${registered[0].phone_number})`, 'Device Contact');
          } else {
            showNotify.success(`Found ${registered.length} registered PhoneMail contacts from your device!`, 'Device Contacts');
            renderContactsDropdown(registered, 'Device Contacts Registered with PhoneMail');
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        showNotify.info('Device contact picker cancelled or unavailable.');
      }
    }
  } else {
    // Elegant fallback prompt dialog
    showPromptDialog({
      title: 'Search PhoneMail Contacts',
      message: 'Enter a 10-digit mobile number or name to search registered PhoneMail users:',
      placeholder: 'e.g. 9876543210 or Rahul',
      confirmText: 'Search',
      onConfirm: async (q) => {
        if (!q) return;
        try {
          const res = await fetch(`/api/contacts?phone=${currentUser ? currentUser.phone : ''}&q=${encodeURIComponent(q)}`);
          const data = await res.json();
          const list = data.contacts || [];
          if (list.length === 0) {
            showNotify.info(`No registered PhoneMail user found for "${q}". External email addresses can be entered directly.`, 'No Matches');
          } else if (list.length === 1) {
            if (input) input.value = list[0].phone_number;
            showNotify.success(`Selected ${list[0].display_name} (+91 ${list[0].phone_number})`, 'Contact Selected');
          } else {
            renderContactsDropdown(list, `Matching Registered Users for "${q}"`);
          }
        } catch (err) {
          showNotify.error('Failed to search contacts: ' + err.message, 'Search Error');
        }
      }
    });
  }
}

function setupContactsAutocomplete() {
  const input = document.getElementById('desk-compose-to');
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (!input || !dropdown) return;

  let debounceTimer = null;

  async function fetchAndRender(query = '') {
    try {
      if (!currentUser) return;
      const q = query.trim();

      // If search query is >= 2 characters, search registered users
      if (q.length >= 2) {
        // If it's a full email address (e.g. gmail), no need to search phone numbers
        if (q.includes('@') && (q.endsWith('.com') || q.endsWith('.net') || q.endsWith('.org') || q.endsWith('.in'))) {
          dropdown.style.display = 'none';
          return;
        }

        const res = await fetch(`/api/contacts?phone=${currentUser.phone}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const matches = data.contacts || [];

        if (matches.length === 0) {
          dropdown.innerHTML = `
            <div class="contacts-autocomplete-header" style="color: var(--text-dim); font-size: 11px; font-weight: normal; padding: 10px;">
              No registered PhoneMail users matching "${escapeHtml(q)}".<br>
              <span style="color: var(--green-main); font-size: 11px;">External emails (e.g. @gmail.com) can be entered directly.</span>
            </div>
          `;
          dropdown.style.display = 'block';
          return;
        }

        renderContactsDropdown(matches, 'Registered PhoneMail Users');
        return;
      }

      // If query is empty: combine recent conversation contacts + cached device contacts
      let combined = [];
      const res = await fetch(`/api/contacts?phone=${currentUser.phone}`);
      const data = await res.json();
      const recentContacts = data.contacts || [];
      recentContacts.forEach(c => combined.push(c));

      // Check cached device contacts from localStorage
      try {
        const rawCached = localStorage.getItem('phonemail_cached_device_contacts');
        if (rawCached) {
          const deviceList = JSON.parse(rawCached);
          if (Array.isArray(deviceList)) {
            deviceList.forEach(dc => {
              if (!combined.some(item => item.phone_number === dc.phone_number)) {
                combined.push({
                  ...dc,
                  is_device: true
                });
              }
            });
          }
        }
      } catch (e) {}

      if (combined.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      renderContactsDropdown(combined, 'Recent & Synced Device Contacts');
    } catch (err) {
      console.warn('Failed to load contacts for autocomplete:', err);
    }
  }

  let verifyDebounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchAndRender(input.value), 250);
    clearTimeout(verifyDebounce);
    verifyDebounce = setTimeout(() => verifyAndRenderRecipientStatus(input.value, 'desk-recipient-verify-pill'), 180);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      fetchAndRender('');
    } else {
      verifyAndRenderRecipientStatus(input.value, 'desk-recipient-verify-pill');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 250);
  });
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

      if (contactName) {
        try {
          const namesMap = JSON.parse(localStorage.getItem('phonemail_cached_device_names') || '{}');
          namesMap[cleanPhone] = contactName;
          localStorage.setItem('phonemail_cached_device_names', JSON.stringify(namesMap));
        } catch(e) {}
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
                <input type="checkbox" id="desk-send-textbee-sms" checked>
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
              <input type="checkbox" id="desk-send-textbee-sms" checked>
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

let activeDesktopDraftId = null;

function openDraftInCompose(email) {
  if (!email) return;
  activeDesktopDraftId = email.id;
  currentReplyToId = null;
  currentReplyConvId = null;

  const modal = document.getElementById('desktop-compose-modal');
  if (!modal) return;

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

  document.getElementById('desk-compose-to').value = recipientText;
  document.getElementById('desk-compose-subject').value = email.subject || '';
  document.getElementById('desk-compose-body').value = email.body_text || email.body || '';

  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const verifyPill = document.getElementById('desk-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }

  modal.style.display = 'block';
  setTimeout(() => document.getElementById('desk-compose-body').focus(), 50);
}

async function saveDesktopDraft() {
  if (!currentUser || !currentUser.phone) {
    showNotify.error('Please log in to save drafts', 'Not Logged In');
    return;
  }
  const to = document.getElementById('desk-compose-to').value.trim();
  const subject = document.getElementById('desk-compose-subject').value.trim();
  const body = document.getElementById('desk-compose-body').value.trim();

  if (!to && !subject && !body) {
    showNotify.warning('Draft is completely empty. Please enter recipient, subject, or content.', 'Empty Draft');
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
        draftId: activeDesktopDraftId
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeDesktopDraftId = data.draftId;
      showNotify.success('Draft saved successfully! 📝', 'Draft Saved');
      syncFolderStats();
      if (currentFolder === 'DRAFTS') {
        emailFolderCache = {};
        loadEmails('DRAFTS');
      }
    } else {
      showNotify.error(data.error || 'Failed to save draft', 'Draft Error');
    }
  } catch (err) {
    showNotify.error('Error saving draft: ' + err.message, 'Network Error');
  }
}

function openComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (!modal) return;
  activeDesktopDraftId = null;
  currentReplyToId = null;
  currentReplyConvId = null;
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = '';
  document.getElementById('desk-compose-body').value = '';
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const verifyPill = document.getElementById('desk-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }
  modal.style.display = 'block';
  setTimeout(() => document.getElementById('desk-compose-to').focus(), 50);
}

function closeComposeModal() {
  if (desktopVoiceActiveContext === 'desktop-compose') {
    cancelVoiceRecording('desktop-compose');
  }
  removeDesktopComposeVoiceMail();

  const modal = document.getElementById('desktop-compose-modal');
  if (modal) modal.style.display = 'none';
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const verifyPill = document.getElementById('desk-recipient-verify-pill');
  if (verifyPill) {
    verifyPill.style.display = 'none';
    verifyPill.innerHTML = '';
  }
  activeDesktopDraftId = null;
  currentReplyToId = null;
  currentReplyConvId = null;
}

function startQuickReply() {
  if (!activeEmail) return;
  if (activeEmail.has_replied === 1) {
    showNotify.warning('This message has already been replied to. Each message can be replied to only once.', 'Single Reply Policy');
    return;
  }
  openComposeModal();
  currentReplyToId = activeEmail.id;
  currentReplyConvId = activeEmail.conversation_id;
  
  const isSentByMe = Boolean(activeEmail.sender_email && currentUser && activeEmail.sender_email.includes(currentUser.phone));
  const replyTarget = isSentByMe ? (getRecipientsDisplay(activeEmail) || activeEmail.sender_email) : activeEmail.sender_email;

  // If replyTarget is a PhoneMail user, extract only their phone number so the compose "To" stays clean
  const cleanTarget = isPhoneMailSender(replyTarget) 
    ? (replyTarget.match(/\b\d{10}\b/) ? replyTarget.match(/\b\d{10}\b/)[0] : replyTarget)
    : replyTarget;

  document.getElementById('desk-compose-to').value = cleanTarget;
  document.getElementById('desk-compose-subject').value = (activeEmail.subject || '').startsWith('Re:')
    ? activeEmail.subject
    : `Re: ${activeEmail.subject || ''}`;
  document.getElementById('desk-compose-body').focus();
}

async function sendDesktopEmail() {
  const to = document.getElementById('desk-compose-to').value.trim();
  const subject = document.getElementById('desk-compose-subject').value.trim();
  const body = document.getElementById('desk-compose-body').value.trim();
  const sendSms = Boolean(document.getElementById('desk-send-textbee-sms')?.checked);

  if (!to || (!body && !desktopComposeVoiceMail)) {
    showNotify.warning('Please enter recipient and message content or record a voice note.', 'Compose Incomplete');
    return;
  }

  const recipients = to.split(',').map(r => r.trim()).filter(Boolean);
  const voiceSnapshot = desktopComposeVoiceMail ? { ...desktopComposeVoiceMail } : null;
  const finalBody = body || (voiceSnapshot ? `🎙️ Voice Mail (${voiceSnapshot.duration})` : '');
  const finalSubject = subject || (voiceSnapshot ? `🎙️ Voice Mail (${voiceSnapshot.duration})` : '');

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderPhone: currentUser.phone,
        toRecipients: recipients,
        subject: finalSubject,
        bodyText: finalBody,
        voiceMail: voiceSnapshot,
        replyToId: currentReplyToId,
        conversationId: currentReplyConvId,
        send_sms: sendSms
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (activeDesktopDraftId) {
        fetch(`/api/emails/draft/${activeDesktopDraftId}`, { method: 'DELETE' }).catch(() => {});
        activeDesktopDraftId = null;
      }
      removeDesktopComposeVoiceMail();
      closeComposeModal();
      emailFolderCache = {};
      loadEmails();
      syncFolderStats();
      if (data.sms_dispatched) {
        showNotify.success('Email sent! Recipient notified via TextBee SMS 📱', 'Message & SMS Sent');
      } else {
        showNotify.success(voiceSnapshot ? 'Voice Mail sent! 🎙️🚀' : 'Email sent successfully!', 'Message Sent');
      }
    } else {
      showNotify.error(data.error || 'Failed to send email', 'Send Failed');
    }
  } catch (err) {
    showNotify.error('Error sending email: ' + err.message, 'Network Error');
  }
}

// ==================== SETTINGS & ALIASES ====================
async function openDesktopSettings() {
  document.getElementById('desktop-settings-modal').style.display = 'flex';
  loadDesktopAliases();
  initDesktopReadReceipts();
}

function initDesktopReadReceipts() {
  const saved = localStorage.getItem('phonemail_read_receipts');
  const isEnabled = saved === null ? true : saved === 'true';
  const toggle = document.getElementById('desk-read-receipts-toggle');
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

function toggleDesktopReadReceipts(checked) {
  localStorage.setItem('phonemail_read_receipts', checked ? 'true' : 'false');
  if (currentUser && currentUser.phone) {
    fetch('/api/settings/read-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: currentUser.phone, enabled: checked })
    }).catch(() => {});
  }
  showNotify.success(`Read Receipts ${checked ? 'Turned ON' : 'Turned OFF'}`, 'Preferences Updated');
}

function closeDesktopSettings() {
  document.getElementById('desktop-settings-modal').style.display = 'none';
}

async function loadDesktopAliases() {
  const list = document.getElementById('desk-aliases-list');
  const sidebarChips = document.getElementById('sidebar-alias-chips');

  if (list) list.innerHTML = '<div style="font-size:12px; color:var(--text-dim);">Loading aliases...</div>';

  try {
    const res = await fetch(`/api/aliases?phone=${currentUser.phone}`);
    const data = await res.json();
    
    if (list) list.innerHTML = '';
    if (sidebarChips) sidebarChips.innerHTML = '';

    if (data.aliases && data.aliases.length > 0) {
      data.aliases.forEach(a => {
        // Render in Settings Modal
        if (list) {
          const item = document.createElement('div');
          item.className = 'alias-item-bright';
          item.innerHTML = `
            <div class="alias-addr">🏷️ ${escapeHtml(a.alias_email)}</div>
            <div class="alias-lbl">${escapeHtml(a.label || 'Sub-number')}</div>
          `;
          list.appendChild(item);
        }

        const tag = a.alias_tag || (a.alias_email && a.alias_email.includes('.') ? a.alias_email.split('@')[0].split('.')[1] : null) || a.label || 'ext';
        // Render in Left Sidebar
        if (sidebarChips) {
          const chip = document.createElement('div');
          chip.className = 'alias-chip';
          chip.onclick = () => openDesktopSettings();
          chip.innerHTML = `
            <span class="chip-tag">🏷️ .${escapeHtml(tag)}</span>
            <span class="chip-status">${escapeHtml(a.label || 'Active')}</span>
          `;
          sidebarChips.appendChild(chip);
        }
      });
    } else {
      if (list) list.innerHTML = '<p style="font-size: 13px; color: var(--text-dim);">No aliases configured yet.</p>';
      if (sidebarChips) {
        sidebarChips.innerHTML = `
          <div class="alias-chip" onclick="openDesktopSettings()" style="opacity: 0.7;">
            <span class="chip-tag">+ Add Sub-number</span>
          </div>
        `;
      }
    }
  } catch (err) {
    if (list) list.innerHTML = '<div style="color:var(--accent-rose); font-size:12px;">Failed to load aliases</div>';
  }
}

async function addDesktopAlias() {
  const tag = document.getElementById('desk-new-tag').value.trim();
  const label = document.getElementById('desk-new-label').value.trim();
  if (!tag) {
    showNotify.warning('Please enter an alias tag (e.g. work, banking, 1)', 'Missing Tag');
    return;
  }
  try {
    const res = await fetch('/api/aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: currentUser.phone, aliasTag: tag, label })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('desk-new-tag').value = '';
      document.getElementById('desk-new-label').value = '';
      loadDesktopAliases();
      showNotify.success(`Sub-number .${tag} created!`, 'Sub-Number Added');
    } else {
      showNotify.error(data.error || 'Failed to add alias', 'Alias Error');
    }
  } catch (err) {
    showNotify.error(err.message, 'Server Error');
  }
}

// ==================== SESSION RESTORATION & LOGOUT ====================
function restoreSession() {
  // Check if Phone.Email redirected back with user_json_url
  const searchStr = window.location.search || (window.location.hash.includes('user_json_url') ? window.location.hash.replace(/^#/, '?') : '');
  const urlParams = new URLSearchParams(searchStr);
  const userJsonUrl = urlParams.get('user_json_url');
  if (userJsonUrl) {
    window.phoneEmailListener({ user_json_url: userJsonUrl });
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) {}
    return;
  }

  const saved = localStorage.getItem('phonemail-user') || 
                localStorage.getItem('inai_user') || 
                localStorage.getItem('phonemail-mobile-user') || 
                sessionStorage.getItem('phonemail-user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      if (currentUser) {
        let cleanPhone = (currentUser.phone || currentUser.phone_number || '').replace(/\D/g, '').slice(-10);
        if (cleanPhone.length !== 10 && currentUser.email) {
          cleanPhone = String(currentUser.email.split('@')[0] || '').replace(/\D/g, '').slice(-10);
        }
        if (cleanPhone.length !== 10 && currentUser.id) {
          cleanPhone = String(currentUser.id).replace(/\D/g, '').slice(-10);
        }
        if (cleanPhone.length !== 10) {
          const sp = localStorage.getItem('phonemail_saved_phone');
          if (sp) cleanPhone = String(sp).replace(/\D/g, '').slice(-10);
        }

        if (cleanPhone.length === 10) {
          currentUser.phone = cleanPhone;
          currentUser.phone_number = cleanPhone;
          currentUser.name = currentUser.name || currentUser.display_name || `User ${cleanPhone}`;
          currentUser.email = currentUser.email || currentUser.email_address || `${cleanPhone}@alphastack.wwisvnr.com`;

          document.documentElement.classList.add('has-saved-session');
          const auth = document.getElementById('desktop-auth-container');
          const main = document.getElementById('desktop-main-container');
          if (auth && main) {
            auth.style.display = 'none';
            main.style.display = 'flex';
            initDesktopApp();

            // Cross-device profile sync: fetch latest profile & aliases from database
            fetch(`/api/auth/me?phone=${encodeURIComponent(currentUser.phone)}`)
              .then(r => r.json())
              .then(data => {
                if (data && data.user) {
                  currentUser.name = data.user.display_name || currentUser.name;
                  currentUser.email = data.user.email_address || currentUser.email;
                  localStorage.setItem('phonemail-user', JSON.stringify(currentUser));
                  localStorage.setItem('inai_user', JSON.stringify(currentUser));
                  sessionStorage.setItem('phonemail-user', JSON.stringify(currentUser));
                  updateProfileDisplay();
                }
              })
              .catch(() => {});
          }
          return;
        }
      }
      // If we reach here, user had no valid 10-digit phone
      localStorage.removeItem('phonemail-user');
      localStorage.removeItem('inai_user');
      localStorage.removeItem('phonemail-mobile-user');
      sessionStorage.removeItem('phonemail-user');
      document.documentElement.classList.remove('has-saved-session');
      currentUser = null;
    } catch (e) {
      localStorage.removeItem('phonemail-user');
      localStorage.removeItem('inai_user');
      localStorage.removeItem('phonemail-mobile-user');
      sessionStorage.removeItem('phonemail-user');
      document.documentElement.classList.remove('has-saved-session');
      currentUser = null;
    }
  }
}

function logoutDesktop() {
  localStorage.removeItem('phonemail-user');
  localStorage.removeItem('inai_user');
  localStorage.removeItem('phonemail-mobile-user');
  sessionStorage.removeItem('phonemail-user');
  sessionStorage.removeItem('phonemail-mobile-user');
  document.documentElement.classList.remove('has-saved-session');
  currentUser = null;
  const auth = document.getElementById('desktop-auth-container');
  const main = document.getElementById('desktop-main-container');
  if (auth && main) {
    main.style.display = 'none';
    auth.style.display = 'flex';
    backToPhoneStep();
    const phoneInput = document.getElementById('desktop-phone-input');
    if (phoneInput) {
      phoneInput.value = '';
      phoneInput.focus();
    }
  }
  showToastNotification('Logged out successfully');
}

// Check session on startup and DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreSession);
} else {
  restoreSession();
}

// ==================== REAL-TIME MULTI-LANGUAGE TRANSLATION SYSTEM ====================
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
    compose: 'Compose Email',
    mailboxes: 'MAILBOXES',
    source_all: 'All',
    source_inai: 'INAI Network',
    source_external: 'External (Gmail...)',
    back_to_messages: 'Back to messages',
    ai_translate: 'AI Translate',
    original: 'Show Original',
    search_hint: 'Search phone numbers, contacts, subjects... (⌘K)',
    copy_mail_id: 'Copy Mail ID',
    copied: 'Copied! ✓'
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
    compose: 'नया मेल लिखें',
    mailboxes: 'मेल संदूक',
    source_all: 'सभी मेल',
    source_inai: 'INAI नेटवर्क',
    source_external: 'बाहरी मेल (Gmail...)',
    back_to_messages: 'संदेशों पर वापस जाएं',
    ai_translate: 'अनुवाद करें (AI)',
    original: 'मूल देखें',
    search_hint: 'फोन नंबर, संपर्क, विषय खोजें... (⌘K)',
    copy_mail_id: 'मेल आईडी कॉपी करें',
    copied: 'कॉपी किया गया! ✓'
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
    compose: 'அஞ்சல் எழுது',
    mailboxes: 'அஞ்சல் பெட்டிகள்',
    source_all: 'அனைத்து அஞ்சல்',
    source_inai: 'INAI பிணையம்',
    source_external: 'வெளிப்புறம் (Gmail...)',
    back_to_messages: 'மீண்டும் செய்திகளுக்கு',
    ai_translate: 'மொழிபெயர் (AI)',
    original: 'அசலைக் காட்டு',
    search_hint: 'எண்கள், முகவரிகளைத் தேடுங்கள்...',
    copy_mail_id: 'அஞ்சல் முகவரி நகலெடு',
    copied: 'நகலெடுக்கப்பட்டது! ✓'
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
    compose: 'మెయిల్ రాయండి',
    mailboxes: 'మెయిల్‌బాక్స్‌లు',
    source_all: 'అన్ని మెయిళ్ళు',
    source_inai: 'INAI నెట్‌వర్క్',
    source_external: 'బాహ్య (Gmail...)',
    back_to_messages: 'సందేశాలకు తిరిగి వెళ్ళు',
    ai_translate: 'అనువదించు (AI)',
    original: 'అసలు చూడండి',
    search_hint: 'నంబర్లు, విషయాలను వెతకండి...',
    copy_mail_id: 'మెయిల్ కాపీ చేయండి',
    copied: 'కాపీ చేయబడింది! ✓'
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
    compose: 'ಮೇಲ್ ಬರೆಯಿರಿ',
    mailboxes: 'ಮೇಲ್‌ಬಾಕ್ಸ್‌ಗಳು',
    source_all: 'ಎಲ್ಲಾ ಮೇಲ್',
    source_inai: 'INAI ನೆಟ್‌ವರ್ಕ್',
    source_external: 'ಬಾಹ್ಯ (Gmail...)',
    back_to_messages: 'ಸಂದೇಶಗಳಿಗೆ ಹಿಂತಿರುಗಿ',
    ai_translate: 'ಅನುವಾದಿಸಿ (AI)',
    original: 'ಮೂಲವನ್ನು ತೋರಿಸು',
    search_hint: 'ಸಂಖ್ಯೆ, ವಿಷಯಗಳನ್ನು ಹುಡುಕಿ...',
    copy_mail_id: 'ಮೇಲ್ ಐಡಿ ನಕಲಿಸಿ',
    copied: 'ನಕಲಿಸಲಾಗಿದೆ! ✓'
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
    compose: 'ইমেল লিখুন',
    mailboxes: 'মেলবক্স',
    source_all: 'সব ইমেল',
    source_inai: 'INAI নেটওয়ার্ক',
    source_external: 'বাহ্যিক (Gmail...)',
    back_to_messages: 'বার্তায় ফিরে যান',
    ai_translate: 'অনুবাদ করুন (AI)',
    original: 'মূল দেখুন',
    search_hint: 'নম্বর, বিষয় অনুসন্ধান করুন...',
    copy_mail_id: 'ইমেল আইডি কপি করুন',
    copied: 'কপি করা হয়েছে! ✓'
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
    compose: 'Redactar',
    mailboxes: 'BUZONES',
    source_all: 'Todo el correo',
    source_inai: 'Red INAI',
    source_external: 'Externo (Gmail...)',
    back_to_messages: 'Volver a mensajes',
    ai_translate: 'Traducir (IA)',
    original: 'Ver original',
    search_hint: 'Buscar números, contactos, asuntos...',
    copy_mail_id: 'Copiar correo',
    copied: '¡Copiado! ✓'
  }
};

function toggleDeskLangMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('desk-lang-menu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

function setInaiLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('inai_lang', lang);

  const langCodeEl = document.getElementById('desk-current-lang-code');
  if (langCodeEl) langCodeEl.innerText = lang.toUpperCase();

  // Update active state in menu
  document.querySelectorAll('.lang-menu-opt').forEach(opt => {
    opt.classList.remove('active');
    if (opt.getAttribute('onclick') && opt.getAttribute('onclick').includes(`'${lang}'`)) {
      opt.classList.add('active');
    }
  });

  const menu = document.getElementById('desk-lang-menu');
  if (menu) menu.style.display = 'none';

  applyInaiLanguage();
  showToastNotification(`Language set to ${lang.toUpperCase()} 🌐`);
}

function applyInaiLanguage() {
  const t = INAI_TRANSLATIONS[currentLanguage] || INAI_TRANSLATIONS.en;

  // Translate all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) {
      el.innerText = t[key];
    }
  });

  // Search input placeholder
  const searchInput = document.getElementById('desktop-search');
  if (searchInput && t.search_hint) {
    searchInput.placeholder = t.search_hint;
  }

  // Update current folder title
  const titleEl = document.getElementById('current-folder-title');
  if (titleEl) {
    titleEl.innerText = getFolderFriendlyName(currentFolder);
  }
}

// Global outside click to dismiss dropdowns
window.addEventListener('click', (e) => {
  const langMenu = document.getElementById('desk-lang-menu');
  if (langMenu && !e.target.closest('.lang-dropdown-wrapper')) {
    langMenu.style.display = 'none';
  }
  const selectMenu = document.getElementById('select-type-menu');
  if (selectMenu && !e.target.closest('.select-dropdown-container')) {
    selectMenu.style.display = 'none';
  }
});

// ==================== AI MESSAGE TRANSLATION ENGINE ====================
async function toggleMessageTranslation() {
  if (!activeEmail) return;

  const bodyEl = document.getElementById('full-body');
  const subjEl = document.getElementById('full-subject');
  const labelEl = document.getElementById('pane-trans-label');
  if (!bodyEl || !subjEl) return;

  if (isMessageTranslated) {
    // Revert to original
    subjEl.innerText = originalMessageSubject;
    bodyEl.innerHTML = originalMessageBody;
    isMessageTranslated = false;
    if (labelEl) labelEl.innerText = 'AI Translate';
    showToastNotification('Original message restored');
    return;
  }

  const targetLang = currentLanguage === 'en' ? 'hi' : currentLanguage;
  if (labelEl) labelEl.innerText = 'Translating...';

  try {
    const plainText = (activeEmail.body_text || bodyEl.innerText || '').trim();
    const cleanSubj = activeEmail.subject || '';

    // Fast neural translation via Google translate endpoint
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
      // Offline fallback dictionary
      translatedBody = fallbackLocalTranslate(plainText, targetLang).replace(/\n/g, '<br>');
    }

    subjEl.innerHTML = `<span style="font-size:11px; background: rgba(4,106,56,0.12); color: var(--green-main); padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-right: 6px;">AI ${targetLang.toUpperCase()}</span> ` + escapeHtml(translatedSubject);
    bodyEl.innerHTML = `
      <div style="padding: 10px 14px; background: rgba(4,106,56,0.06); border-left: 3px solid var(--green-main); border-radius: 6px; margin-bottom: 14px; font-size: 12px; color: var(--green-main); font-weight: 600;">
        ⚡ Real-time AI Translation (${targetLang.toUpperCase()})
      </div>
      <div>${translatedBody}</div>
    `;

    isMessageTranslated = true;
    if (labelEl) labelEl.innerText = 'Show Original';
    showToastNotification(`Translated message to ${targetLang.toUpperCase()} ✓`);
  } catch (err) {
    if (labelEl) labelEl.innerText = 'AI Translate';
    showToastNotification('Translation failed, showing original');
  }
}

function fallbackLocalTranslate(text, lang) {
  const dictionary = {
    hi: {
      'welcome': 'स्वागत है',
      'hello': 'नमस्ते',
      'thank you': 'धन्यवाद',
      'meeting': 'बैठक',
      'important': 'महत्वपूर्ण',
      'confirmed': 'पुष्टि की गई',
      'email': 'ईमेल',
      'phone': 'फ़ोन',
      'code': 'कोड',
      'verification': 'सत्यापन',
      'regards': 'सादर'
    },
    ta: {
      'welcome': 'வரவேற்கிறோம்',
      'hello': 'வணக்கம்',
      'thank you': 'நன்றி',
      'important': 'முக்கியமானது',
      'confirmed': 'உறுதிப்படுத்தப்பட்டது',
      'regards': 'மரியாதையுடன்'
    },
    te: {
      'welcome': 'స్వాగతం',
      'hello': 'నమస్కారం',
      'thank you': 'ధన్యవాదాలు',
      'important': 'ముఖ్యమైనది',
      'confirmed': 'ధృవీకరించబడింది',
      'regards': 'భవదీయుడు'
    },
    es: {
      'welcome': 'Bienvenido',
      'hello': 'Hola',
      'thank you': 'Gracias',
      'important': 'Importante',
      'confirmed': 'Confirmado',
      'regards': 'Saludos cordiales'
    }
  };

  const map = dictionary[lang] || {};
  let translated = text;
  Object.keys(map).forEach(word => {
    const reg = new RegExp('\\b' + word + '\\b', 'gi');
    translated = translated.replace(reg, map[word]);
  });
  return translated;
}

// ==================== DIGITAL ID CARD & PERSON INFO MANAGEMENT (DESKTOP) ====================
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
      // Recipient is the other party!
      const recDisplay = getRecipientsDisplay(activeEmail);
      target = activeEmail.recipient_phone || recDisplay || (activeEmail.recipient_emails && activeEmail.recipient_emails[0]);
      customName = lookupContactName(target) || activeEmail.recipient_name || '';
    } else {
      // Sender is the other party!
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

function openDigitalIdModal(initialTab = 'card') {
  openContactInfoModal(currentUser ? currentUser.phone : null, '', initialTab);
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

  const tabSwitcher = document.getElementById('id-card-tab-switcher');
  const btnEdit = document.getElementById('btn-id-tab-edit');
  if (tabSwitcher) {
    tabSwitcher.style.display = isSelf ? 'flex' : 'none';
  }
  if (btnEdit) {
    btnEdit.style.display = isSelf ? 'inline-flex' : 'none';
  }

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
  if (avatarEl) {
    avatarEl.innerHTML = `<img src="${avatarSvg}" alt="${escapeHtml(displayName)}" class="avatar-inner-img">`;
    avatarEl.style.backgroundImage = 'none';
  }

  if (qrEl) {
    const qrData = encodeURIComponent(`mailto:${defaultEmail}?subject=INAI%20Contact`);
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}`;
  }

  // Pre-fill edit inputs
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
  if (e && e.target && e.target.id !== 'digital-id-modal' && !e.target.classList.contains('close-btn')) return;
  const modal = document.getElementById('digital-id-modal');
  if (modal) modal.style.display = 'none';
  const card = document.getElementById('smart-mail-card');
  if (card) card.classList.remove('flipped');
}

function switchIdCardTab(tab) {
  if (tab === 'edit' && !activeContactModalIsSelf) {
    showNotify.warning('You can only edit your own Digital ID profile.', 'Read-Only Card');
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

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(name || 'INAI Member', 165, 335);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, monospace';
    ctx.fillText(phone || '+91 -', 165, 375);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, monospace';
    ctx.fillText(email || 'user@alphastack.wwisvnr.com', 165, 415);

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

    if (typeof showNotify !== 'undefined' && showNotify.success) {
      showNotify.success('Digital ID Card downloaded successfully! 🪪', 'Download Complete');
    }
  } catch (err) {
    console.error('Error downloading digital id card:', err);
    if (typeof showNotify !== 'undefined' && showNotify.error) {
      showNotify.error(err.message, 'Download Failed');
    }
  }
}

function selectPersonAvatarGradient(palette) {
  const target = activeContactForModal || (currentUser && currentUser.phone) || 'User';
  const preview = document.getElementById('edit-person-avatar-preview');
  const cardAvatar = document.getElementById('id-card-avatar-img');
  const newSvg = generateDefaultAvatar(`${target}_${palette}`, target);
  
  if (preview) {
    preview.innerHTML = `<img src="${newSvg}" alt="Avatar Preview" class="avatar-inner-img">`;
    preview.style.backgroundImage = 'none';
  }
  if (cardAvatar) {
    cardAvatar.innerHTML = `<img src="${newSvg}" alt="Avatar" class="avatar-inner-img">`;
    cardAvatar.style.backgroundImage = 'none';
  }
}

let activeCustomAvatarDataUrl = '';

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
    showNotify.warning('You can only edit your own Digital ID profile.', 'Read-Only Card');
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
      if (currentUser && (currentUser.phone === phone || currentUser.email === email)) {
        if (activeCustomAvatarDataUrl) currentUser.avatar_url = activeCustomAvatarDataUrl;
        currentUser.name = displayName;
        updateProfileDisplay();
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
      btnText.innerText = 'Copied! ✓';
      setTimeout(() => { btnText.innerText = 'Copy Mail ID'; }, 2000);
    }
    showToastNotification(`Mail ID copied to clipboard: ${email} 📋`, 'success');
  }).catch(() => {
    showToastNotification(`Email: ${email}`);
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

// ==================== FIND FRIENDS ON INAI (DESKTOP) ====================
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
      showToastNotification('Could not access device contacts. Please use manual entry below.', 'info');
    }
  } else {
    showToastNotification('Device contact picker available on supported mobile/Chrome browsers. Enter numbers below.', 'info');
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

  await queryAndRenderFriendsDesktop(candidates);
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
    showToastNotification('No valid 10-digit phone numbers found in contacts', 'warning');
    return;
  }

  await queryAndRenderFriendsDesktop(candidates);
}

async function queryAndRenderFriendsDesktop(candidates) {
  const resultsContainer = document.getElementById('find-friends-results');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div style="text-align: center; padding: 25px 10px; color: var(--text-dim);">
      <div style="margin-bottom: 8px;">🔍 Checking INAI network...</div>
      <div style="font-size: 11.5px;">Verifying contacts on PhoneMail infrastructure</div>
    </div>
  `;

  const uniqueMap = new Map();
  candidates.forEach(c => {
    if (!uniqueMap.has(c.cleanPhone)) uniqueMap.set(c.cleanPhone, c);
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

    let html = '';
    uniqueCandidates.forEach(cand => {
      const isRegistered = registeredMap.has(cand.cleanPhone);
      const regUser = isRegistered ? registeredMap.get(cand.cleanPhone) : null;
      const displayName = (regUser && regUser.display_name) || cand.name || `User ${cand.cleanPhone}`;
      const formattedPhone = `+91 ${cand.cleanPhone.substring(0, 5)} ${cand.cleanPhone.substring(5)}`;

      if (isRegistered) {
        html += `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: rgba(4,106,56,0.06); border: 1px solid rgba(4,106,56,0.2); border-radius: 10px;">
            <div>
              <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">${escapeHtml(displayName)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(formattedPhone)}</div>
              <span style="display: inline-block; margin-top: 3px; font-size: 11px; font-weight: 700; color: #046A38;">🟢 On INAI</span>
            </div>
            <button type="button" class="btn-primary" style="padding: 7px 14px; font-size: 12px;" onclick="messageInaiContactDesktop('${cand.cleanPhone}', '${escapeHtml(displayName)}')">Message</button>
          </div>
        `;
      } else {
        html += `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-hover); border: 1px solid var(--border-light); border-radius: 10px;">
            <div>
              <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">${escapeHtml(displayName)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(formattedPhone)}</div>
              <span style="display: inline-block; margin-top: 3px; font-size: 11px; font-weight: 600; color: var(--text-dim);">⚪ Not on INAI</span>
            </div>
            <button type="button" class="btn-secondary" style="padding: 7px 14px; font-size: 12px;" onclick="inviteFriendDesktop('${escapeHtml(displayName)}', '${cand.cleanPhone}')">Invite</button>
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

function messageInaiContactDesktop(phone, displayName) {
  closeFindFriendsModal();
  openComposeModal();
  const toInput = document.getElementById('desk-compose-to');
  if (toInput) toInput.value = `${phone}@alphastack.wwisvnr.com`;
  const subjInput = document.getElementById('desk-compose-subject');
  if (subjInput) subjInput.value = 'Hello via INAI';
  const bodyInput = document.getElementById('desk-compose-body');
  if (bodyInput) bodyInput.focus();
  showToastNotification(`Direct email opened for ${displayName} ✓`, 'success');
}

function inviteFriendDesktop(name, phone) {
  const inviteText = `Hey ${name || 'there'}! I'm using INAI (PhoneMail) for instant, secure communication by phone number. Join me at ${window.location.origin}/desktop/`;
  if (navigator.share) {
    navigator.share({
      title: 'Join me on INAI',
      text: inviteText,
      url: `${window.location.origin}/desktop/`
    }).catch(() => {});
  } else {
    const waUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(inviteText)}`;
    window.open(waUrl, '_blank');
  }
  showToastNotification(`Invite prepared for ${name || phone} ✓`, 'info');
}

// ==================== DESKTOP VOICE MAIL RECORDING & PLAYBACK CONTROLLER ====================
let desktopVoiceMediaRecorder = null;
let desktopVoiceMediaStream = null;
let desktopVoiceAudioChunks = [];
let desktopVoiceTimerInterval = null;
let desktopVoiceRecordSeconds = 0;
let desktopVoiceActiveContext = null; // 'desktop-dock' | 'desktop-compose'
let desktopVoiceSpeechRecognition = null;
let desktopVoiceLiveTranscript = '';
let desktopDockVoiceMail = null; // { dataUrl, duration, transcription }
let desktopComposeVoiceMail = null; // { dataUrl, duration, transcription }

// Audio Bubble Playback State
let currentActiveAudio = null;
let currentPlayingMsgId = null;

async function toggleVoiceRecording(context) {
  if (desktopVoiceMediaRecorder && desktopVoiceMediaRecorder.state === 'recording') {
    await stopVoiceRecording(context);
  } else {
    await startVoiceRecording(context);
  }
}

async function startVoiceRecording(context) {
  if (desktopVoiceMediaRecorder && desktopVoiceMediaRecorder.state === 'recording') {
    cancelVoiceRecording(desktopVoiceActiveContext);
  }

  desktopVoiceActiveContext = context;
  desktopVoiceAudioChunks = [];
  desktopVoiceRecordSeconds = 0;
  desktopVoiceLiveTranscript = '';

  try {
    desktopVoiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('Microphone permission denied or unavailable:', err);
    showToastNotification('Microphone access denied. Please allow microphone permissions in settings.', 'error');
    return;
  }

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
    desktopVoiceMediaRecorder = mimeType ? new MediaRecorder(desktopVoiceMediaStream, { mimeType }) : new MediaRecorder(desktopVoiceMediaStream);
  } catch(e) {
    desktopVoiceMediaRecorder = new MediaRecorder(desktopVoiceMediaStream);
  }

  desktopVoiceMediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      desktopVoiceAudioChunks.push(e.data);
    }
  };

  // Live Speech Recognition in Background
  try {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      desktopVoiceSpeechRecognition = new SpeechRec();
      desktopVoiceSpeechRecognition.continuous = true;
      desktopVoiceSpeechRecognition.interimResults = true;
      const langMap = { 'hi': 'hi-IN', 'ta': 'ta-IN', 'en': 'en-IN' };
      desktopVoiceSpeechRecognition.lang = (currentUser && langMap[currentUser.language]) ? langMap[currentUser.language] : 'en-US';
      desktopVoiceSpeechRecognition.onresult = (evt) => {
        let text = '';
        for (let i = 0; i < evt.results.length; i++) {
          text += evt.results[i][0].transcript + ' ';
        }
        desktopVoiceLiveTranscript = text.trim();
      };
      desktopVoiceSpeechRecognition.start();
    }
  } catch (recErr) {
    console.warn('Speech recognition notice:', recErr.message);
  }

  desktopVoiceMediaRecorder.start(200);

  // Update UI for recording
  if (context === 'desktop-dock') {
    const btn = document.getElementById('desk-voice-dock-btn');
    if (btn) btn.classList.add('recording');
    const lbl = document.getElementById('desk-voice-dock-label');
    if (lbl) lbl.innerText = 'Recording (0:00)...';
  } else if (context === 'desktop-compose') {
    const btn = document.getElementById('desk-voice-compose-btn');
    if (btn) btn.classList.add('recording');
    const lbl = document.getElementById('desk-voice-compose-label');
    if (lbl) lbl.innerText = 'Recording (0:00)...';
  }

  clearInterval(desktopVoiceTimerInterval);
  desktopVoiceTimerInterval = setInterval(() => {
    desktopVoiceRecordSeconds++;
    const mins = Math.floor(desktopVoiceRecordSeconds / 60);
    const secs = desktopVoiceRecordSeconds % 60;
    const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    if (context === 'desktop-dock') {
      const lbl = document.getElementById('desk-voice-dock-label');
      if (lbl) lbl.innerText = `Recording (${timeStr})...`;
    } else if (context === 'desktop-compose') {
      const lbl = document.getElementById('desk-voice-compose-label');
      if (lbl) lbl.innerText = `Recording (${timeStr})...`;
    }
  }, 1000);
}

function cancelVoiceRecording(context) {
  clearInterval(desktopVoiceTimerInterval);
  if (desktopVoiceSpeechRecognition) {
    try { desktopVoiceSpeechRecognition.stop(); } catch(e) {}
    desktopVoiceSpeechRecognition = null;
  }
  if (desktopVoiceMediaRecorder && desktopVoiceMediaRecorder.state !== 'inactive') {
    desktopVoiceMediaRecorder.stop();
  }
  if (desktopVoiceMediaStream) {
    desktopVoiceMediaStream.getTracks().forEach(t => t.stop());
    desktopVoiceMediaStream = null;
  }
  desktopVoiceAudioChunks = [];
  desktopVoiceRecordSeconds = 0;

  if (context === 'desktop-dock') {
    const btn = document.getElementById('desk-voice-dock-btn');
    if (btn) btn.classList.remove('recording');
    const lbl = document.getElementById('desk-voice-dock-label');
    if (lbl) lbl.innerText = desktopDockVoiceMail ? 'Re-record Voice' : 'Voice Mail';
  } else if (context === 'desktop-compose') {
    const btn = document.getElementById('desk-voice-compose-btn');
    if (btn) btn.classList.remove('recording');
    const lbl = document.getElementById('desk-voice-compose-label');
    if (lbl) lbl.innerText = desktopComposeVoiceMail ? 'Re-record Voice' : 'Voice Mail';
  }
}

async function stopVoiceRecording(context) {
  clearInterval(desktopVoiceTimerInterval);
  if (desktopVoiceSpeechRecognition) {
    try { desktopVoiceSpeechRecognition.stop(); } catch(e) {}
    desktopVoiceSpeechRecognition = null;
  }

  if (!desktopVoiceMediaRecorder || desktopVoiceMediaRecorder.state === 'inactive') {
    cancelVoiceRecording(context);
    return;
  }

  const mins = Math.floor(desktopVoiceRecordSeconds / 60);
  const secs = desktopVoiceRecordSeconds % 60;
  const durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return new Promise((resolve) => {
    desktopVoiceMediaRecorder.onstop = async () => {
      if (desktopVoiceMediaStream) {
        desktopVoiceMediaStream.getTracks().forEach(t => t.stop());
        desktopVoiceMediaStream = null;
      }

      const mimeType = desktopVoiceMediaRecorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(desktopVoiceAudioChunks, { type: mimeType });

      const reader = new FileReader();
      reader.onloadend = async () => {
        const audioDataUrl = reader.result;

        if (context === 'desktop-dock') {
          desktopDockVoiceMail = {
            dataUrl: audioDataUrl,
            duration: durationStr,
            transcription: desktopVoiceLiveTranscript
          };

          const btn = document.getElementById('desk-voice-dock-btn');
          if (btn) btn.classList.remove('recording');
          const lbl = document.getElementById('desk-voice-dock-label');
          if (lbl) lbl.innerText = 'Re-record Voice';

          const tray = document.getElementById('desk-voice-dock-preview');
          if (tray) tray.style.display = 'flex';
          const durEl = document.getElementById('desk-dock-voice-duration');
          if (durEl) durEl.innerText = `Voice Mail (${durationStr})`;
          const audEl = document.getElementById('desk-dock-voice-audio');
          if (audEl) audEl.src = audioDataUrl;

          showToastNotification(`Voice mail recorded (${durationStr}) 🎙️`, 'info');
        } else if (context === 'desktop-compose') {
          desktopComposeVoiceMail = {
            dataUrl: audioDataUrl,
            duration: durationStr,
            transcription: desktopVoiceLiveTranscript
          };

          const btn = document.getElementById('desk-voice-compose-btn');
          if (btn) btn.classList.remove('recording');
          const lbl = document.getElementById('desk-voice-compose-label');
          if (lbl) lbl.innerText = 'Re-record Voice';

          const tray = document.getElementById('desk-voice-compose-preview');
          if (tray) tray.style.display = 'flex';
          const durEl = document.getElementById('desk-compose-voice-duration');
          if (durEl) durEl.innerText = `Voice Mail (${durationStr})`;
          const audEl = document.getElementById('desk-compose-voice-audio');
          if (audEl) audEl.src = audioDataUrl;

          showToastNotification(`Voice mail recorded (${durationStr}) 🎙️`, 'info');
        }
        resolve();
      };
      reader.readAsDataURL(audioBlob);
    };
    desktopVoiceMediaRecorder.stop();
  });
}

function removeDesktopDockVoiceMail() {
  desktopDockVoiceMail = null;
  const tray = document.getElementById('desk-voice-dock-preview');
  if (tray) tray.style.display = 'none';
  const audEl = document.getElementById('desk-dock-voice-audio');
  if (audEl) audEl.src = '';
  const lbl = document.getElementById('desk-voice-dock-label');
  if (lbl) lbl.innerText = 'Voice Mail';
}

function removeDesktopComposeVoiceMail() {
  desktopComposeVoiceMail = null;
  const tray = document.getElementById('desk-voice-compose-preview');
  if (tray) tray.style.display = 'none';
  const audEl = document.getElementById('desk-compose-voice-audio');
  if (audEl) audEl.src = '';
  const lbl = document.getElementById('desk-voice-compose-label');
  if (lbl) lbl.innerText = 'Voice Mail';
}

// ==================== DESKTOP AUDIO BUBBLE PLAYBACK ====================
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

