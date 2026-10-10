const { nexVault } = window;

let statusEl = document.getElementById('status');

function updateStatus(msg) {
  statusEl.textContent = 'Status: ' + msg;
  console.log(msg);
}

async function handleNewUser() {
  const username = prompt('Choose a username:');
  const password = prompt('Choose a master password:');
  if (!username || !password) return;

  updateStatus('Generating new token...');
  
  try {
    const result = await nexVault.initializeNewUser(username, password);
    if (!result.success) throw new Error(result.error);
    updateStatus('Token generated: ' + result.tokenId);
    alert(JSON.stringify(result.bootstrapToken));
  } catch (err) {
    updateStatus('Error: ' + err.message);
  }
}

async function handleExistingUser() {
  const tokenInput = prompt('Paste your bootstrap token JSON:');
  const password = prompt('Enter your master password:');
  if (!tokenInput || !password) return;
  
  updateStatus('Validating token...');
  
  try {
    const token = JSON.parse(tokenInput);
    const result = await nexVault.initializeExistingUser(
      token.tokenId,
      token.publicKey,
      token.signature,
      password,
      token.expiresAt
    );
    if (!result.success) throw new Error(result.error);
    updateStatus('Token validated: ' + result.tokenId);
  } catch (err) {
    updateStatus('Error: ' + err.message);
  }
}

async function startGrid() {
  updateStatus('Starting NexGrid...');
  const result = await nexVault.startNexGrid();
  updateStatus(result.success ? 'NexGrid started - waiting for peers...' : 'Error: ' + result.error);
}

async function savePassword() {
  const result = await nexVault.addPassword(
    document.getElementById('service').value,
    document.getElementById('vault-password').value
  );
  updateStatus(result.success ? 'Password saved locally' : 'Error: ' + result.error);
}

async function readPassword() {
  const result = await nexVault.getPassword(document.getElementById('service').value);
  updateStatus(result.success ? 'Password: ' + result.password : 'Error: ' + result.error);
}

async function saveOtp() {
  const result = await nexVault.addOtpSecret('TOTP', document.getElementById('otp-secret').value);
  updateStatus(result.success ? 'OTP secret saved locally' : 'Error: ' + result.error);
}

async function readOtp() {
  const result = await nexVault.getOtpCode('TOTP');
  updateStatus(result.success ? 'Current OTP: ' + result.code : 'Error: ' + result.error);
}

// Listen for peer data
nexVault.onPeerData((data) => {
  updateStatus('Received: ' + JSON.stringify(data));
});

nexVault.onPeerRequestsApproval((peerId, duration) => {
  if (confirm(`Peer ${peerId} requested to extend their offline window for ${duration}. Approve?`)) {
    nexVault.approveExtension(peerId).then(res => {
      updateStatus(res.success ? 'Approval sent' : 'Failed to send approval: ' + res.error);
    });
  }
});

nexVault.onBroadcastApprovalRequest(async (duration) => {
  updateStatus(`Sent request to peers to approve ${duration} extension. Waiting for replies...`);
  // Will need to broadcast this across all active connections
  // (In a real UI this would send an IPC message that iterates connections and sends `extension-approval-request`)
});

nexVault.onExtensionApproved((duration) => {
  updateStatus(`Extension for ${duration} was approved by a peer.`);
});

updateStatus('Ready');