// ==================== STATE MANAGEMENT ====================
let currentUser = null;

let currentFolder = 'INBOX';
let allEmails = [];
let activeEmail = null;
let selectedEmailIndex = -1;
let socket = null;
let currentReplyToId = null;
let currentReplyConvId = null;
let cachedContacts = [];

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

// ==================== STRING UTILITIES ====================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return 'P';
  const clean = nameOrEmail.replace(/[@<>\"]/g, '').trim();
  return clean.charAt(0).toUpperCase() || 'P';
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

// ==================== AUTH / LIVE OTP LOGIN FLOW ====================
let desktopAuthStep = 'PHONE'; // 'PHONE' | 'OTP'
let desktopPendingPhone = '';

const authForm = document.getElementById('desktop-login-form');
if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (desktopAuthStep === 'PHONE') {
      await sendDesktopOTP();
    } else {
      const otp = document.getElementById('desktop-otp-input').value.trim();
      await verifyDesktopOTP(otp);
    }
  });

  // Auto-submit OTP when 6 digits are typed
  const otpInput = document.getElementById('desktop-otp-input');
  if (otpInput) {
    otpInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length === 6) {
        verifyDesktopOTP(val);
      }
    });
  }
}

async function sendDesktopOTP() {
  const phone = document.getElementById('desktop-phone-input').value.trim();
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit Indian phone number.');
    document.getElementById('desktop-phone-input').focus();
    return;
  }

  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  desktopPendingPhone = cleanPhone;

  const btnLabel = document.getElementById('btn-desktop-label');
  const btn = document.getElementById('btn-desktop-submit');
  btnLabel.innerText = 'Dispatching Live SMS... ⏳';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      desktopAuthStep = 'OTP';
      document.getElementById('desktop-phone-input').disabled = true;
      document.getElementById('desktop-change-number').style.display = 'inline';
      document.getElementById('desktop-otp-group').style.display = 'block';

      const statusBox = document.getElementById('desktop-otp-status');
      statusBox.innerHTML = `
        <div style="background: var(--green-subtle); border: 1px solid var(--green-border); padding: 8px 12px; border-radius: 8px; color: var(--green-main);">
          <div>✓ Live SMS dispatched to <strong>+91 ${cleanPhone}</strong></div>
          ${data.liveOtp ? `
            <div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">
              Live Code: <strong style="font-family: monospace; font-size: 13px; color: var(--saffron-dark); cursor: pointer; text-decoration: underline;" onclick="document.getElementById('desktop-otp-input').value='${data.liveOtp}'; verifyDesktopOTP('${data.liveOtp}')">${data.liveOtp} (click to autofill)</strong>
            </div>
          ` : ''}
        </div>
      `;

      btnLabel.innerText = 'Verify & Enter Inbox';
      btn.disabled = false;
      setTimeout(() => document.getElementById('desktop-otp-input').focus(), 50);
    } else {
      alert(data.error || 'Failed to dispatch verification code');
      btnLabel.innerText = 'Get Live OTP via SMS';
      btn.disabled = false;
    }
  } catch (err) {
    alert('Connection error: ' + err.message);
    btnLabel.innerText = 'Get Live OTP via SMS';
    btn.disabled = false;
  }
}

async function verifyDesktopOTP(otp) {
  if (!otp || otp.length < 6) {
    alert('Please enter the 6-digit OTP sent to your phone.');
    return;
  }

  const btnLabel = document.getElementById('btn-desktop-label');
  const btn = document.getElementById('btn-desktop-submit');
  btnLabel.innerText = 'Verifying Passcode... ⏳';
  btn.disabled = true;

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
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };

      sessionStorage.setItem('phonemail-user', JSON.stringify(currentUser));

      document.getElementById('desktop-auth-container').style.display = 'none';
      document.getElementById('desktop-main-container').style.display = 'flex';
      playNotificationChime();
      initDesktopApp();
      showToastNotification(`Welcome back, ${currentUser.name}! 🇮🇳`);
    } else {
      alert(data.error || 'Verification failed. Please check your OTP.');
      btnLabel.innerText = 'Verify & Enter Inbox';
      btn.disabled = false;
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
    btnLabel.innerText = 'Verify & Enter Inbox';
    btn.disabled = false;
  }
}

