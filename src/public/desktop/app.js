// ==================== STATE MANAGEMENT ====================
let currentUser = {
  phone: '9876543210',
  name: 'Soumith V',
  email: '9876543210@phonemail.com'
};

let currentFolder = 'INBOX';
let allEmails = [];
let activeEmail = null;
let socket = null;

// ==================== AUTH / LOGIN ====================
const authForm = document.getElementById('desktop-login-form');
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
      alert(data.error || 'Login failed');
    }
  } catch (err) {
    alert('Connection error: ' + err.message);
  }
});

// ==================== MAIN GMAIL WORKSPACE ====================
function initDesktopApp() {
  document.getElementById('user-avatar-badge').innerText = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('settings-phone').innerText = currentUser.phone;
  document.getElementById('settings-email').innerText = currentUser.email;

  // Initialize Socket.io
  try {
    socket = io();
    socket.emit('join:user', currentUser.phone);

    socket.on('email:new', (data) => {
      console.log('⚡ [SOCKET] New email arrived:', data);
      loadEmails();
    });

    socket.on('email:sent', () => {
      loadEmails();
    });
  } catch (err) {
    console.warn('Socket error:', err);
  }

  loadEmails();
}

async function loadEmails(folder = currentFolder) {
  currentFolder = folder;
  try {
    const res = await fetch(`/api/emails?folder=${folder}&phone=${currentUser.phone}`);
    const data = await res.json();
    allEmails = data.emails || [];
    renderEmailList(allEmails);

    // Update inbox badge
    const unreadCount = allEmails.filter(e => e.is_read === 0).length;
    document.getElementById('inbox-count-badge').innerText = unreadCount || '';
    document.getElementById('mail-page-indicator').innerText = `1-${allEmails.length} of ${allEmails.length}`;
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

function renderEmailList(emails) {
  const container = document.getElementById('email-items-container');
  container.innerHTML = '';

  if (emails.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #5f6368; padding: 60px 20px;">
        <div style="font-size: 40px; margin-bottom: 10px;">📭</div>
        <p>No messages in ${currentFolder}.</p>
      </div>
    `;
    return;
  }

  emails.forEach(email => {
    const row = document.createElement('div');
    row.className = `email-row ${email.is_read === 0 ? 'unread' : ''}`;
    row.onclick = () => openEmailDetails(email);

    const isStarred = email.is_starred === 1;
    const timeDisplay = new Date(email.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      <input type="checkbox" class="row-check" onclick="event.stopPropagation()">
      <span class="row-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${email.id}', event)">${isStarred ? '★' : '☆'}</span>
      <div class="row-sender">${email.sender_email}</div>
      <div class="row-subject-snippet">
        <strong>${email.subject || '(No Subject)'}</strong>
        <span class="row-snippet"> — ${(email.body_text || '').substring(0, 80)}...</span>
      </div>
      <div class="row-date">${timeDisplay}</div>
    `;
    container.appendChild(row);
  });
}

function switchFolder(folder, element) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  element.classList.add('active');
  closeReadingPane();
  loadEmails(folder);
}

function openEmailDetails(email) {
  activeEmail = email;
  document.getElementById('mail-list-pane').style.display = 'none';
  document.getElementById('reading-pane').style.display = 'flex';

  document.getElementById('full-subject').innerText = email.subject || '(No Subject)';
  document.getElementById('full-sender').innerText = email.sender_email;
  document.getElementById('full-avatar').innerText = email.sender_email.charAt(0).toUpperCase();
  document.getElementById('full-to').innerText = currentUser.email;
  document.getElementById('full-date').innerText = new Date(email.created_at).toLocaleString();
  document.getElementById('full-body').innerHTML = (email.body_html || email.body_text || '').replace(/\n/g, '<br>');

  const starBtn = document.getElementById('pane-star-btn');
  starBtn.innerText = email.is_starred === 1 ? '★' : '☆';
  starBtn.style.color = email.is_starred === 1 ? '#f4b400' : '#444746';
}

function closeReadingPane() {
  document.getElementById('reading-pane').style.display = 'none';
  document.getElementById('mail-list-pane').style.display = 'flex';
  activeEmail = null;
}

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
        starBtn.innerText = data.is_starred === 1 ? '★' : '☆';
        starBtn.style.color = data.is_starred === 1 ? '#f4b400' : '#444746';
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
  } catch (err) {
    console.error(err);
  }
}

function filterEmails(query) {
  const term = query.toLowerCase().trim();
  const filtered = allEmails.filter(e =>
    (e.sender_email && e.sender_email.toLowerCase().includes(term)) ||
    (e.subject && e.subject.toLowerCase().includes(term)) ||
    (e.body_text && e.body_text.toLowerCase().includes(term))
  );
  renderEmailList(filtered);
}

// ==================== COMPOSE MODAL ====================
function openComposeModal() {
  document.getElementById('desk-compose-to').value = '';
  document.getElementById('desk-compose-subject').value = '';
  document.getElementById('desk-compose-body').value = '';
  document.getElementById('desktop-compose-modal').style.display = 'flex';
}

function closeComposeModal() {
  document.getElementById('desktop-compose-modal').style.display = 'none';
}

function startQuickReply() {
  if (!activeEmail) return;
  openComposeModal();
  document.getElementById('desk-compose-to').value = activeEmail.sender_email;
  document.getElementById('desk-compose-subject').value = `Re: ${activeEmail.subject || ''}`;
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
  list.innerHTML = 'Loading aliases...';
  try {
    const res = await fetch(`/api/aliases?phone=${currentUser.phone}`);
    const data = await res.json();
    list.innerHTML = '';
    if (data.aliases && data.aliases.length > 0) {
      data.aliases.forEach(a => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.background = '#f1f3f4';
        item.style.borderRadius = '8px';
        item.style.marginBottom = '6px';
        item.style.fontSize = '13px';
        item.innerHTML = `<strong>${a.alias_email}</strong> <span style="color: #5f6368;">(${a.label || 'Alias'})</span>`;
        list.appendChild(item);
      });
    } else {
      list.innerHTML = '<p style="font-size: 13px; color: #5f6368;">No aliases configured yet.</p>';
    }
  } catch (err) {
    list.innerHTML = 'Failed to load aliases';
  }
}

async function addDesktopAlias() {
  const tag = document.getElementById('desk-new-tag').value.trim();
  const label = document.getElementById('desk-new-label').value.trim();
  if (!tag) {
    alert('Please enter an alias tag');
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
    } else {
      alert(data.error || 'Failed to add alias');
    }
  } catch (err) {
    alert(err.message);
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('gmail-sidebar');
  sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
}
