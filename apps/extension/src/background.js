const CANDIDATE_URLS = [
  'ws://127.0.0.1:46124',
  'ws://localhost:46124'
];
let activeSocket = null;
let sessionKey = null;
let connectPromise = null;

function encode(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

function decode(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptMessage(message) {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionKey));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(message))
  ));
  return {
    iv: encode(iv),
    data: encode(encrypted.slice(0, -16)),
    tag: encode(encrypted.slice(-16))
  };
}

function tryConnectUrl(url, token) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { ws?.close(); } catch {}
      reject(new Error(`Timeout connecting to ${url}`));
    }, 2500);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      finished = true;
      return reject(err);
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (ws) {
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      }
    };

    const onError = (evt) => {
      if (finished) return;
      finished = true;
      cleanup();
      try { ws?.close(); } catch {}
      reject(new Error(`Failed to reach ${url}`));
    };

    const onClose = () => {
      if (activeSocket === ws) {
        activeSocket = null;
        sessionKey = null;
      }
    };

    const onMessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'extension-authenticated') {
          finished = true;
          cleanup();
          activeSocket = ws;
          sessionKey = token.tokenId;
          ws.addEventListener('close', onClose);
          resolve(ws);
        } else if (message.type === 'error') {
          finished = true;
          cleanup();
          try { ws?.close(); } catch {}
          reject(new Error(message.error || 'Authentication rejected by desktop app'));
        }
      } catch (err) {
        finished = true;
        cleanup();
        reject(err);
      }
    };

    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'extension-auth', token }));
      } catch (err) {
        onError(err);
      }
    });

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
  });
}

async function connect(token) {
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    return activeSocket;
  }
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    let lastError = null;
    for (const url of CANDIDATE_URLS) {
      try {
        const ws = await tryConnectUrl(url, token);
        return ws;
      } catch (err) {
        lastError = err;
        // If desktop app explicitly rejected the token, don't try another URL
        if (err.message && err.message.includes('rejected')) {
          break;
        }
      }
    }

    if (lastError?.message && (lastError.message.includes('rejected') || lastError.message.includes('token'))) {
      throw lastError;
    }
    throw new Error('NexVault desktop app is unavailable. Make sure Desktop app is running and your token is saved in Settings.');
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

function sendVaultRequest(message) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['bootstrapToken'], async ({ bootstrapToken }) => {
      if (!bootstrapToken) {
        return reject(new Error('Bootstrap token is not configured in extension popup'));
      }
      try {
        const ws = await connect(bootstrapToken);
        const encrypted = await encryptMessage(message);

        let finished = false;
        const timeout = setTimeout(() => {
          if (finished) return;
          finished = true;
          ws?.removeEventListener('message', responseHandler);
          reject(new Error('Vault response timed out'));
        }, 8000);

        const responseHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'vault-response' || data.type === 'vault-search-response') {
              finished = true;
              clearTimeout(timeout);
              ws?.removeEventListener('message', responseHandler);
              resolve(data);
            } else if (data.type === 'error') {
              finished = true;
              clearTimeout(timeout);
              ws?.removeEventListener('message', responseHandler);
              resolve({ success: false, error: data.error || 'Local vault node error' });
            }
          } catch {}
        };

        ws.addEventListener('message', responseHandler);
        ws.send(JSON.stringify(encrypted));
      } catch (err) {
        reject(err);
      }
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Token management
  if (request.action === 'save-token') {
    chrome.storage.local.set({ bootstrapToken: request.token }, () => {
      if (activeSocket) {
        try { activeSocket.close(); } catch {}
        activeSocket = null;
        sessionKey = null;
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'get-saved-token') {
    chrome.storage.local.get(['bootstrapToken'], ({ bootstrapToken }) => {
      sendResponse({ token: bootstrapToken || null });
    });
    return true;
  }

  if (request.action === 'clear-token') {
    chrome.storage.local.remove(['bootstrapToken'], () => {
      if (activeSocket) {
        try { activeSocket.close(); } catch {}
        activeSocket = null;
        sessionKey = null;
      }
      sendResponse({ success: true });
    });
    return true;
  }

  // Connect check
  if (request.action === 'connect') {
    chrome.storage.local.get(['bootstrapToken'], async ({ bootstrapToken }) => {
      if (!bootstrapToken) {
        sendResponse({ status: 'error', error: 'Bootstrap token is not configured. Paste your token in Settings.' });
        return;
      }
      connect(bootstrapToken)
        .then(() => sendResponse({ status: 'connected' }))
        .catch((error) => sendResponse({ status: 'error', error: error.message }));
    });
    return true;
  }

  // Get password for specific service
  if (request.action === 'get-password' || request.action === 'fetch-credential') {
    sendVaultRequest({ type: 'get-password', serviceName: request.serviceName })
      .then((data) => sendResponse({
        success: Boolean(data.password || data.username),
        password: data.password || '',
        username: data.username || '',
        error: data.error
      }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Search vault
  if (request.action === 'search-vault') {
    sendVaultRequest({ type: 'search-vault', query: request.query })
      .then((data) => sendResponse({ success: true, entries: data.entries || [] }))
      .catch((err) => sendResponse({ success: false, entries: [], error: err.message }));
    return true;
  }

  // Autofill current active tab
  if (request.action === 'autofill-current') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url) {
        sendResponse({ success: false, error: 'No active web page' });
        return;
      }
      try {
        const url = new URL(activeTab.url);
        const hostname = url.hostname.replace(/^www\./, '');
        const data = await sendVaultRequest({ type: 'get-password', serviceName: hostname });
        if (!data.password && !data.username) {
          sendResponse({ success: false, error: `No credentials found for ${hostname}` });
          return;
        }
        chrome.tabs.sendMessage(activeTab.id, {
          action: 'fill-credentials',
          serviceName: hostname,
          password: data.password || '',
          username: data.username || ''
        }, (res) => {
          sendResponse({ success: true, serviceName: hostname });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  return false;
});
