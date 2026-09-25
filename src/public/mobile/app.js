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

// ==================== PHONE.EMAIL OFFICIAL LISTENER (MOBILE) ====================
window.phoneEmailListener = async (userObj) => {
  if (!userObj || !userObj.user_json_url) return;
  const { user_json_url } = userObj;
  try {
    const res = await fetch('/api/auth/phone-email-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_json_url, clientType: 'MOBILE_CLIENT' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };
      sessionStorage.setItem('phonemail-mobile-user', JSON.stringify(currentUser));
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
    } else {
      alert(data.error || 'Failed to authenticate phone number with Phone.Email');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  }
};

function triggerPhoneEmailLogin() {
  const btn = document.getElementById('mobile-phonemail-hero-btn') || document.getElementById('phonemail-hero-btn');
  const peBtn = document.getElementById('btn_ph_login');

  if (btn) {
    btn.style.opacity = '0.75';
    const subCaption = btn.querySelector('.btn-sub-caption');
    if (subCaption) subCaption.innerText = 'Opening secure verification...';
  }

  // Attempt click on SDK-rendered button if present
  if (peBtn) {
    peBtn.click();
    setTimeout(() => {
      if (btn) {
        btn.style.opacity = '1';
        const subCaption = btn.querySelector('.btn-sub-caption');
        if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
      }
    }, 2500);
    return;
  }

  // Fallback: If SDK button is still loading, open official Phone.Email popup directly
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
      if (subCaption) subCaption.innerText = 'Real-Time OTP Verification';
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

let mobileCountdownTimer = null;
let mobileCountdownSeconds = 45;
let mobileLiveOtp = '';

function initMobileOtpInputs() {
  const cells = document.querySelectorAll('.otp-digit');
  if (!cells || cells.length === 0) return;

  cells.forEach((cell, idx) => {
    cell.addEventListener('input', (e) => {
      const val = cell.value.replace(/\D/g, '');
      cell.value = val ? val.slice(-1) : '';

      if (cell.value) {
        cell.classList.add('filled');
        cell.classList.remove('error');
        if (idx < cells.length - 1) {
          cells[idx + 1].focus();
        }
      } else {
        cell.classList.remove('filled');
      }

      // Check full 6-digit OTP -> Auto submit
      let fullOtp = '';
      cells.forEach(c => { fullOtp += (c.value || '').trim(); });
      if (fullOtp.length === 6) {
        verifyOTP(fullOtp);
      }
    });

    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!cell.value && idx > 0) {
          cells[idx - 1].focus();
          cells[idx - 1].value = '';
          cells[idx - 1].classList.remove('filled', 'error');
          e.preventDefault();
        } else {
          cell.value = '';
          cell.classList.remove('filled', 'error');
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        cells[idx - 1].focus();
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && idx < cells.length - 1) {
        cells[idx + 1].focus();
        e.preventDefault();
      }
    });

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
        verifyOTP(digits);
      }
    });
  });
}

async function requestOTP() {
  const phone = document.getElementById('mobile-phone-input').value.trim();
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit Indian phone number');
    return;
  }
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  pendingPhone = cleanPhone;
  document.getElementById('verify-phone-label').innerText = `+91 ${cleanPhone.slice(0,5)} ${cleanPhone.slice(5)}`;

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      mobileLiveOtp = data.liveOtp || '123456';
      goToScreen('screen-otp');
      const hint = document.getElementById('mobile-otp-hint');
      if (hint && data.liveOtp) {
        hint.innerHTML = `Live Code: <strong style="color:var(--wa-green-btn); font-family:monospace; font-size:15px; text-decoration:underline; cursor:pointer;" onclick="autoFillRealOTP('${data.liveOtp}')">${data.liveOtp} (tap to autofill)</strong>`;
      }
      clearMobileOtp();
      startMobileTimer();
    } else {
      alert(data.error || 'Failed to dispatch verification code');
    }
  } catch (err) {
    alert('Failed to request verification: ' + err.message);
  }
}

function clearMobileOtp() {
  const cells = document.querySelectorAll('.otp-digit');
  cells.forEach(c => {
    c.value = '';
    c.classList.remove('filled', 'error');
  });
  setTimeout(() => {
    if (cells[0]) cells[0].focus();
  }, 100);
}

function startMobileTimer() {
  if (mobileCountdownTimer) clearInterval(mobileCountdownTimer);
  mobileCountdownSeconds = 45;

  const timerWrap = document.getElementById('mobile-timer-wrap');
  const timerSecs = document.getElementById('mobile-timer-seconds');
  const resendBtn = document.getElementById('btn-mobile-resend');
  const callBtn = document.getElementById('btn-mobile-call');

  if (timerWrap) timerWrap.style.display = 'block';
  if (resendBtn) resendBtn.disabled = true;
  if (callBtn) callBtn.disabled = true;

  updateMobileTimerText();

  mobileCountdownTimer = setInterval(() => {
    mobileCountdownSeconds--;
    updateMobileTimerText();
    if (mobileCountdownSeconds <= 0) {
      clearInterval(mobileCountdownTimer);
      if (timerWrap) timerWrap.style.display = 'none';
      if (resendBtn) resendBtn.disabled = false;
      if (callBtn) callBtn.disabled = false;
    }
  }, 1000);
}

