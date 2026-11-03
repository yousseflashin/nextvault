const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const connectButton = document.getElementById('connect');
const generateButton = document.getElementById('generate-pw');
const copyGenPwdButton = document.getElementById('copy-gen-pwd');
const genPwdDisplay = document.getElementById('gen-pwd-display');
const pwdLengthRange = document.getElementById('pwd-length-range');
const pwdLenVal = document.getElementById('pwd-len-val');
const searchInput = document.getElementById('search');
const resultEl = document.getElementById('result');
const fillButton = document.getElementById('fill-current');

const navVaultBtn = document.getElementById('nav-vault-btn');
const navGenBtn = document.getElementById('nav-gen-btn');
const navSettingsBtn = document.getElementById('nav-settings-btn');

const viewVault = document.getElementById('view-vault');
const viewGenerator = document.getElementById('view-generator');
const viewSettings = document.getElementById('view-settings');

const tokenInput = document.getElementById('token-input');
const saveTokenBtn = document.getElementById('save-token');
const clearTokenBtn = document.getElementById('clear-token');

function setStatus(text, connected = false) {
  statusText.textContent = text;
  statusEl.classList.toggle('connected', connected);
}

function setResult(html) {
  resultEl.innerHTML = html;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tab navigation
function switchView(viewName) {
  [viewVault, viewGenerator, viewSettings].forEach(v => v.classList.remove('active'));
  [navVaultBtn, navGenBtn, navSettingsBtn].forEach(b => b.classList.remove('active'));

  if (viewName === 'vault') {
    viewVault.classList.add('active');
    navVaultBtn.classList.add('active');
  } else if (viewName === 'generator') {
    viewGenerator.classList.add('active');
    navGenBtn.classList.add('active');
    if (!genPwdDisplay.value) updateGeneratedPassword();
  } else if (viewName === 'settings') {
    viewSettings.classList.add('active');
    navSettingsBtn.classList.add('active');
    chrome.runtime.sendMessage({ action: 'get-saved-token' }, (res) => {
      if (res && res.token) {
        tokenInput.value = JSON.stringify(res.token, null, 2);
      }
    });
  }
}

navVaultBtn.addEventListener('click', () => switchView('vault'));
navGenBtn.addEventListener('click', () => switchView('generator'));
navSettingsBtn.addEventListener('click', () => switchView('settings'));

// Password generator
function generateSecurePassword(length = 24) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_+=';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}

function updateGeneratedPassword() {
  const len = parseInt(pwdLengthRange.value, 10) || 24;
  pwdLenVal.textContent = len;
  genPwdDisplay.value = generateSecurePassword(len);
}

pwdLengthRange.addEventListener('input', updateGeneratedPassword);
generateButton.addEventListener('click', updateGeneratedPassword);

copyGenPwdButton.addEventListener('click', () => {
  if (!genPwdDisplay.value) updateGeneratedPassword();
  navigator.clipboard.writeText(genPwdDisplay.value).then(() => {
    setStatus('Password copied');
  });
});

// Settings & Token save
saveTokenBtn.addEventListener('click', () => {
  const raw = tokenInput.value.trim();
  if (!raw) return alert('Please paste a bootstrap token JSON');
  try {
    const token = JSON.parse(raw);
    if (!token.tokenId || !token.publicKey || !token.signature) {
      throw new Error('Token is missing required fields (tokenId, publicKey, signature)');
    }
    chrome.runtime.sendMessage({ action: 'save-token', token }, (res) => {
      if (res && res.success) {
        setStatus('Token saved. Connecting...');
        switchView('vault');
        triggerConnect();
      } else {
        alert('Failed to save token');
      }
    });
  } catch (err) {
    alert('Invalid JSON: ' + err.message);
  }
});

clearTokenBtn.addEventListener('click', () => {
  if (!confirm('Clear stored bootstrap token?')) return;
  chrome.runtime.sendMessage({ action: 'clear-token' }, () => {
    tokenInput.value = '';
    setStatus('Disconnected', false);
    searchInput.disabled = true;
    fillButton.disabled = true;
    switchView('vault');
  });
});

// Connect to Desktop Vault
async function triggerConnect() {
  setStatus('Connecting...');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'connect' });
    if (chrome.runtime.lastError) {
      setStatus('Desktop unreachable', false);
      setResult('<span class="nv-dim">>> Start NexVault Desktop app first.</span>');
      return;
    }
    if (response && response.status === 'connected') {
      setStatus('Connected', true);
      searchInput.disabled = false;
      fillButton.disabled = false;
      setResult('<span class="nv-dim">>> Vault connected. Search or autofill.</span>');
    } else {
      setStatus(response?.error || 'Connection failed', false);
      if (response?.error?.includes('not configured')) {
        switchView('settings');
      }
    }
  } catch (e) {
    setStatus('Error: ' + e.message, false);
  }
}

connectButton.addEventListener('click', triggerConnect);

// Vault Search
searchInput.addEventListener('input', async () => {
  const q = searchInput.value.trim();
  if (!q) {
    setResult('<span class="nv-dim">>> Type to search credentials...</span>');
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ action: 'search-vault', query: q });
    if (response && response.entries && response.entries.length) {
      setResult(response.entries.map(en =>
        `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)">` +
        `<strong>${escapeHtml(en.service)}</strong>` +
        (en.username ? ` <span style="color:var(--nv-primary);font-size:11px">(${escapeHtml(en.username)})</span>` : '') +
        `</div>`
      ).join(''));
    } else {
      setResult('<span class="nv-dim">>> No matches for "' + escapeHtml(q) + '"</span>');
    }
  } catch (err) {
    setResult('<span class="nv-dim">>> Search error: ' + escapeHtml(err.message) + '</span>');
  }
});

// Autofill Current Page
fillButton.addEventListener('click', async () => {
  setResult('<span class="nv-dim">>> Autofilling active tab...</span>');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'autofill-current' });
    if (response && response.success) {
      setResult(`<span class="nv-dim">>> Filled credentials for ${escapeHtml(response.serviceName)}</span>`);
      setStatus('Autofill successful', true);
    } else {
      setResult('<span class="nv-dim">>> Autofill: ' + escapeHtml(response?.error || 'No match') + '</span>');
    }
  } catch (err) {
    setResult('<span class="nv-dim">>> Error: ' + escapeHtml(err.message) + '</span>');
  }
});

// Check status on open
chrome.runtime.sendMessage({ action: 'get-saved-token' }, (res) => {
  if (res && res.token) {
    triggerConnect();
  } else {
    setStatus('No token configured', false);
    setResult('<span class="nv-dim">>> Go to Settings tab to paste your desktop bootstrap token.</span>');
  }
});
