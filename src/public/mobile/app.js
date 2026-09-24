// ==================== STATE MANAGEMENT ====================
let currentUser = null;
let pendingPhone = '';

let activeConversation = null;
let currentMessages = [];
let replyingToId = null;
let activeFilter = 'all';
let socket = null;

// ==================== ONBOARDING FLOW ====================
function goToScreen(screenId) {
  document.querySelectorAll('.onboarding-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

async function requestOTP() {
  const phone = document.getElementById('mobile-phone-input').value.trim();
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit phone number');
    return;
  }
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  pendingPhone = cleanPhone;
  document.getElementById('verify-phone-label').innerText = `+91 ${cleanPhone}`;

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    const data = await res.json();
    goToScreen('screen-otp');
  } catch (err) {
    alert('Failed to request verification: ' + err.message);
  }
}

function autoFillOTP() {
  const digits = ['1', '2', '3', '4', '5', '6'];
  const inputs = document.querySelectorAll('.otp-digit');
  inputs.forEach((input, i) => { input.value = digits[i]; });
  verifyOTP('123456');
}

function onOtpDigit(input, index) {
  const inputs = document.querySelectorAll('.otp-digit');
  if (input.value && index < inputs.length - 1) {
    inputs[index + 1].focus();
  }

  // Check if all 6 filled
  let fullOtp = '';
  inputs.forEach(inp => { fullOtp += inp.value; });
  if (fullOtp.length === 6) {
    verifyOTP(fullOtp);
  }
}

async function verifyOTP(otp) {
  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: pendingPhone || (currentUser && currentUser.phone),
        otp,
        clientType: 'MOBILE_CLIENT'
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };

      sessionStorage.setItem('phonemail-mobile-user', JSON.stringify(currentUser));

      // Transition to Main App
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
    } else {
      alert(data.error || 'Verification failed');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  }
}

// ==================== NOTIFICATION CHIME & TOAST ====================
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
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
  } catch (e) {}
}

