// ==================== STATE MANAGEMENT ====================
let currentUser = {
  phone: '9876543210',
  name: 'Soumith V',
  email: '9876543210@phonemail.com'
};

let currentFolder = 'INBOX';
let allEmails = [];
let activeEmail = null;
let selectedEmailIndex = -1;
let socket = null;

// ==================== UTILITIES ====================
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

// ==================== MAIN WORKSPACE INITIALIZATION ====================
function initDesktopApp() {
  document.getElementById('user-avatar-badge').innerText = getInitials(currentUser.name);
  document.getElementById('settings-phone').innerText = currentUser.phone;
  document.getElementById('settings-email').innerText = currentUser.email;

  // Initialize Socket.io Real-time Push
  try {
    socket = io();
    socket.emit('join:user', currentUser.phone);

    socket.on('email:new', (data) => {
      console.log('⚡ [SOCKET] New inbound email received:', data);
      loadEmails();
      showToastNotification(`New email from ${data.sender_email || 'contact'}`);
    });

    socket.on('email:sent', () => {
      loadEmails();
    });
  } catch (err) {
    console.warn('Socket real-time connection warning:', err);
  }

  // Bind Keyboard Shortcuts (Cmd+K, C, J/K, Esc)
  setupKeyboardShortcuts();

  // Load emails & aliases
  loadEmails();
  loadDesktopAliases();
}

// ==================== KEYBOARD ACCELERATORS (SUPERHUMAN STYLE) ====================
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

    // Cmd+K or Ctrl+K -> Focus Global Search
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

    // Keys active only when NOT typing in an input
    if (!isTyping) {
      // 'c' or 'C' -> Open New Compose
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        openComposeModal();
        return;
      }

      // 'j' -> Next Email
      if (e.key.toLowerCase() === 'j') {
        navigateEmailList(1);
        return;
      }

      // 'k' -> Previous Email
      if (e.key.toLowerCase() === 'k') {
        navigateEmailList(-1);
        return;
      }

      // 'Enter' -> Open current selected email
      if (e.key === 'Enter' && selectedEmailIndex >= 0 && allEmails[selectedEmailIndex]) {
        openEmailDetails(allEmails[selectedEmailIndex]);
        return;
      }

      // 's' -> Star current
      if (e.key.toLowerCase() === 's' && activeEmail) {
        toggleCurrentStar();
        return;
      }

      // '#' or 'Delete' -> Delete current
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
  
  const rows = document.querySelectorAll('.email-card-row');
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
        <div style="font-size: 48px; margin-bottom: 14px; filter: drop-shadow(0 0 16px rgba(99,102,241,0.3));">✨</div>
        <h3 style="font-size: 16px; color: #f1f5f9; margin-bottom: 6px;">All Clear</h3>
        <p style="font-size: 13px;">No messages found in ${getFolderFriendlyName(currentFolder)}.</p>
      </div>
    `;
    return;
  }

  emails.forEach((email, index) => {
    const row = document.createElement('div');
    row.className = `email-card-row ${email.is_read === 0 ? 'unread' : ''}`;
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
      <span class="star-icon ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)" title="${isStarred ? 'Unstar' : 'Star'}">
        ${isStarred ? '★' : '☆'}
      </span>
      <div class="row-avatar">${avatarInitial}</div>
      <div class="row-sender-text" title="${escapeHtml(email.sender_email)}">${escapeHtml(cleanSender)}</div>
      <div class="row-preview-text">
        <strong>${escapeHtml(email.subject || '(No Subject)')}</strong>
        <span class="row-preview-snippet"> — ${escapeHtml(cleanBodySnippet)}</span>
      </div>
      <div class="row-date-badge">${timeDisplay}</div>
    `;
    container.appendChild(row);
  });
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

function switchFolder(folder, element) {
  document.querySelectorAll('.sidebar-glass .menu-item').forEach(i => i.classList.remove('active'));
  if (element) element.classList.add('active');
  
  const titleEl = document.getElementById('current-folder-title');
  if (titleEl) {
    titleEl.innerText = getFolderFriendlyName(folder);
  }

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
    starBtn.style.color = isStarred ? '#facc15' : 'var(--text-dim)';
  }
}

function closeReadingPane() {
  const readingPane = document.getElementById('reading-pane');
  if (readingPane) readingPane.style.display = 'none';
  
  const mailList = document.getElementById('mail-list-pane');
  if (mailList) mailList.style.display = 'flex';
  
  activeEmail = null;
  loadEmails(); // Refresh unread badges and state
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
          starBtn.style.color = data.is_starred === 1 ? '#facc15' : 'var(--text-dim)';
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

// ==================== COMPOSE DOCK ====================
function openComposeModal() {
  const modal = document.getElementById('desktop-compose-modal');
  if (!modal) return;
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = '';
  document.getElementById('desk-compose-body').value = '';
  modal.style.display = 'flex';
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
          item.className = 'alias-item-lux';
          item.innerHTML = `
            <div class="alias-name">🏷️ ${escapeHtml(a.alias_email)}</div>
            <div class="alias-label">${escapeHtml(a.label || 'Sub-number')}</div>
          `;
          list.appendChild(item);
        }

        // Render in Left Sidebar
        if (sidebarChips) {
          const chip = document.createElement('div');
          chip.className = 'alias-tag-pill';
          chip.onclick = () => openDesktopSettings();
          chip.innerHTML = `
            <span>🏷️ .${escapeHtml(a.alias_tag)}</span>
            <span class="tag-status">Active</span>
          `;
          sidebarChips.appendChild(chip);
        }
      });
    } else {
      if (list) list.innerHTML = '<p style="font-size: 13px; color: var(--text-dim);">No aliases configured yet.</p>';
      if (sidebarChips) {
        sidebarChips.innerHTML = `
          <div class="alias-tag-pill" onclick="openDesktopSettings()" style="opacity: 0.6;">
            <span>+ Add Alias</span>
          </div>
        `;
      }
    }
  } catch (err) {
    if (list) list.innerHTML = '<div style="color:#ef4444; font-size:12px;">Failed to load aliases</div>';
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
      showToastNotification(`Alias .${tag} created!`);
    } else {
      alert(data.error || 'Failed to add alias');
    }
  } catch (err) {
    alert(err.message);
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
}

// ==================== TOAST NOTIFICATION ====================
function showToastNotification(msg) {
  let toast = document.getElementById('lux-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lux-toast';
    toast.className = 'lux-toast-pill';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3200);
}