function updateMobileTimerText() {
  const timerSecs = document.getElementById('mobile-timer-seconds');
  if (!timerSecs) return;
  const m = Math.floor(mobileCountdownSeconds / 60);
  const s = mobileCountdownSeconds % 60;
  timerSecs.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function resendMobileOTP() {
  if (!pendingPhone) return;
  const hint = document.getElementById('mobile-otp-hint');
  if (hint) hint.innerText = 'Dispatching new SMS... ⏳';

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: pendingPhone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      mobileLiveOtp = data.liveOtp || '123456';
      if (hint) {
        hint.innerHTML = `Live Code: <strong style="color:var(--wa-green-btn); font-family:monospace; font-size:15px; text-decoration:underline; cursor:pointer;" onclick="autoFillRealOTP('${mobileLiveOtp}')">${mobileLiveOtp} (tap to autofill)</strong>`;
      }
      clearMobileOtp();
      startMobileTimer();
    }
  } catch (err) {
    if (hint) hint.innerText = 'Error resending: ' + err.message;
  }
}

async function callMobileOTP() {
  if (!pendingPhone) return;
  const hint = document.getElementById('mobile-otp-hint');
  if (hint) hint.innerText = '📞 Placing real-time voice call...';

  try {
    const res = await fetch('/api/auth/call-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: pendingPhone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (data.liveOtp) mobileLiveOtp = data.liveOtp;
      if (hint) hint.innerText = '📞 Calling now! Answer your phone for the code.';
      clearMobileOtp();
    }
  } catch (err) {
    if (hint) hint.innerText = 'Voice call error: ' + err.message;
  }
}

function autoFillRealOTP(otp) {
  const digits = String(otp).split('');
  const inputs = document.querySelectorAll('.otp-digit');
  inputs.forEach((input, i) => { 
    if (digits[i]) {
      input.value = digits[i];
      input.classList.add('filled');
    }
  });
  verifyOTP(otp);
}

async function verifyOTP(otp) {
  const hint = document.getElementById('mobile-otp-hint');
  if (hint) hint.innerText = '⏳ Verifying code...';

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
      if (mobileCountdownTimer) clearInterval(mobileCountdownTimer);

      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name || `User ${data.user.phone_number}`,
        email: data.user.email_address
      };

      if (data.isNewUser || (data.user.display_name && data.user.display_name.startsWith('User '))) {
        // Go to Step 3 Profile setup
        goToScreen('screen-profile');
        const first = document.getElementById('mobile-first-name');
        if (first) first.focus();
      } else {
        sessionStorage.setItem('phonemail-mobile-user', JSON.stringify(currentUser));
        document.getElementById('onboarding-container').style.display = 'none';
        initMainApp();
      }
    } else {
      triggerMobileShake(data.error || 'Invalid verification code');
    }
  } catch (err) {
    triggerMobileShake('Verification error: ' + err.message);
  }
}

function triggerMobileShake(errMsg) {
  const container = document.getElementById('mobile-otp-inputs');
  const cells = document.querySelectorAll('.otp-digit');
  cells.forEach(c => c.classList.add('error'));

  if (container) {
    container.classList.remove('otp-shake-mobile');
    void container.offsetWidth;
    container.classList.add('otp-shake-mobile');
  }

  const hint = document.getElementById('mobile-otp-hint');
  if (hint) hint.innerHTML = `<span style="color:#ef4444; font-weight:600;">❌ ${errMsg}</span>`;

  setTimeout(() => {
    if (container) container.classList.remove('otp-shake-mobile');
    clearMobileOtp();
  }, 450);
}

function updateMobileAvatarPreview() {
  const fn = (document.getElementById('mobile-first-name').value || '').trim();
  const ln = (document.getElementById('mobile-last-name').value || '').trim();
  const circle = document.getElementById('mobile-avatar-circle');
  if (circle) {
    circle.innerText = fn ? fn.charAt(0).toUpperCase() : (ln ? ln.charAt(0).toUpperCase() : 'P');
  }
}

async function completeMobileProfile() {
  const fn = (document.getElementById('mobile-first-name').value || '').trim();
  const ln = (document.getElementById('mobile-last-name').value || '').trim();

  if (!fn) {
    alert('Please enter your first name');
    document.getElementById('mobile-first-name').focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: pendingPhone,
        firstName: fn,
        lastName: ln,
        aliasTag: 'mobile'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentUser = {
        phone: data.user.phone_number,
        name: data.user.display_name,
        email: data.user.email_address
      };
      sessionStorage.setItem('phonemail-mobile-user', JSON.stringify(currentUser));
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
    } else {
      alert(data.error || 'Failed to complete profile');
    }
  } catch (err) {
    alert('Error saving profile: ' + err.message);
  }
}

function loadPhoneEmailScript() {
  if (document.getElementById('pe-signin-script-mobile')) return;
  const script = document.createElement('script');
  script.id = 'pe-signin-script-mobile';
  script.src = 'https://www.phone.email/sign_in_button_v1.js';
  script.async = true;
  document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
  loadPhoneEmailScript();
  initMobileOtpInputs();
});

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
    fetch('/api/emails/sync', { method: 'POST' }).catch(() => {});
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
