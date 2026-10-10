const RELAY_URL = 'ws://127.0.0.1:46123';
let socket;
let sessionKey;

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

async function connect(token) {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    socket = new WebSocket(RELAY_URL);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'extension-auth', token }));
      sessionKey = token.tokenId;
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'extension-authenticated') resolve();
      if (message.type === 'error') reject(new Error(message.error));
    });
    socket.addEventListener('error', () => reject(new Error('NexVault desktop app is unavailable')));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'connect') {
    chrome.storage.local.get(['bootstrapToken'], async ({ bootstrapToken }) => {
      if (!bootstrapToken) {
        sendResponse({ status: 'error', error: 'Bootstrap token is not configured' });
        return;
      }
      connect(bootstrapToken)
      .then(() => {
        return encryptMessage({ type: 'extension-connect', peerId: request.peerId || null });
      })
      .then((encrypted) => {
        socket.send(JSON.stringify(encrypted));
        sendResponse({ status: 'connected' });
      })
      .catch((error) => sendResponse({ status: 'error', error: error.message }));
    });
    return true;
  }

  if (request.action === 'get-password') {
    chrome.storage.local.get(['bootstrapToken'], async ({ bootstrapToken }) => {
      if (!bootstrapToken) {
        sendResponse({ success: false, error: 'No bootstrap token configured' });
        return;
      }
      try {
        await connect(bootstrapToken);
        const encrypted = await encryptMessage({
          type: 'get-password',
          serviceName: request.serviceName
        });
        socket.send(JSON.stringify(encrypted));
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'vault-response') {
            socket.removeEventListener('message', handler);
            sendResponse({ success: true, password: data.password });
          }
        };
        socket.addEventListener('message', handler);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true;
  }

  return false;
});
