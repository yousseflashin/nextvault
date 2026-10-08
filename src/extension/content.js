/**
 * content.js - Browser extension content script
 *
 * Connects to the extension background script via chrome.runtime.sendMessage
 * and provides password/OTP autofill services to webpages.
 *
 * Communication flow:
 *   1. Content script connects on startup (document_idle)
 *   2. Background connects to the local NexVault desktop app
 *   3. Content asks the desktop app for stored credentials
 *   4. Content fills autofill-compatible fields on the page
 */

let isConnected = false;

async function connect() {
  const result = await chrome.runtime.sendMessage({ action: 'connect' });
  if (chrome.runtime.lastError) {
    showStatus('Error: ' + chrome.runtime.lastError.message);
    return false;
  }
  isConnected = result.status === 'connected';
  showStatus(isConnected ? 'Connected to NexVault' : (result.error || 'Disconnected'));
  return isConnected;
}

function showStatus(msg) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = msg;
}

function fillPassword(fieldId, password) {
  if (!isConnected) return false;

  const field = document.querySelector(`#${fieldId}`);
  if (!field) return false;

  try {
    field.value = password;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    showToast('Password filled');
    return true;
  } catch (e) {
    console.error('Autofill error:', e);
    return false;
  }
}

function showToast(msg) {
  // Remove any existing toast
  const old = document.querySelector('.nexvault-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = 'nexvault-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'autofill-password') {
    fillPassword(request.fieldId, request.password);
  }
  if (request.type === 'get-secrets') {
    // Respond with secrets from the desktop vault
    chrome.storage.local.get(['bootstrapToken'], async ({ bootstrapToken }) => {
      if (!bootstrapToken) {
        sendResponse({ error: 'No bootstrap token configured' });
        return;
      }
      // Ask the desktop app for the credential
      chrome.runtime.sendMessage({
        action: 'get-password',
        serviceName: request.serviceName,
        token: bootstrapToken
      }, resp => {
        sendResponse(resp);
      });
    });
    return true; // async response
  }
});