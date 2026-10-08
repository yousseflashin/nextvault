const status = document.getElementById('status');
const connectButton = document.getElementById('connect');
const tokenButton = document.createElement('button');
tokenButton.type = 'button';
tokenButton.textContent = 'Set bootstrap token';
tokenButton.addEventListener('click', () => {
  try {
    const token = JSON.parse(prompt('Paste bootstrap token JSON:'));
    chrome.storage.local.set({ bootstrapToken: token });
    status.textContent = 'Bootstrap token saved';
  } catch {
    status.textContent = 'Invalid token JSON';
  }
});
document.body.insertBefore(tokenButton, connectButton);

connectButton.addEventListener('click', async () => {
  status.textContent = 'Connecting...';
  const response = await chrome.runtime.sendMessage({ action: 'connect' });
  if (chrome.runtime.lastError) {
    status.textContent = chrome.runtime.lastError.message;
    return;
  }
  status.textContent = response.status === 'connected'
    ? 'Connected to NexVault'
    : response.error;
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