function showMobileToast(msg) {
  let toast = document.getElementById('mobile-toast-banner');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mobile-toast-banner';
    toast.className = 'mobile-toast-banner';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="toast-icon">✉️</span><div class="toast-text">${msg}</div>`;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3500);
}

// ==================== MAIN SPIKE MAIL CONVERSATIONAL APP ====================
function initMainApp() {
  // Update header labels
  document.getElementById('drawer-username').innerText = currentUser.name;
  document.getElementById('drawer-email').innerText = currentUser.email;
  document.getElementById('profile-name').innerText = currentUser.name;
  document.getElementById('profile-email').innerText = currentUser.email;

  // Initialize WebSockets
  try {
    socket = io();
    socket.emit('join:user', currentUser.phone);

    socket.on('email:incoming', (data) => {
      console.log('⚡ [SOCKET] Inbound personal message received:', data);
      playNotificationChime();
      const senderDisplay = data.from || (data.email && data.email.sender_email) || 'Network Contact';
      showMobileToast(`New message from ${senderDisplay}`);
      loadConversations();
      if (activeConversation && (activeConversation.id === data.conversationId || (activeConversation.participant_phone && activeConversation.participant_phone.includes(senderDisplay)))) {
        openConversation(activeConversation.id);
      }
    });

    socket.on('email:new', (data) => {
      console.log('⚡ New email received:', data);
      if (data && data.senderPhone && data.senderPhone !== currentUser.phone) {
        playNotificationChime();
        showMobileToast(`New email received`);
      }
      loadConversations();
      if (activeConversation && activeConversation.id === data.conversationId) {
        openConversation(activeConversation.id);
      }
    });

    socket.on('email:sent', (data) => {
      loadConversations();
      if (activeConversation && activeConversation.id === data.conversationId) {
        openConversation(activeConversation.id);
      }
    });
  } catch (e) {
    console.warn('Socket init notice:', e);
  }

  setupMobileContactsPicker();
  loadConversations();
}

async function loadConversations() {
  try {
    const res = await fetch(`/api/conversations?phone=${currentUser.phone}`);
    const data = await res.json();
    renderConversations(data.conversations || []);
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

function renderConversations(conversations) {
  const container = document.getElementById('conversations-list');
  container.innerHTML = '';

  let filtered = conversations;
  if (activeFilter === 'unread') {
    filtered = conversations.filter(c => c.unread_count > 0);
  } else if (activeFilter === 'starred') {
    filtered = conversations.filter(c => c.unread_count > 0 || c.is_group === 1);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #667781; padding: 40px 20px;">
        <div style="font-size: 36px; margin-bottom: 8px;">💬</div>
        <p>No conversations found.</p>
        <p style="font-size: 12px; margin-top: 4px;">Use search or compose to start an email chat.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.onclick = () => openConversation(conv.id);

    const initial = (conv.participant_phone || conv.subject || 'P').charAt(0).toUpperCase();
    const timeDisplay = conv.last_time ? new Date(conv.last_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const badgeHtml = conv.unread_count > 0 ? `<div class="chat-unread-badge">${conv.unread_count}</div>` : '';

    item.innerHTML = `
      <div class="chat-avatar">${conv.is_group === 1 ? '👥' : initial}</div>
      <div class="chat-details">
        <div class="chat-top-row">
          <div class="chat-sender-name">${conv.is_group === 1 ? '👥 ' + conv.subject : conv.participant_phone}</div>
          <div class="chat-timestamp">${timeDisplay}</div>
        </div>
        <div class="chat-bottom-row">
          <div class="chat-preview-text">${conv.last_message || conv.subject || 'No messages'}</div>
          ${badgeHtml}
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function setFilter(filterName, btn) {
  activeFilter = filterName;
  document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  loadConversations();
}

function onSearchInput(query) {
  const term = query.trim().toLowerCase();
  const items = document.querySelectorAll('.chat-item');
  items.forEach(item => {
    const text = item.innerText.toLowerCase();
    item.style.display = text.includes(term) ? 'flex' : 'none';
  });
}

// ==================== INSIDE CHAT / CONVERSATION VIEW ====================
async function openConversation(convId) {
  try {
    const phoneQuery = currentUser ? `?phone=${encodeURIComponent(currentUser.phone)}` : '';
    const res = await fetch(`/api/conversations/${convId}${phoneQuery}`);
    const data = await res.json();

    activeConversation = data.conversation;
    currentMessages = data.messages || [];

    document.getElementById('chat-contact-name').innerText = activeConversation.is_group === 1
      ? `👥 ${activeConversation.subject}`
      : activeConversation.participant_phone;

    document.getElementById('chat-subject-text').innerText = activeConversation.subject || '(No Subject)';
    
    // Show/hide subject bar contextually (hidden if multi-reply thread)
    const subjectBar = document.getElementById('chat-subject-bar');
    subjectBar.style.display = 'flex';

    renderMessages(currentMessages);
    document.getElementById('chat-view-container').classList.add('active');

    // Scroll to bottom
    const stream = document.getElementById('chat-messages-stream');
    stream.scrollTop = stream.scrollHeight;
  } catch (err) {
    console.error('Failed to open conversation:', err);
  }
}

function renderMessages(messages) {
  const stream = document.getElementById('chat-messages-stream');
  stream.innerHTML = '';

  messages.forEach(msg => {
    const bubble = document.createElement('div');
    const isOutbound = msg.sender_email.includes(currentUser.phone);
    bubble.className = `msg-bubble ${isOutbound ? 'outbound' : 'inbound'}`;

    // Double click / right swipe to quote
    bubble.onclick = () => selectMessageForQuote(msg);

    const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let quotedHtml = '';
    if (msg.reply_to_id) {
      const parent = messages.find(m => m.id === msg.reply_to_id);
      if (parent) {
        quotedHtml = `<div class="msg-quoted">↩️ ${parent.body_text.substring(0, 50)}...</div>`;
      }
    }

    // Long email expander
    const isLong = msg.body_text.length > 200;
    const displayText = isLong ? msg.body_text.substring(0, 200) + '...' : msg.body_text;
    const readMoreHtml = isLong ? `<div class="read-more-link" onclick="openFullEmailModal('${msg.id}'); event.stopPropagation();">Read full email ➔</div>` : '';

    bubble.innerHTML = `
      ${quotedHtml}
      <div>${displayText.replace(/\n/g, '<br>')}</div>
      ${readMoreHtml}
      <div class="msg-time">${timeStr} ${isOutbound ? '✓✓' : ''}</div>
    `;

    stream.appendChild(bubble);
  });
}

function closeChatView() {
  document.getElementById('chat-view-container').classList.remove('active');
  activeConversation = null;
  cancelQuote();
  loadConversations();
}

function selectMessageForQuote(msg) {
  // Check single-reply constraint
  if (msg.has_replied === 1) {
    alert('Notice: This message has already been replied to. Each message can be replied to only once.');
    return;
  }
  replyingToId = msg.id;
  const bar = document.getElementById('quote-preview-bar');
  const text = document.getElementById('quote-preview-text');
  text.innerText = `Replying to: "${msg.body_text.substring(0, 45)}..."`;
  bar.style.display = 'flex';
  document.getElementById('chat-message-input').focus();
}

function cancelQuote() {
  replyingToId = null;
  document.getElementById('quote-preview-bar').style.display = 'none';
}

async function sendChatMessage() {
  const input = document.getElementById('chat-message-input');
  const text = input.value.trim();
  if (!text || !activeConversation) return;

  try {
    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderPhone: currentUser.phone,
        toRecipients: [activeConversation.participant_phone],
        subject: activeConversation.subject,
        bodyText: text,
        replyToId: replyingToId,
        conversationId: activeConversation.id
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      input.value = '';
      cancelQuote();
      openConversation(activeConversation.id);
    } else {
      alert(data.error || 'Failed to send message');
    }
  } catch (err) {
    alert('Send error: ' + err.message);
  }
}

