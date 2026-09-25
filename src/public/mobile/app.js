// ==================== STATE MANAGEMENT ====================
let currentUser = null;
let pendingPhone = '';

let activeConversation = null;
let currentMessages = [];
let replyingToId = null;
let activeFilter = 'all';
let activeSourceFilter = 'all'; // 'all' | 'phonemail' | 'external'
let allConversationsList = [];
let cachedDeviceContacts = [];
let socket = null;

// ==================== ONBOARDING FLOW ====================
function goToScreen(screenId) {
  document.querySelectorAll('.onboarding-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

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

function saveMobileSession(user) {
  currentUser = user;
  const remEl = document.getElementById('mobile-auth-remember-me');
  const remember = remEl ? remEl.checked : true;
  const str = JSON.stringify(user);
  if (remember) {
    localStorage.setItem('phonemail-mobile-user', str);
    localStorage.setItem('phonemail-user', str);
    if (user.phone) localStorage.setItem('phonemail_saved_phone', user.phone);
  }
  sessionStorage.setItem('phonemail-mobile-user', str);
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

// ==================== MODERN POPUP TOAST & NOTIFICATION SYSTEM (MOBILE) ====================
function showNotify(options) {
  let opts = typeof options === 'string' ? { message: options, type: 'info' } : (options || {});
  const container = document.getElementById('app-toast-container') || document.body;
  const toast = document.createElement('div');
  const type = opts.type || 'info';
  const duration = opts.duration !== undefined ? opts.duration : 3500;
  toast.className = `app-toast ${type}`;

  const iconMap = {
    success: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
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
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
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

function showMobileToast(msg, type = 'info') {
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
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <div class="app-dialog-title">${escapeHtml(title)}</div>
      </div>
      <div class="app-dialog-body">${escapeHtml(message)}</div>
      <input type="text" class="app-dialog-input" id="app-dialog-input-field" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
      <div class="app-dialog-actions">
        <button type="button" class="btn-secondary" id="dialog-cancel-btn" style="padding: 7px 14px; font-size: 13px;">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn-wa-green" id="dialog-confirm-btn" style="padding: 7px 16px; font-size: 13px;">${escapeHtml(confirmText)}</button>
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
      saveMobileSession(currentUser);
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
      showNotify.success(`Welcome to PhoneMail, ${currentUser.name}!`, 'Signed In');
      checkOneTimeContactSyncPrompt();
    } else {
      showNotify.error(data.error || 'Failed to authenticate phone number with Phone.Email', 'Auth Error');
    }
  } catch (err) {
    showNotify.error('Verification error: ' + err.message, 'Network Error');
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
let mobileWebOtpAbortController = null;

// Phone number auto-detection for simple mobile login
function autoDetectMobilePhone() {
  const phoneInput = document.getElementById('mobile-phone-input');
  if (!phoneInput) return;

  const savedPhone = localStorage.getItem('phonemail_saved_phone') || (currentUser && currentUser.phone);
  if (savedPhone) {
    const clean = savedPhone.replace(/\D/g, '').slice(-10);
    phoneInput.value = clean;
    showNotify.info(`Auto-detected phone number: +91 ${clean}`, 'Number Detected');
    phoneInput.focus();
  }
}

// WebOTP API: Automatic SMS OTP detection for mobile devices
async function startWebOtpDetection(onOtpReceived) {
  if (!('OTPCredential' in window) && !('credentials' in navigator)) {
    console.log('WebOTP not natively supported on this browser');
    return;
  }

  try {
    if (mobileWebOtpAbortController) {
      mobileWebOtpAbortController.abort();
    }
    mobileWebOtpAbortController = new AbortController();

    const badge = document.getElementById('mob-webotp-badge');
    if (badge) badge.style.display = 'flex';

    const content = await navigator.credentials.get({
      otp: { transport: ['sms'] },
      signal: mobileWebOtpAbortController.signal
    });

    if (content && content.code) {
      console.log('⚡ [WebOTP] Mobile intercepted OTP code:', content.code);
      const cleanCode = content.code.replace(/\D/g, '').slice(0, 6);
      if (cleanCode.length === 6) {
        showNotify.success('OTP code detected automatically from SMS!', 'WebOTP Auto-Detected');
        const cells = document.querySelectorAll('.otp-digit');
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
      console.log('WebOTP mobile listener notice:', err.message);
    }
  }
}

function initMobileOtpInputs() {
  const cells = document.querySelectorAll('.otp-digit');
  if (!cells || cells.length === 0) return;

  cells.forEach((cell, idx) => {
    cell.addEventListener('input', (e) => {
      const rawVal = cell.value.replace(/\D/g, '');

      // Single-cell full 6-digit autofill (iOS QuickType / Android autofill)
      if (rawVal.length === 6) {
        rawVal.split('').forEach((d, i) => {
          if (cells[i]) {
            cells[i].value = d;
            cells[i].classList.add('filled');
            cells[i].classList.remove('error');
          }
        });
        cells[5].focus();
        verifyOTP(rawVal);
        return;
      }

      const val = rawVal ? rawVal.slice(-1) : '';
      cell.value = val;

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
    showNotify.warning('Please enter a valid 10-digit Indian phone number', 'Invalid Number');
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
      startWebOtpDetection(verifyOTP);
    } else {
      showNotify.error(data.error || 'Failed to dispatch verification code', 'OTP Error');
    }
  } catch (err) {
    showNotify.error('Failed to request verification: ' + err.message, 'Connection Error');
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
      if (mobileWebOtpAbortController) {
        try { mobileWebOtpAbortController.abort(); } catch (e) {}
      }

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
        saveMobileSession(currentUser);
        document.getElementById('onboarding-container').style.display = 'none';
        initMainApp();
        checkOneTimeContactSyncPrompt();
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
    showNotify.warning('Please enter your first name', 'Incomplete Profile');
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
      saveMobileSession(currentUser);
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();
      showNotify.success(`Welcome to PhoneMail, ${currentUser.name}!`, 'Registered');
      checkOneTimeContactSyncPrompt();
    } else {
      showNotify.error(data.error || 'Failed to complete profile', 'Registration Error');
    }
  } catch (err) {
    showNotify.error('Error saving profile: ' + err.message, 'Server Error');
  }
}

// ==================== ONE-TIME CONTACT SYNC & REAL-TIME DISCOVERY (MOBILE) ====================
let mobileRealtimeSyncInterval = null;

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
        showNotify.success('Contacts synced! Real-time contact discovery active.', 'Sync Enabled');
      }
    } catch (err) {
      console.log('Mobile contact selection error:', err.message);
    }
  } else {
    showNotify.info('Real-time contact discovery activated for registered PhoneMail users.', 'Sync Enabled');
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
  if (mobileRealtimeSyncInterval) clearInterval(mobileRealtimeSyncInterval);
  syncContactsRealtime(true);
  mobileRealtimeSyncInterval = setInterval(() => {
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
    console.log('Mobile real-time contact sync check:', err.message);
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
  autoDetectMobilePhone();
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

    socket.on('contacts:sync', () => {
      syncContactsRealtime(true);
    });
  } catch (e) {
    console.warn('Socket init notice:', e);
  }

  setupMobileContactsPicker();
  loadConversations();

  // Initialize Real-Time Contact Sync
  const perm = localStorage.getItem('phonemail_contact_sync_permission');
  if (perm === 'granted') {
    startRealtimeContactSync();
  } else if (!perm) {
    setTimeout(checkOneTimeContactSyncPrompt, 1500);
  }
}

async function loadConversations() {
  try {
    fetch('/api/emails/sync', { method: 'POST' }).catch(() => {});
    const res = await fetch(`/api/conversations?phone=${currentUser.phone}`);
    const data = await res.json();
    allConversationsList = data.conversations || [];

    // Live counts for the two classification tabs (PhoneMail vs External)
    const totalAll = allConversationsList.length;
    const totalPhoneMail = allConversationsList.filter(c => isPhoneMailSender(c.participant_phone)).length;
    const totalExternal = allConversationsList.filter(c => !isPhoneMailSender(c.participant_phone)).length;

    const elAll = document.getElementById('mob-count-all');
    if (elAll) elAll.innerText = totalAll;
    const elPM = document.getElementById('mob-count-phonemail');
    if (elPM) elPM.innerText = totalPhoneMail;
    const elExt = document.getElementById('mob-count-external');
    if (elExt) elExt.innerText = totalExternal;

    renderConversations(allConversationsList);
  } catch (err) {
    console.error('Failed to load conversations:', err);
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
  renderConversations(allConversationsList);
}

function renderConversations(conversations) {
  const container = document.getElementById('conversations-list');
  container.innerHTML = '';

  let filtered = conversations || [];

  // Filter 1: Tab source classification (Same App PhoneMail vs External)
  if (activeSourceFilter === 'phonemail') {
    filtered = filtered.filter(c => isPhoneMailSender(c.participant_phone));
  } else if (activeSourceFilter === 'external') {
    filtered = filtered.filter(c => !isPhoneMailSender(c.participant_phone));
  }

  // Filter 2: Status chips (unread, starred)
  if (activeFilter === 'unread') {
    filtered = filtered.filter(c => c.unread_count > 0);
  } else if (activeFilter === 'starred') {
    filtered = filtered.filter(c => c.unread_count > 0 || c.is_group === 1);
  }

  if (filtered.length === 0) {
    let emptyMsg = 'No conversations found.';
    if (activeSourceFilter === 'phonemail') {
      emptyMsg = 'No PhoneMail network conversations found.';
    } else if (activeSourceFilter === 'external') {
      emptyMsg = 'No external (Gmail, Rediff, etc.) conversations found.';
    }
    container.innerHTML = `
      <div style="text-align: center; color: #667781; padding: 40px 20px;">
        <div style="margin-bottom: 10px;">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p style="font-weight: 600; color: #334155;">${emptyMsg}</p>
        <p style="font-size: 12px; margin-top: 4px; color: #94a3b8;">Use compose to start a new message.</p>
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

    const isFromPhoneMail = isPhoneMailSender(conv.participant_phone);
    const sourceBadgeHtml = isFromPhoneMail
      ? `<span class="badge-source-tag badge-phonemail-pill" style="margin-left: 6px;">⚡ PhoneMail</span>`
      : `<span class="badge-source-tag badge-external-pill" style="margin-left: 6px;">🌐 External</span>`;

    const cleanSender = conv.is_group === 1 
      ? '👥 ' + conv.subject 
      : formatSenderDisplay(conv.participant_phone);

    item.innerHTML = `
      <div class="chat-avatar">${conv.is_group === 1 ? '👥' : initial}</div>
      <div class="chat-details">
        <div class="chat-top-row">
          <div class="chat-sender-name" style="display: flex; align-items: center;">
            <span>${escapeHtml(cleanSender)}</span>
            ${sourceBadgeHtml}
          </div>
          <div class="chat-timestamp">${timeDisplay}</div>
        </div>
        <div class="chat-bottom-row">
          <div class="chat-preview-text">${escapeHtml(conv.last_message || conv.subject || 'No messages')}</div>
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
      : formatSenderDisplay(activeConversation.participant_phone);

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
    showNotify.warning('This message has already been replied to. Each message can be replied to only once.', 'Single Reply Policy');
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

function openFullEmailModal(emailId) {
  const msg = currentMessages.find(m => m.id === emailId);
  if (msg) {
    showPromptDialog({
      title: 'Full Email Content',
      message: msg.body_text,
      placeholder: '',
      confirmText: 'Done',
      cancelText: 'Close',
      onConfirm: () => {}
    });
  }
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
      showNotify.error(data.error || 'Failed to send message', 'Send Failed');
    }
  } catch (err) {
    showNotify.error('Send error: ' + err.message, 'Network Error');
  }
}

// ==================== TRADITIONAL COMPOSE & CONTACTS PICKER ====================
async function pickMobileDeviceContacts() {
  const input = document.getElementById('trad-to');
  if ('contacts' in navigator && 'ContactsManager' in window) {
    try {
      const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      if (selected && selected.length > 0) {
        const rawPhones = [];
        selected.forEach(c => {
          if (c.tel) c.tel.forEach(t => rawPhones.push(t));
        });

        if (rawPhones.length === 0) {
          showNotify.warning('No phone numbers found in selected device contacts.', 'No Contacts');
          return;
        }

        showNotify.info('Checking which device contacts are on PhoneMail...', 'Contact Sync');
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
            showNotify.success(`Selected ${registered[0].display_name} (+91 ${registered[0].phone_number})`, 'Contact Selected');
          } else {
            showNotify.success(`Found ${registered.length} PhoneMail contacts from your device!`);
            const picker = document.getElementById('mobile-contacts-picker');
            if (picker) renderMobileContactsDropdown(registered, picker, input);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        showNotify.info('Device contact picker cancelled.');
      }
    }
  } else {
    showPromptDialog({
      title: 'Search Contacts',
      message: 'Enter 10-digit mobile number or name to search registered PhoneMail users:',
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
            showNotify.success(`Selected ${list[0].display_name} (+91 ${list[0].phone_number})`);
          } else {
            const picker = document.getElementById('mobile-contacts-picker');
            if (picker) renderMobileContactsDropdown(list, picker, input);
          }
        } catch (err) {
          showNotify.error('Failed to search: ' + err.message);
        }
      }
    });
  }
}

function renderMobileContactsDropdown(matches, container, targetInput) {
  container.innerHTML = '';
  matches.slice(0, 6).forEach(c => {
    const item = document.createElement('div');
    item.className = 'mobile-contact-item';
    item.innerHTML = `
      <div class="mobile-contact-avatar">${(c.display_name || c.phone_number || 'P').charAt(0).toUpperCase()}</div>
      <div class="mobile-contact-info">
        <div class="mobile-contact-name">${escapeHtml(c.display_name || `User ${c.phone_number}`)} <span style="font-size:10px; color:#046A38; font-weight:700;">✓ PhoneMail</span></div>
        <div class="mobile-contact-phone">📞 +91 ${escapeHtml(c.phone_number)}</div>
      </div>
    `;
    item.onmousedown = (e) => {
      e.preventDefault();
      targetInput.value = c.phone_number;
      container.style.display = 'none';
      const subj = document.getElementById('trad-subject');
      if (subj) subj.focus();
    };
    container.appendChild(item);
  });
  container.style.display = 'block';
}

function setupMobileContactsPicker() {
  const input = document.getElementById('trad-to');
  const picker = document.getElementById('mobile-contacts-picker');
  if (!input || !picker) return;

  let debounceTimer = null;

  async function fetchAndRender(query = '') {
    if (input.disabled) return;
    try {
      if (!currentUser) return;
      const q = query.trim();

      if (q.length >= 2) {
        if (q.includes('@') && (q.endsWith('.com') || q.endsWith('.net') || q.endsWith('.org') || q.endsWith('.in'))) {
          picker.style.display = 'none';
          return;
        }

        const res = await fetch(`/api/contacts?phone=${currentUser.phone}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const matches = data.contacts || [];

        if (matches.length === 0) {
          picker.innerHTML = `
            <div style="padding: 10px; font-size: 11px; color: #64748b;">
              No registered PhoneMail user for "${escapeHtml(q)}". External emails (e.g. Gmail) can be entered directly.
            </div>
          `;
          picker.style.display = 'block';
          return;
        }

        renderMobileContactsDropdown(matches, picker, input);
        return;
      }

      // Empty query: combine recent conversation contacts + cached device contacts
      let combined = [];
      const res = await fetch(`/api/contacts?phone=${currentUser.phone}`);
      const data = await res.json();
      const recent = data.contacts || [];
      recent.forEach(c => combined.push(c));

      try {
        const rawCached = localStorage.getItem('phonemail_cached_device_contacts');
        if (rawCached) {
          const deviceList = JSON.parse(rawCached);
          if (Array.isArray(deviceList)) {
            deviceList.forEach(dc => {
              if (!combined.some(item => item.phone_number === dc.phone_number)) {
                combined.push(dc);
              }
            });
          }
        }
      } catch (e) {}

      if (combined.length === 0) {
        picker.style.display = 'none';
        return;
      }

      renderMobileContactsDropdown(combined, picker, input);
    } catch (e) {
      console.warn('Contacts picker error:', e);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchAndRender(input.value), 250);
  });
  input.addEventListener('focus', () => {
    if (!input.value.trim()) fetchAndRender('');
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { picker.style.display = 'none'; }, 250);
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
    showNotify.warning('Please enter recipient and message body.', 'Incomplete');
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
      showNotify.success('Email sent successfully!', 'Message Sent');
    } else {
      showNotify.error(data.error || 'Failed to send email', 'Send Failed');
    }
  } catch (err) {
    showNotify.error('Send error: ' + err.message, 'Network Error');
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
          <span>🏷️ <strong>${escapeHtml(a.alias_email)}</strong></span>
          <span style="color: #667781; font-size: 11px;">${escapeHtml(a.label || 'Alias')}</span>
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
    showNotify.warning('Please enter an alias tag (e.g. work, son, 1)', 'Missing Tag');
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
      showNotify.success(`Sub-number .${tag} created!`, 'Sub-Number Added');
    } else {
      showNotify.error(data.error || 'Failed to add alias', 'Alias Error');
    }
  } catch (err) {
    showNotify.error('Error adding alias: ' + err.message, 'Server Error');
  }
}

function toggleDrawer() {
  const drawer = document.getElementById('drawer-menu');
  drawer.classList.toggle('active');
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('phonemail-mobile-user') || localStorage.getItem('phonemail-user') || sessionStorage.getItem('phonemail-mobile-user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      document.getElementById('onboarding-container').style.display = 'none';
      initMainApp();

      // Cross-device sync: fetch latest profile & aliases
      if (currentUser && currentUser.phone) {
        fetch(`/api/auth/me?phone=${encodeURIComponent(currentUser.phone)}`)
          .then(r => r.json())
          .then(data => {
            if (data && data.user) {
              currentUser.name = data.user.display_name || currentUser.name;
              currentUser.email = data.user.email_address || currentUser.email;
              saveMobileSession(currentUser);
              const dU = document.getElementById('drawer-username');
              if (dU) dU.innerText = currentUser.name;
              const dE = document.getElementById('drawer-email');
              if (dE) dE.innerText = currentUser.email;
              const pN = document.getElementById('profile-name');
              if (pN) pN.innerText = currentUser.name;
              const pE = document.getElementById('profile-email');
              if (pE) pE.innerText = currentUser.email;
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      localStorage.removeItem('phonemail-mobile-user');
      sessionStorage.removeItem('phonemail-mobile-user');
    }
  }
});
