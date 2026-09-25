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
let searchTerm = '';
let cachedContacts = [];

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
  if (!name) return 'U';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
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

function formatSenderDisplay(rawSender, includeAddress = false) {
  if (!rawSender) return 'Unknown';
  let str = String(rawSender).trim();
  let name = '';
  let email = str;
  const match = str.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>$/);
  if (match) {
    name = (match[1] || '').trim().replace(/^["']+|["']+$/g, '');
    email = (match[2] || '').trim();
  } else {
    email = str.replace(/^[<"']+|[>"']+$/g, '').trim();
  }

  const phoneAliasMatch = email.match(/^(\d{10})(?:\.([a-zA-Z0-9_-]+))?@(alphastack\.wwisvnr\.com|phonemail\.com)/i);
  const plainPhoneMatch = email.match(/^(\d{10})@/);
  const rawDigitMatch = /^\d{10}$/.test(email);

  if (phoneAliasMatch || plainPhoneMatch || rawDigitMatch) {
    const phone = phoneAliasMatch ? phoneAliasMatch[1] : (plainPhoneMatch ? plainPhoneMatch[1] : email);
    const tag = phoneAliasMatch && phoneAliasMatch[2] ? phoneAliasMatch[2] : '';
    const phoneFormatted = formatPhoneDisplay(phone, tag);

    if (!name || /^User\s*\d+/i.test(name) || name.replace(/\D/g, '') === phone) {
      return phoneFormatted;
    }
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${name} (${phoneFormatted})`;
  }

  if (name) {
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (includeAddress) return `${name} <${email}>`;
    return name;
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
                localStorage.getItem('phonemail-user') ||
                sessionStorage.getItem('phonemail-mobile-user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && user.phone) {
        currentUser = user;
        initAppView();
        return;
      }
    } catch (e) {}
  }
  // Show Onboarding
  document.getElementById('onboarding-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  goToScreen('screen-phone');
}

function saveMobileSession(user) {
  currentUser = user;
  const remEl = document.getElementById('mob-remember-me');
  const remember = remEl ? remEl.checked : true;
  const str = JSON.stringify(user);
  if (remember) {
    localStorage.setItem('phonemail-mobile-user', str);
    localStorage.setItem('phonemail-user', str);
    if (user.phone) localStorage.setItem('phonemail_saved_phone', user.phone);
  }
  sessionStorage.setItem('phonemail-mobile-user', str);
}

function initAppView() {
  document.getElementById('onboarding-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  // Update User Header Info
  const initials = getInitials(currentUser.name || 'User');
  const avatarEl = document.getElementById('mob-user-avatar');
  if (avatarEl) avatarEl.innerText = initials;

  const drawerAvatar = document.getElementById('mob-drawer-avatar');
  if (drawerAvatar) drawerAvatar.innerText = initials;

  const drawerName = document.getElementById('drawer-username');
  if (drawerName) drawerName.innerText = currentUser.name || 'INAI Member';

  const drawerEmail = document.getElementById('drawer-email');
  if (drawerEmail) drawerEmail.innerText = formatPhoneDisplay(currentUser.phone);

  // Setup Socket.IO for real-time notifications
  setupSocket();

  // Apply Language
  applyInaiLanguage();

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
  localStorage.removeItem('phonemail-user');
  sessionStorage.removeItem('phonemail-mobile-user');
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
      body: JSON.stringify({ action, emailIds, folder: currentFolder })
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
      body: JSON.stringify({ action, emailIds: [id], folder: currentFolder })
    });
    allEmails = allEmails.filter(e => e.id !== id);
    if (emailFolderCache[currentFolder]) {
      emailFolderCache[currentFolder] = [...allEmails];
    }
    renderEmailList(allEmails);
    showToastNotification(`Message ${action === 'archive' ? 'archived' : 'moved to trash'} ✓`, 'success');
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

// ==================== EMAIL LIST RENDERING (GROUPED & SWIPEABLE) ====================
function renderEmailList(emails) {
  const container = document.getElementById('conversations-list');
  if (!container) return;
  container.innerHTML = '';

  let listToRender = emails || [];

  // Filter 1: Source classification tab
  if (activeSourceFilter === 'phonemail') {
    listToRender = listToRender.filter(e => isPhoneMailSender(e.sender_email));
  } else if (activeSourceFilter === 'external') {
    listToRender = listToRender.filter(e => !isPhoneMailSender(e.sender_email));
  }

  // Filter 2: Search term
  if (searchTerm) {
    listToRender = listToRender.filter(e => {
      const txt = `${e.sender_email || ''} ${e.subject || ''} ${e.body_text || ''}`.toLowerCase();
      return txt.includes(searchTerm);
    });
  }

  if (listToRender.length === 0) {
    let emptyMsg = `No messages found in ${getFolderFriendlyName(currentFolder)}.`;
    if (activeSourceFilter === 'phonemail') {
      emptyMsg = `No INAI network messages in ${getFolderFriendlyName(currentFolder)}.`;
    } else if (activeSourceFilter === 'external') {
      emptyMsg = `No external (Gmail, Rediff, etc.) messages in ${getFolderFriendlyName(currentFolder)}.`;
    }
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 60px 20px;">
        <div style="margin-bottom: 12px;">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        </div>
        <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">No Messages</h3>
        <p style="font-size: 12.5px;">${emptyMsg}</p>
      </div>
    `;
    return;
  }

  // Date Categorization (Today, Yesterday, This Week, Older)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;

  const groups = [
    { key: 'today', title: 'Today', items: [] },
    { key: 'yesterday', title: 'Yesterday', items: [] },
    { key: 'this_week', title: 'This Week', items: [] },
    { key: 'older', title: 'Older', items: [] }
  ];

  listToRender.forEach(email => {
    const t = new Date(email.created_at).getTime();
    if (t >= todayStart) groups[0].items.push(email);
    else if (t >= yesterdayStart) groups[1].items.push(email);
    else if (t >= weekStart) groups[2].items.push(email);
    else groups[3].items.push(email);
  });

  groups.forEach(grp => {
    if (grp.items.length === 0) return;

    // Group Header
    const grpHeader = document.createElement('div');
    grpHeader.className = 'email-group-header';
    grpHeader.innerHTML = `
      <span class="email-group-title">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>${grp.title}</span>
      </span>
      <span class="email-group-count">${grp.items.length}</span>
    `;
    container.appendChild(grpHeader);

    grp.items.forEach(email => {
      const card = createMobileEmailCard(email);
      container.appendChild(card);
    });
  });

  updateBulkToolbar();
}

function createMobileEmailCard(email) {
  const card = document.createElement('div');
  const isSelected = selectedEmailIds.has(email.id);
  const isStarred = email.is_starred === 1;
  const isImportant = email.is_important === 1;

  card.id = `mob-row-${email.id}`;
  card.dataset.id = email.id;
  card.className = `email-card-item ${email.is_read === 0 ? 'unread' : ''} ${isSelected ? 'selected' : ''} ${isImportant ? 'is-important' : ''}`;
  card.onclick = () => openEmailDetails(email);

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
    ? `<span class="badge-source-tag badge-phonemail-pill">⚡ INAI</span>`
    : `<span class="badge-source-tag badge-external-pill">🌐 External</span>`;

  const formattedSender = formatSenderDisplay(email.sender_email);
  const avatarInitial = getInitials((isSentFolder || isSentByMe) ? (recipientsDisplay || 'T') : formattedSender);
  const displaySender = (isSentFolder || isSentByMe) 
    ? `To: ${recipientsDisplay || 'Recipient'}` 
    : formattedSender;
  const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 80);

  card.innerHTML = `
    <!-- Touch Swipe Left Actions (Archive & Delete) -->
    <div class="swipe-actions-container">
      <div class="swipe-left-reveal" style="display: none;">
        <button class="swipe-btn archive" onclick="executeBulkActionOnSingle('${email.id}', 'archive'); event.stopPropagation();">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          <span>Archive</span>
        </button>
        <button class="swipe-btn delete" onclick="executeBulkActionOnSingle('${email.id}', 'delete'); event.stopPropagation();">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>
      </div>
      <div class="swipe-right-reveal" style="display: none;">
        <button class="swipe-btn important" onclick="toggleImportant('${email.id}', event); event.stopPropagation();">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>Flag</span>
        </button>
        <button class="swipe-btn star" onclick="toggleStar('${email.id}', event); event.stopPropagation();">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>Star</span>
        </button>
      </div>
    </div>

    <!-- Row Controls: Checkbox, Flag, Star -->
    <div class="email-checkbox-wrap" onclick="toggleEmailSelection('${email.id}', event)">
      <label class="custom-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-checkbox" id="mob-check-${email.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmailSelection('${email.id}', event)">
        <span class="checkmark"></span>
      </label>
    </div>

    <span class="item-important-icon ${isImportant ? 'important' : ''}" onclick="toggleImportant('${email.id}', event)">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="${isImportant ? '#eab308' : 'none'}" stroke="${isImportant ? '#eab308' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </span>

    <div class="item-avatar-circle">${avatarInitial}</div>

    <div class="item-content-preview">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
          ${escapeHtml(displaySender)}
        </span>
        <span class="item-date-col">${timeDisplay}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
        ${sourceBadgeHtml}
        ${isImportant ? '<span style="font-size: 9px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 1px 5px; border-radius: 3px;">PRIORITY</span>' : ''}
      </div>
      <div class="item-subject-title">${escapeHtml(email.subject || '(No Subject)')}</div>
      <div class="item-body-snippet">${escapeHtml(cleanBodySnippet)}</div>
    </div>
  `;

  // Attach Touch Swipe Gesture Handlers
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;

  card.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isSwiping = false;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    const diffX = e.touches[0].clientX - touchStartX;
    const diffY = e.touches[0].clientY - touchStartY;
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 20) {
      isSwiping = true;
      const leftReveal = card.querySelector('.swipe-left-reveal');
      const rightReveal = card.querySelector('.swipe-right-reveal');
      if (diffX < -30 && leftReveal) {
        leftReveal.style.display = 'flex';
        if (rightReveal) rightReveal.style.display = 'none';
      } else if (diffX > 30 && rightReveal) {
        rightReveal.style.display = 'flex';
        if (leftReveal) leftReveal.style.display = 'none';
      }
    }
  }, { passive: true });

  card.addEventListener('touchend', (e) => {
    const diffX = e.changedTouches[0].clientX - touchStartX;
    if (isSwiping && Math.abs(diffX) > 80) {
      if (diffX < -80) {
        executeBulkActionOnSingle(email.id, 'archive');
      } else if (diffX > 80) {
        toggleImportant(email.id);
      }
    }
    const leftReveal = card.querySelector('.swipe-left-reveal');
    const rightReveal = card.querySelector('.swipe-right-reveal');
    if (leftReveal) leftReveal.style.display = 'none';
    if (rightReveal) rightReveal.style.display = 'none';
  }, { passive: true });

  return card;
}

