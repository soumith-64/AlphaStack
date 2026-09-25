// ==================== STATE MANAGEMENT ====================
let currentUser = null;

let currentFolder = 'INBOX';
let currentMailSourceFilter = 'all'; // 'all' | 'phonemail' | 'external'
let allEmails = [];
let activeEmail = null;
let selectedEmailIndex = -1;
let socket = null;
let currentReplyToId = null;
let currentReplyConvId = null;
let cachedContacts = [];
let cachedDeviceContacts = [];

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
function formatSenderDisplay(rawSender, includeAddress = false) {
  if (!rawSender) return 'Unknown';
  let str = String(rawSender).trim();

  let name = '';
  let email = str;
  const angleMatch = str.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  if (angleMatch) {
    name = (angleMatch[1] || '').trim().replace(/^["']+|["']+$/g, '');
    email = (angleMatch[2] || '').trim();
  } else {
    email = str.replace(/^[<"']+|[>"']+$/g, '').trim();
  }

  // Check for internal PhoneMail pattern (e.g. 9381564959@alphastack.wwisvnr.com or 9381564959.work@...)
  const phoneAliasMatch = email.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  const plainPhoneMatch = email.match(/^(\d{10})@/);
  const rawDigitMatch = /^\d{10}$/.test(email);

  if (phoneAliasMatch || plainPhoneMatch || rawDigitMatch) {
    const phone = phoneAliasMatch ? phoneAliasMatch[1] : (plainPhoneMatch ? plainPhoneMatch[1] : email);
    const tag = phoneAliasMatch && phoneAliasMatch[2] ? phoneAliasMatch[2] : '';
    const phoneFormatted = formatPhoneDisplay(phone, tag);

    // If name is "User 9381564959" or empty or matches digits, just show the clean phone number
    if (!name || /^User\s*\d+/i.test(name) || name.replace(/\D/g, '') === phone) {
      return phoneFormatted;
    }

    // Personalized user name
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${name} (${phoneFormatted})`;
  }

  // External email (Gmail, Rediff, etc.)
  if (name) {
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (includeAddress) {
      return `${name} <${email}>`;
    }
    return name;
  }

  return email;
}

function cleanRecipientAddress(addr) {
  if (!addr) return '';
  let str = String(addr).trim();
  const phoneAliasMatch = str.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  if (phoneAliasMatch) {
    return formatPhoneDisplay(phoneAliasMatch[1], phoneAliasMatch[2]);
  }
  const plainPhone = str.match(/^(\d{10})@/);
  if (plainPhone) {
    return formatPhoneDisplay(plainPhone[1]);
  }
  if (/^\d{10}$/.test(str)) {
    return formatPhoneDisplay(str);
  }
  return str;
}

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return 'P';
  const display = formatSenderDisplay(nameOrEmail);
  const clean = display.replace(/[^a-zA-Z0-9]/g, '').trim();
  return clean.charAt(0).toUpperCase() || 'P';
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
    'INBOX': 'Inbox',
    'STARRED': 'Starred Messages',
    'SENT': 'Sent Mail',
    'DRAFTS': 'Drafts',
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
    if (user.phone) localStorage.setItem('phonemail_saved_phone', user.phone);
  }
  sessionStorage.setItem('phonemail-user', str);
}

window.phoneEmailListener = async (userObj) => {
  if (!userObj || !userObj.user_json_url) return;
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
      showNotify.error(data.error || 'Failed to authenticate phone number with Phone.Email', 'Auth Failed');
    }
  } catch (err) {
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
  const peBtn = document.getElementById('btn_ph_login');

  if (btn) {
    btn.style.opacity = '0.75';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Connecting to Phone.Email secure gateway...';
  }

  // If the Phone.Email SDK button is already generated, click it
  if (peBtn) {
    peBtn.click();
    setTimeout(() => {
      if (btn) {
        btn.style.opacity = '1';
        const subCaption = btn.querySelector('.btn-sub-caption');
        if (subCaption) subCaption.innerText = 'Real-Time OTP via SMS & WhatsApp';
      }
    }, 2500);
    return;
  }

  // Fallback: If SDK button is still loading into DOM, open official secure popup directly
  const clientId = '13311688567845248231';
  const currentOrigin = window.location.origin;
  const w = 480, h = 640;
  const left = (window.screen.width - w) / 2;
  const top = (window.screen.height - h) / 2;
  window.open(
    `https://www.phone.email/sign-in?client_id=${clientId}&redirect_url=${encodeURIComponent(currentOrigin)}`,
    'pe_auth_popup',
    `toolbar=0,scrollbars=1,location=0,statusbar=0,menubar=0,resizable=1,width=${w},height=${h},top=${top},left=${left}`
  );

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
  if (avatarBadge) avatarBadge.innerText = getInitials(currentUser.name);
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

  // Initialize Real-Time Contact Sync
  const perm = localStorage.getItem('phonemail_contact_sync_permission');
  if (perm === 'granted') {
    startRealtimeContactSync();
  } else if (!perm) {
    setTimeout(checkOneTimeContactSyncPrompt, 1500);
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

// ==================== EMAIL DATA LOADING & RENDERING ====================
async function syncAndLoadEmails() {
  showToastNotification('Syncing with Hostinger mail server... 🔄');
  try {
    await fetch('/api/emails/sync', { method: 'POST' });
  } catch (e) {}
  await loadEmails();
}

async function loadEmails(folder = currentFolder) {
  currentFolder = folder;
  try {
    const res = await fetch(`/api/emails?folder=${folder}&phone=${currentUser.phone}`);
    const data = await res.json();
    allEmails = data.emails || [];

    // Calculate live counts for the two email classification tabs
    const countAll = allEmails.length;
    const countPhoneMail = allEmails.filter(e => isPhoneMailSender(e.sender_email)).length;
    const countExternal = allEmails.filter(e => !isPhoneMailSender(e.sender_email)).length;

    const elAll = document.getElementById('count-source-all');
    if (elAll) elAll.innerText = countAll;
    const elPM = document.getElementById('count-source-phonemail');
    if (elPM) elPM.innerText = countPhoneMail;
    const elExt = document.getElementById('count-source-external');
    if (elExt) elExt.innerText = countExternal;

    renderEmailList(allEmails);

    // Update unread count badge & indicator
    const unreadCount = allEmails.filter(e => e.is_read === 0).length;
    const badge = document.getElementById('inbox-count-badge');
    if (badge) {
      badge.innerText = unreadCount > 0 ? unreadCount : '';
      badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
    
    const indicator = document.getElementById('mail-page-indicator');
    if (indicator) {
      indicator.innerText = allEmails.length === 1 
        ? '1 message' 
        : `${allEmails.length} messages`;
    }
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

function setMailSourceFilter(filter) {
  currentMailSourceFilter = filter;
  ['all', 'phonemail', 'external'].forEach(f => {
    const btn = document.getElementById(`tab-source-${f}`);
    if (btn) {
      if (f === filter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderEmailList(allEmails);
}

function renderEmailList(emails) {
  const container = document.getElementById('email-items-container');
  if (!container) return;
  container.innerHTML = '';

  let listToRender = emails || [];
  if (currentMailSourceFilter === 'phonemail') {
    listToRender = listToRender.filter(e => isPhoneMailSender(e.sender_email));
  } else if (currentMailSourceFilter === 'external') {
    listToRender = listToRender.filter(e => !isPhoneMailSender(e.sender_email));
  }

  if (listToRender.length === 0) {
    let emptyMsg = `No messages found in ${getFolderFriendlyName(currentFolder)}.`;
    if (currentMailSourceFilter === 'phonemail') {
      emptyMsg = `No PhoneMail network messages in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (currentMailSourceFilter === 'external') {
      emptyMsg = `No external (Gmail, Rediff, etc.) messages in ${getFolderFriendlyName(currentFolder)}.`;
    }
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

  listToRender.forEach((email, index) => {
    const row = document.createElement('div');
    row.className = `email-card-item ${email.is_read === 0 ? 'unread' : ''}`;
    row.onclick = () => {
      selectedEmailIndex = index;
      openEmailDetails(email);
    };

    const isStarred = email.is_starred === 1;
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
      ? `<span class="badge-source-tag badge-phonemail-pill" title="Sent from PhoneMail user">⚡ PhoneMail</span>`
      : `<span class="badge-source-tag badge-external-pill" title="Sent from external mail service">🌐 External</span>`;

    // Strictly hide @alphastack.wwisvnr.com: formatSenderDisplay renders only the clean phone number
    const formattedSender = formatSenderDisplay(email.sender_email);
    const avatarInitial = getInitials((isSentFolder || isSentByMe) ? (recipientsDisplay || 'T') : formattedSender);
    const displaySender = (isSentFolder || isSentByMe) 
      ? `To: ${recipientsDisplay || 'Recipient'}` 
      : formattedSender;
    const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);

    row.innerHTML = `
      <label class="custom-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-checkbox">
        <span class="checkmark"></span>
      </label>
      <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </span>
      <div class="item-avatar-circle">${avatarInitial}</div>
      <div class="item-sender-col" title="${escapeHtml(isSentFolder ? (recipientsDisplay || 'Recipient') : formattedSender)}">
        ${escapeHtml(displaySender)}
      </div>
      <div class="item-content-preview">
        ${sourceBadgeHtml}
        <span class="item-subject-title">${escapeHtml(email.subject || '(No Subject)')}</span>
        <span class="item-body-snippet"> — ${escapeHtml(cleanBodySnippet)}</span>
      </div>
      <div class="item-date-col">${timeDisplay}</div>
    `;
    container.appendChild(row);
  });
}

function switchFolder(folder, element) {
  document.querySelectorAll('.folder-nav .nav-item').forEach(i => i.classList.remove('active'));
  if (element) element.classList.add('active');
  
  const titleEl = document.getElementById('current-folder-title');
  if (titleEl) {
    titleEl.innerText = getFolderFriendlyName(folder);
  }

  // Close mobile sidebar if open
  closeMobileSidebar();
  closeReadingPane();
  loadEmails(folder);
}

// ==================== READING PANE VIEW ====================
function openEmailDetails(email) {
  activeEmail = email;

  // Mark as read in UI & backend
  if (email.is_read === 0) {
    email.is_read = 1;
    fetch(`/api/emails/${email.id}/read`, { method: 'POST' }).catch(() => {});
  }

  document.getElementById('mail-list-pane').style.display = 'none';
  const readingPane = document.getElementById('reading-pane');
  readingPane.style.display = 'flex';

  const isSentByMe = Boolean(email.sender_email && currentUser && email.sender_email.includes(currentUser.phone));
  const recipientsDisplay = getRecipientsDisplay(email);
  const isFromPhoneMail = isPhoneMailSender(email.sender_email);
  
  // Format sender: strictly hide @alphastack.wwisvnr.com and @phonemail.com
  const formattedSenderClean = isFromPhoneMail 
    ? formatSenderDisplay(email.sender_email) 
    : formatSenderDisplay(email.sender_email, true);

  document.getElementById('full-subject').innerText = email.subject || '(No Subject)';
  document.getElementById('full-sender').innerText = isSentByMe 
    ? (currentUser.name ? `${currentUser.name} (+91 ${currentUser.phone})` : `+91 ${currentUser.phone}`) 
    : formattedSenderClean;

  const senderBadgeEl = document.getElementById('full-sender-badge');
  if (senderBadgeEl) {
    if (isFromPhoneMail) {
      senderBadgeEl.className = 'badge-source-tag badge-phonemail-pill';
      senderBadgeEl.innerHTML = '⚡ PhoneMail Network';
    } else {
      senderBadgeEl.className = 'badge-source-tag badge-external-pill';
      senderBadgeEl.innerHTML = '🌐 External Provider';
    }
  }

  document.getElementById('full-avatar').innerText = getInitials(isSentByMe ? (recipientsDisplay || email.sender_email) : formattedSenderClean);
  document.getElementById('full-to').innerText = isSentByMe 
    ? (recipientsDisplay || 'Recipient') 
    : (currentUser ? `${currentUser.name || 'me'} (+91 ${currentUser.phone})` : 'me');
  document.getElementById('full-date').innerText = new Date(email.created_at).toLocaleString([], { 
    dateStyle: 'medium', 
    timeStyle: 'short' 
  });

  const bodyEl = document.getElementById('full-body');
  if (email.body_html) {
    bodyEl.innerHTML = email.body_html;
  } else {
    bodyEl.innerHTML = escapeHtml(email.body_text || '').replace(/\n/g, '<br>');
  }

  const starBtn = document.getElementById('pane-star-btn');
  if (starBtn) {
    const isStarred = email.is_starred === 1;
    starBtn.innerText = isStarred ? '★' : '☆';
    starBtn.style.color = isStarred ? 'var(--accent-amber)' : 'var(--text-dim)';
  }
}

function closeReadingPane() {
  const readingPane = document.getElementById('reading-pane');
  if (readingPane) readingPane.style.display = 'none';
  
  const mailList = document.getElementById('mail-list-pane');
  if (mailList) mailList.style.display = 'flex';
  
  activeEmail = null;
  loadEmails(); // Refresh unread count
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
  try {
    await fetch(`/api/emails/${activeEmail.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'TRASH' })
    });
    closeReadingPane();
    loadEmails();
    showToastNotification('Email moved to Trash');
  } catch (err) {
    console.error(err);
  }
}

// ==================== SEARCH & FILTER ====================
function filterEmails(query) {
  const term = query.toLowerCase().trim();
  if (!term) {
    renderEmailList(allEmails);
    return;
  }
  const filtered = allEmails.filter(e =>
    (e.sender_email && e.sender_email.toLowerCase().includes(term)) ||
    (e.subject && e.subject.toLowerCase().includes(term)) ||
    (e.body_text && e.body_text.toLowerCase().includes(term))
  );
  renderEmailList(filtered);
}

function toggleSelectAll(masterCheckbox) {
  const isChecked = masterCheckbox.checked;
  const checkboxes = document.querySelectorAll('.row-checkbox');
  checkboxes.forEach(cb => { cb.checked = isChecked; });
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

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchAndRender(input.value), 250);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      fetchAndRender('');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 250);
  });
}

function openComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (!modal) return;
  currentReplyToId = null;
  currentReplyConvId = null;
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = '';
  document.getElementById('desk-compose-body').value = '';
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  modal.style.display = 'block';
  setTimeout(() => document.getElementById('desk-compose-to').focus(), 50);
}

function closeComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (modal) modal.style.display = 'none';
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (dropdown) dropdown.style.display = 'none';
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

  if (!to || !body) {
    showNotify.warning('Please enter recipient and message content.', 'Compose Incomplete');
    return;
  }

  const recipients = to.split(',').map(r => r.trim()).filter(Boolean);

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderPhone: currentUser.phone,
        toRecipients: recipients,
        subject,
        bodyText: body,
        replyToId: currentReplyToId,
        conversationId: currentReplyConvId
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeComposeModal();
      loadEmails();
      showNotify.success('Email sent successfully!', 'Message Sent');
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
  const saved = localStorage.getItem('phonemail-user') || sessionStorage.getItem('phonemail-user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      const auth = document.getElementById('desktop-auth-container');
      const main = document.getElementById('desktop-main-container');
      if (auth && main) {
        auth.style.display = 'none';
        main.style.display = 'flex';
        initDesktopApp();

        // Cross-device profile sync: fetch latest profile & aliases from database
        if (currentUser && currentUser.phone) {
          fetch(`/api/auth/me?phone=${encodeURIComponent(currentUser.phone)}`)
            .then(r => r.json())
            .then(data => {
              if (data && data.user) {
                currentUser.name = data.user.display_name || currentUser.name;
                currentUser.email = data.user.email_address || currentUser.email;
                localStorage.setItem('phonemail-user', JSON.stringify(currentUser));
                sessionStorage.setItem('phonemail-user', JSON.stringify(currentUser));
                updateProfileDisplay();
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      localStorage.removeItem('phonemail-user');
      sessionStorage.removeItem('phonemail-user');
      currentUser = null;
    }
  }
}

function logoutDesktop() {
  localStorage.removeItem('phonemail-user');
  sessionStorage.removeItem('phonemail-user');
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

// Check session on startup
restoreSession();

