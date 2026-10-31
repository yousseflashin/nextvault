const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const connectButton = document.getElementById('connect');
const generateButton = document.getElementById('generate-pw');
const searchInput = document.getElementById('search');
const resultEl = document.getElementById('result');
const fillButton = document.getElementById('fill-current');

const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');
const toggleSettingsBtn = document.getElementById('toggle-settings');
const backBtn = document.getElementById('back-btn');
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
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
}

function showSettings(show) {
  if (show) {
    mainView.classList.add('nv-hidden');
    settingsView.classList.remove('nv-hidden');
    toggleSettingsBtn.textContent = 'Close';
    chrome.runtime.sendMessage({ action: 'get-saved-token' }, (res) => {
      if (res && res.token) {
        tokenInput.value = JSON.stringify(res.token, null, 2);
      }
    });
  } else {
    settingsView.classList.add('nv-hidden');
    mainView.classList.remove('nv-hidden');
    toggleSettingsBtn.textContent = 'Settings';
  }
}

toggleSettingsBtn.addEventListener('click', () => {
  const isSettings = !settingsView.classList.contains('nv-hidden');
  showSettings(!isSettings);
});

backBtn.addEventListener('click', () => showSettings(false));

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
        showSettings(false);
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
    setStatus('Token cleared (disconnected)', false);
    searchInput.disabled = true;
    fillButton.disabled = true;
    showSettings(false);
  });
});

function generateSecurePassword(length = 24) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}

generateButton.addEventListener('click', () => {
  const password = generateSecurePassword();
  navigator.clipboard.writeText(password).then(() => {
    setStatus('Password copied to clipboard');
    setResult(`<span class="nv-dim">>> Generated & copied:</span><br><code>${escapeHtml(password)}</code>`);
  });
});

async function triggerConnect() {
  setStatus('Connecting to desktop vault...');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'connect' });
    if (chrome.runtime.lastError) {
      setStatus('Desktop unreachable', false);
      setResult('<span class="nv-dim">>> Start NexVault Desktop app first.</span>');
      return;
    }
    if (response && response.status === 'connected') {
      setStatus('Connected to NexVault', true);
      searchInput.disabled = false;
      fillButton.disabled = false;
      setResult('<span class="nv-dim">>> Vault connected. Search or autofill.</span>');
    } else {
      setStatus(response?.error || 'Connection failed', false);
      if (response?.error?.includes('not configured')) {
        showSettings(true);
      }
    }
  } catch (e) {
    setStatus('Error: ' + e.message, false);
  }
}

connectButton.addEventListener('click', triggerConnect);

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
        `<div style="padding:4px 0;border-bottom:1px solid rgba(0,255,157,0.1)">` +
        `<strong>${escapeHtml(en.service)}</strong>` +
        (en.username ? ` <span style="color:#00ff9d;font-size:10px">(${escapeHtml(en.username)})</span>` : '') +
        `</div>`
      ).join(''));
    } else {
      setResult('<span class="nv-dim">>> No matches for "' + escapeHtml(q) + '"</span>');
    }
  } catch (err) {
    setResult('<span class="nv-dim">>> Search error: ' + escapeHtml(err.message) + '</span>');
  }
});

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
    setResult('<span class="nv-dim">>> Click Settings above to paste your desktop bootstrap token.</span>');
  }
});