// ==================== TRADITIONAL COMPOSE & CONTACTS PICKER ====================
let mobileCachedContacts = [];

function setupMobileContactsPicker() {
  const input = document.getElementById('trad-to');
  const picker = document.getElementById('mobile-contacts-picker');
  if (!input || !picker) return;

  async function fetchAndRender(query = '') {
    if (input.disabled) return;
    try {
      if (!currentUser) return;
      if (mobileCachedContacts.length === 0) {
        const res = await fetch(`/api/contacts?phone=${currentUser.phone}`);
        const data = await res.json();
        mobileCachedContacts = data.contacts || [];
      }
      const q = query.trim().toLowerCase();
      const matches = mobileCachedContacts.filter(c => 
        !q ||
        (c.display_name && c.display_name.toLowerCase().includes(q)) ||
        (c.phone_number && c.phone_number.includes(q)) ||
        (c.email_address && c.email_address.toLowerCase().includes(q))
      );
      if (matches.length === 0) {
        picker.style.display = 'none';
        return;
      }
      picker.innerHTML = '';
      matches.slice(0, 5).forEach(c => {
        const item = document.createElement('div');
        item.className = 'mobile-contact-item';
        item.innerHTML = `
          <div class="mobile-contact-avatar">${(c.display_name || c.phone_number || 'P').charAt(0).toUpperCase()}</div>
          <div class="mobile-contact-info">
            <div class="mobile-contact-name">${c.display_name || `User ${c.phone_number}`}</div>
            <div class="mobile-contact-phone">📞 +91 ${c.phone_number}</div>
          </div>
        `;
        item.onmousedown = (e) => {
          e.preventDefault();
          input.value = c.phone_number;
          picker.style.display = 'none';
          document.getElementById('trad-subject').focus();
        };
        picker.appendChild(item);
      });
      picker.style.display = 'block';
    } catch (e) {
      console.warn('Contacts picker error:', e);
    }
  }

  input.addEventListener('input', () => fetchAndRender(input.value));
  input.addEventListener('focus', () => fetchAndRender(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => { picker.style.display = 'none'; }, 200);
  });
}