// ==================== READING PANE VIEW ====================
function openEmailDetails(email) {
  activeEmail = email;
  isMessageTranslated = false;
  originalMessageSubject = email.subject || '(No Subject)';
  originalMessageBody = (email.body_html || email.body_text || '').replace(/\n/g, '<br>');

  // Mark as read locally and backend
  if (email.is_read === 0) {
    email.is_read = 1;
    fetch(`/api/emails/${email.id}/read`, { method: 'POST' }).catch(() => {});
    const row = document.getElementById(`mob-row-${email.id}`);
    if (row) row.classList.remove('unread');
  }

  const pane = document.getElementById('reading-pane');
  if (!pane) return;

  const senderFull = formatSenderDisplay(email.sender_email, true);
  const senderShort = formatSenderDisplay(email.sender_email);

  document.getElementById('mob-read-sender').innerText = senderShort;
  document.getElementById('mob-read-sender-full').innerText = senderFull;
  document.getElementById('mob-read-subject').innerText = originalMessageSubject;
  document.getElementById('mob-read-avatar').innerText = getInitials(senderShort);
  document.getElementById('mob-read-date').innerText = new Date(email.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  document.getElementById('mob-read-body').innerHTML = originalMessageBody;

  const isFromPhoneMail = isPhoneMailSender(email.sender_email);
  const statusEl = document.getElementById('mob-read-status');
  if (statusEl) {
    statusEl.innerText = isFromPhoneMail ? '⚡ INAI Verified' : '🌐 External Mail';
  }

  // Action button colors
  const impBtn = document.getElementById('mob-pane-important-btn');
  if (impBtn) {
    impBtn.style.color = email.is_important === 1 ? '#eab308' : 'var(--text-dim)';
  }
  const starBtn = document.getElementById('mob-pane-star-btn');
  if (starBtn) {
    starBtn.style.color = email.is_starred === 1 ? '#f59e0b' : 'var(--text-dim)';
  }

  pane.style.display = 'flex';
}

function closeReadingPane() {
  const pane = document.getElementById('reading-pane');
  if (pane) pane.style.display = 'none';
  activeEmail = null;
}

function toggleCurrentImportant() {
  if (!activeEmail) return;
  toggleImportant(activeEmail.id);
}

function toggleCurrentStar() {
  if (!activeEmail) return;
  toggleStar(activeEmail.id);
}

function deleteCurrentEmail() {
  if (!activeEmail) return;
  executeBulkActionOnSingle(activeEmail.id, 'delete');
  closeReadingPane();
}

function archiveCurrentEmail() {
  if (!activeEmail) return;
  executeBulkActionOnSingle(activeEmail.id, 'archive');
  closeReadingPane();
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

// ==================== DIGITAL ID CARD & DYNAMIC QR MODAL ====================
function openDigitalIdModal() {
  if (!currentUser) return;
  const modal = document.getElementById('digital-id-modal');
  if (!modal) return;

  const name = currentUser.name || 'INAI Member';
  const phone = formatPhoneDisplay(currentUser.phone);
  const email = `${currentUser.phone}@alphastack.wwisvnr.com`;

  const nameEl = document.getElementById('id-card-name');
  if (nameEl) nameEl.innerText = name;
  const phoneEl = document.getElementById('id-card-phone');
  if (phoneEl) phoneEl.innerText = phone;
  const emailEl = document.getElementById('id-card-email');
  if (emailEl) emailEl.innerText = email;

  const qrImg = document.getElementById('id-card-qr-img');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent('mailto:' + email)}&format=svg&color=046a38`;
  }

  modal.style.display = 'flex';
}

function closeDigitalIdModal(e) {
  const modal = document.getElementById('digital-id-modal');
  if (modal) modal.style.display = 'none';
}

function copyIdCardEmail() {
  if (!currentUser) return;
  const email = `${currentUser.phone}@alphastack.wwisvnr.com`;
  navigator.clipboard.writeText(email).then(() => {
    const btnText = document.getElementById('btn-copy-id-text');
    if (btnText) {
      btnText.innerText = 'Copied! ✓';
      setTimeout(() => { btnText.innerText = 'Copy Mail ID'; }, 2500);
    }
    showToastNotification(`Mail ID copied: ${email} 📋`, 'success');
  }).catch(() => {
    showToastNotification(`Email: ${email}`);
  });
}

function shareDigitalIdCard() {
  if (!currentUser) return;
  const email = `${currentUser.phone}@alphastack.wwisvnr.com`;
  if (navigator.share) {
    navigator.share({
      title: `INAI Digital Mail Identity — ${currentUser.name || 'User'}`,
      text: `Contact me on INAI via my phone email: ${email}`,
      url: window.location.origin
    }).catch(() => {});
  } else {
    copyIdCardEmail();
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
document.addEventListener('DOMContentLoaded', () => {
  restoreSession();
});
