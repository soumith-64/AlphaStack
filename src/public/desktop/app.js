// ==================== STATE MANAGEMENT ====================
let currentUser = null;

let currentFolder = 'INBOX';
let allEmails = [];
let activeEmail = null;
let selectedEmailIndex = -1;
let socket = null;

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

// ==================== AUTH / LOGIN ====================
const authForm = document.getElementById('desktop-login-form');
if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('desktop-phone-input').value.trim();
    const otp = document.getElementById('desktop-otp-input').value.trim();

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
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
        initDesktopApp();
      } else {
        alert(data.error || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      alert('Connection error: ' + err.message);
    }
  });
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

  // Socket.io Push
  try {
    socket = io();
    socket.emit('join:user', currentUser.phone);

    socket.on('email:new', (data) => {
      console.log('⚡ [SOCKET] Inbound email received:', data);
      loadEmails();
      showToastNotification(`New email from ${data.sender_email || 'contact'}`);
    });

    socket.on('email:sent', () => {
      loadEmails();
    });
  } catch (err) {
    console.warn('Socket real-time connection warning:', err);
  }

  // Setup Keyboard Shortcuts
  setupKeyboardShortcuts();

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

// ==================== COMPOSE MODAL ====================
function openComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (!modal) return;
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = '';
  document.getElementById('desk-compose-body').value = '';
  modal.style.display = 'block';
  setTimeout(() => document.getElementById('desk-compose-to').focus(), 50);
}

function closeComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (modal) modal.style.display = 'none';
}

function startQuickReply() {
  if (!activeEmail) return;
  openComposeModal();
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
        bodyText: body
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