function openTraditionalCompose() {
  document.getElementById('trad-modal-title').innerText = 'New Traditional Email';
  const toInput = document.getElementById('trad-to');
  toInput.value = '';
  toInput.disabled = false;
  document.getElementById('trad-subject').value = '';
  document.getElementById('trad-body').value = '';
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
  document.getElementById('traditional-modal').classList.add('active');
  setTimeout(() => toInput.focus(), 50);
}

function toggleTraditionalInChat() {
  if (!activeConversation) return;
  document.getElementById('trad-modal-title').innerText = 'Compose in Traditional View';
  const toInput = document.getElementById('trad-to');
  
  // SPEC REQUIREMENT: "The To field should be pre-filled and locked."
  toInput.value = activeConversation.participant_phone;
  toInput.disabled = true;
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';

  document.getElementById('trad-subject').value = `Re: ${activeConversation.subject || ''}`;
  document.getElementById('trad-body').value = '';
  document.getElementById('traditional-modal').classList.add('active');
}

function closeTraditionalCompose() {
  document.getElementById('traditional-modal').classList.remove('active');
  const picker = document.getElementById('mobile-contacts-picker');
  if (picker) picker.style.display = 'none';
}

async function submitTraditionalCompose() {
  const to = document.getElementById('trad-to').value.trim();
  const subject = document.getElementById('trad-subject').value.trim();
  const body = document.getElementById('trad-body').value.trim();

  if (!to || !body) {
    alert('Please enter recipient and message body.');
    return;
  }

  // Parse recipients (comma separated)
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
        conversationId: (activeConversation && document.getElementById('trad-to').disabled) ? activeConversation.id : null
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeTraditionalCompose();
      loadConversations();
      if (activeConversation) {
        openConversation(activeConversation.id);
      }
    } else {
      alert(data.error || 'Failed to send email');
    }
  } catch (err) {
    alert('Send error: ' + err.message);
  }
}

// ==================== PROFILE & ALIASES ====================
async function openProfileModal() {
  document.getElementById('profile-modal').classList.add('active');
  loadAliases();
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
}

async function loadAliases() {
  const container = document.getElementById('aliases-list');
  container.innerHTML = 'Loading aliases...';
  try {
    const res = await fetch(`/api/aliases?phone=${currentUser.phone}`);
    const data = await res.json();
    container.innerHTML = '';
    if (data.aliases && data.aliases.length > 0) {
      data.aliases.forEach(a => {
        const item = document.createElement('div');
        item.className = 'alias-pill';
        item.innerHTML = `
          <span>🏷️ <strong>${a.alias_email}</strong></span>
          <span style="color: #667781; font-size: 11px;">${a.label || 'Alias'}</span>
        `;
        container.appendChild(item);
      });
    } else {
      container.innerHTML = '<p style="font-size: 12px; color: #667781;">No aliases created yet.</p>';
    }
  } catch (err) {
    container.innerHTML = 'Error loading aliases';
  }
}

async function addAlias() {
  const tag = document.getElementById('new-alias-tag').value.trim();
  const label = document.getElementById('new-alias-label').value.trim();
  if (!tag) {
    alert('Please enter an alias tag (e.g. work, son, 1)');
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
      document.getElementById('new-alias-tag').value = '';
      document.getElementById('new-alias-label').value = '';
      loadAliases();
    } else {
      alert(data.error || 'Failed to add alias');
    }
  } catch (err) {
    alert('Error adding alias: ' + err.message);
  }
}

function toggleDrawer() {
  const drawer = document.getElementById('drawer-menu');
  drawer.classList.toggle('active');
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('phonemail-mobile-user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
    } catch (e) {
      sessionStorage.removeItem('phonemail-mobile-user');
    }
  }
});