function resetDesktopPhoneStep() {
  desktopAuthStep = 'PHONE';
  document.getElementById('desktop-phone-input').disabled = false;
  document.getElementById('desktop-change-number').style.display = 'none';
  document.getElementById('desktop-otp-group').style.display = 'none';
  document.getElementById('desktop-otp-input').value = '';
  document.getElementById('btn-desktop-label').innerText = 'Get Live OTP via SMS';
  document.getElementById('desktop-phone-input').focus();
}

function resendDesktopOTP() {
  sendDesktopOTP();
}

// ==================== WORKSPACE INITIALIZATION ====================
function initDesktopApp() {
  document.getElementById('user-avatar-badge').innerText = getInitials(currentUser.name);
  document.getElementById('settings-phone').innerText = currentUser.phone;
  document.getElementById('settings-email').innerText = currentUser.email;

  const topPhoneChip = document.getElementById('top-phone-chip');
  if (topPhoneChip) {
    topPhoneChip.innerText = `📞 +91 ${currentUser.phone}`;
  }

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
  } catch (err) {
    console.warn('Socket real-time connection warning:', err);
  }

  // Setup Keyboard Shortcuts & Autocomplete
  setupKeyboardShortcuts();
  setupContactsAutocomplete();

  // Load Data
  loadEmails();
  loadDesktopAliases();
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
async function loadEmails(folder = currentFolder) {
  currentFolder = folder;
  try {
    const res = await fetch(`/api/emails?folder=${folder}&phone=${currentUser.phone}`);
    const data = await res.json();
    allEmails = data.emails || [];
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

function renderEmailList(emails) {
  const container = document.getElementById('email-items-container');
  if (!container) return;
  container.innerHTML = '';

  if (emails.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 80px 20px;">
        <div style="font-size: 40px; margin-bottom: 12px;">📭</div>
        <h3 style="font-size: 15px; color: var(--text-main); margin-bottom: 4px;">Inbox Zero</h3>
        <p style="font-size: 13px;">No messages found in ${getFolderFriendlyName(currentFolder)}.</p>
      </div>
    `;
    return;
  }

  emails.forEach((email, index) => {
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

    const avatarInitial = getInitials(email.sender_email);
    const cleanSender = email.sender_email.replace(/@phonemail\.com$/i, ' (PhoneMail)');
    const cleanBodySnippet = (email.body_text || '').replace(/\s+/g, ' ').trim().substring(0, 95);

    row.innerHTML = `
      <label class="custom-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-checkbox">
        <span class="checkmark"></span>
      </label>
      <span class="item-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        ${isStarred ? '★' : '☆'}
      </span>
      <div class="item-avatar-circle">${avatarInitial}</div>
      <div class="item-sender-col" title="${escapeHtml(email.sender_email)}">${escapeHtml(cleanSender)}</div>
      <div class="item-content-preview">
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

  document.getElementById('full-subject').innerText = email.subject || '(No Subject)';
  document.getElementById('full-sender').innerText = email.sender_email;
  document.getElementById('full-avatar').innerText = getInitials(email.sender_email);
  document.getElementById('full-to').innerText = currentUser.email;
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
function setupContactsAutocomplete() {
  const input = document.getElementById('desk-compose-to');
  const dropdown = document.getElementById('desk-contacts-dropdown');
  if (!input || !dropdown) return;

  async function fetchAndRender(query = '') {
    try {
      if (!currentUser) return;
      if (cachedContacts.length === 0) {
        const res = await fetch(`/api/contacts?phone=${currentUser.phone}`);
        const data = await res.json();
        cachedContacts = data.contacts || [];
      }
      
      const q = query.trim().toLowerCase();
      const matches = cachedContacts.filter(c => 
        !q || 
        (c.display_name && c.display_name.toLowerCase().includes(q)) ||
        (c.phone_number && c.phone_number.includes(q)) ||
        (c.email_address && c.email_address.toLowerCase().includes(q))
      );

      if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = `
        <div class="contacts-autocomplete-header">PhoneMail Network Users</div>
      `;
      matches.slice(0, 6).forEach(c => {
        const item = document.createElement('div');
        item.className = 'contact-autocomplete-item';
        item.innerHTML = `
          <div class="contact-item-avatar">${getInitials(c.display_name || c.phone_number)}</div>
          <div class="contact-item-info">
            <div class="contact-item-name">${escapeHtml(c.display_name || `User ${c.phone_number}`)}</div>
            <div class="contact-item-meta">
              <span>📞 +91 ${escapeHtml(c.phone_number)}</span>
              <span class="contact-item-badge">Instant</span>
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
    } catch (err) {
      console.warn('Failed to load contacts for autocomplete:', err);
    }
  }

  input.addEventListener('input', () => fetchAndRender(input.value));
  input.addEventListener('focus', () => fetchAndRender(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
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
    alert('Notice: This message has already been replied to. Each message can be replied to only once.');
    return;
  }
  openComposeModal();
  currentReplyToId = activeEmail.id;
  currentReplyConvId = activeEmail.conversation_id;
  document.getElementById('desk-compose-to').value = activeEmail.sender_email;
  document.getElementById('desk-compose-subject').value = activeEmail.subject.startsWith('Re:')
    ? activeEmail.subject
    : `Re: ${activeEmail.subject || ''}`;
  document.getElementById('desk-compose-body').focus();
}

async function sendDesktopEmail() {
  const to = document.getElementById('desk-compose-to').value.trim();
  const subject = document.getElementById('desk-compose-subject').value.trim();
  const body = document.getElementById('desk-compose-body').value.trim();

  if (!to || !body) {
    alert('Please enter recipients and message content.');
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
      showToastNotification('Email sent successfully!');
    } else {
      alert(data.error || 'Failed to send email');
    }
  } catch (err) {
    alert('Error: ' + err.message);
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
    alert('Please enter an alias tag (e.g. work, banking, 1)');
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
      showToastNotification(`Sub-number .${tag} created!`);
    } else {
      alert(data.error || 'Failed to add alias');
    }
  } catch (err) {
    alert(err.message);
  }
}

// ==================== RESPONSIVE SIDEBAR TOGGLE ====================
function toggleSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  sidebar.classList.toggle('open');
  if (backdrop) {
    backdrop.classList.toggle('active', sidebar.classList.contains('open'));
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

// ==================== TOAST NOTIFICATION ====================
function showToastNotification(msg) {
  let toast = document.getElementById('bright-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bright-toast';
    toast.className = 'bright-toast-pill';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// ==================== SESSION RESTORATION & LOGOUT ====================
function restoreSession() {
  const saved = sessionStorage.getItem('phonemail-user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      const auth = document.getElementById('desktop-auth-container');
      const main = document.getElementById('desktop-main-container');
      if (auth && main) {
        auth.style.display = 'none';
        main.style.display = 'flex';
        initDesktopApp();
      }
    } catch (e) {
      sessionStorage.removeItem('phonemail-user');
      currentUser = null;
    }
  }
}

function logoutDesktop() {
  sessionStorage.removeItem('phonemail-user');
  currentUser = null;
  const auth = document.getElementById('desktop-auth-container');
  const main = document.getElementById('desktop-main-container');
  if (auth && main) {
    main.style.display = 'none';
    auth.style.display = 'flex';
    document.getElementById('desktop-phone-input').value = '';
    document.getElementById('desktop-otp-input').value = '';
  }
  showToastNotification('Logged out successfully');
}

// Check session on startup
restoreSession();
