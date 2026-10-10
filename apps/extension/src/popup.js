const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const connectButton = document.getElementById('connect');
const searchInput = document.getElementById('search');
const resultEl = document.getElementById('result');
const fillButton = document.getElementById('fill-current');

function setStatus(text, connected = false) {
  statusText.textContent = text;
  statusEl.classList.toggle('connected', connected);
}

function setResult(html) {
  resultEl.innerHTML = html;
}

// Bootstrap token setup
const tokenButton = document.createElement('button');
tokenButton.type = 'button';
tokenButton.className = 'nv-popup-btn ghost';
tokenButton.textContent = 'Set Bootstrap Token';
tokenButton.addEventListener('click', () => {
  try {
    const raw = prompt('Paste bootstrap token JSON:');
    if (!raw) return;
    const token = JSON.parse(raw);
    chrome.storage.local.set({ bootstrapToken: token }, () => {
      setStatus('Bootstrap token saved', false);
    });
  } catch {
    setStatus('Invalid token JSON', false);
  }
});
connectButton.parentNode.insertBefore(tokenButton, connectButton);

connectButton.addEventListener('click', async () => {
  setStatus('Connecting...');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'connect' });
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, false);
      return;
    }
    if (response.status === 'connected') {
      setStatus('Connected to NexVault', true);
      searchInput.disabled = false;
      fillButton.disabled = false;
      setResult('<span class="nv-dim">>> Vault connected. Search or autofill.</span>');
    } else {
      setStatus(response.error || 'Connection failed', false);
    }
  } catch (e) {
    setStatus('Error: ' + e.message, false);
  }
});

searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = searchInput.value.trim();
  if (!q) return;
  setResult('<span class="nv-dim">>> Searching vault...</span>');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'search-vault', query: q });
    if (response && response.entries && response.entries.length) {
      setResult(response.entries.map(en =>
        `<div style="padding:2px 0"><strong>${escapeHtml(en.service)}</strong><br><span class="nv-dim">${escapeHtml(en.username || '')}</span></div>`
      ).join(''));
    } else {
      setResult('<span class="nv-dim">>> No matches for "' + escapeHtml(q) + '"</span>');
    }
  } catch (err) {
    setResult('<span class="nv-dim">>> Error: ' + escapeHtml(err.message) + '</span>');
  }
});

fillButton.addEventListener('click', async () => {
  setResult('<span class="nv-dim">>> Autofilling current page...</span>');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'autofill-current' });
    if (response && response.success) {
      setResult('<span class="nv-dim">>> Autofill complete.</span>');
    } else {
      setResult('<span class="nv-dim">>> Autofill failed: ' + escapeHtml((response && response.error) || 'unknown') + '</span>');
    }
  } catch (err) {
    setResult('<span class="nv-dim">>> Error: ' + escapeHtml(err.message) + '</span>');
  }
});

// Expose autofill API to the page context
window.nexVaultAutofill = {
  fillPassword: async (fieldId, password) => {
    const result = await chrome.runtime.sendMessage({
      type: 'autofill-password',
      fieldId,
      password
    });
    return result.success;
  },
  getSecrets: async (serviceName) => {
    const result = await chrome.runtime.sendMessage({
      type: 'get-secrets',
      serviceName
    });
    return result;
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
}
