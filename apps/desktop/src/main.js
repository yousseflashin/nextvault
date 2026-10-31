const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { NexVaultToken, NexVaultCrypto, NexVaultSecurity, NexGrid, NexVaultDatabase, generateTotp } = require('@nexvault/core');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

let mainWindow;
let nexVaultSecurity = new NexVaultSecurity(app.getPath('userData'));
let nexGrid = new NexGrid();
let nexVaultDatabase = new NexVaultDatabase(app.getPath('userData'));
let extensionServer;
const relayClients = new Map();
const pendingPairingRequests = new Map();
let activePairingCode = null;
const trustedPeers = new Set();

function approvePairing(peerId, publicKey, deviceName) {
  trustedPeers.add(peerId);
  if (publicKey) trustedPeers.add(publicKey);
  nexGrid.setPeerPublicKey(peerId, publicKey);

  if (nexVaultSecurity.ledger) {
    nexVaultSecurity.ledger.append('device-paired', { peerId, deviceName: deviceName || 'Mobile' });
  }

  nexGrid.sendRelaySignal(peerId, {
    type: 'pair-approved',
    fromDeviceId: nexGrid.deviceId,
    fromDeviceName: 'NexVault Desktop',
    publicKey: nexGrid.localKeyPairs.get(nexGrid.deviceId)?.publicKey
  });

  // Automatically sync vault to the newly paired peer
  syncVaultToPeer(peerId);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peer-paired', { peerId, deviceName: deviceName || 'Mobile' });
  }
}

function syncVaultToPeer(peerId) {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) return;
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return;
    const passwords = nexVaultDatabase.listPasswords(user.id);
    const otps = nexVaultDatabase.listOTPs(user.id);

    const decryptedPasswords = passwords.map(p => {
      const full = nexVaultDatabase.getPassword(user.id, p.service);
      if (!full) return p;
      const decrypted = nexVaultDatabase.decrypt(full.credential_blob, context.encryptionKey, full.nonce);
      return { service: p.service, username: p.username || '', credential: decrypted, createdAt: p.created_at };
    });

    const decryptedOtps = otps.map(o => {
      const full = nexVaultDatabase.getOTP(user.id, o.service);
      if (!full) return o;
      const decrypted = nexVaultDatabase.decrypt(full.secret_blob, context.encryptionKey, full.nonce);
      return { service: o.service, secret: decrypted, createdAt: o.created_at };
    });

    nexGrid.sendSecureMessage(peerId, {
      type: 'vault-sync',
      vaultData: {
        passwords: decryptedPasswords,
        otps: decryptedOtps,
        timestamp: Date.now()
      }
    });
    console.log(`[Desktop] Vault synchronized to paired peer: ${peerId}`);
  } catch (err) {
    console.error('[Desktop] Error syncing vault to peer:', err);
  }
}

nexGrid.on('peer-disconnected', (peerId) => {
  nexVaultSecurity.startSecurityCountdown();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security-countdown-started', nexVaultSecurity.getSecurityStatus());
    mainWindow.webContents.send('peer-disconnected', peerId);
  }
});

nexGrid.on('peer-connected', (peerId) => {
  nexVaultSecurity.resetCountdown();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security-countdown-stopped');
    mainWindow.webContents.send('peer-connected', peerId);
  }
});

nexGrid.on('peer-joined', (peer) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peer-joined', peer);
  }
});

nexGrid.on('pair-request', ({ from, deviceName, publicKey, code }) => {
  console.log(`[Desktop] Received pair request from ${deviceName} (${from})`);
  if (activePairingCode && code && activePairingCode.code === String(code).trim() && Date.now() < activePairingCode.expiresAt) {
    console.log('[Desktop] Code match! Auto-approving pairing.');
    approvePairing(from, publicKey, deviceName);
    return;
  }

  pendingPairingRequests.set(from, { peerId: from, deviceName, publicKey, timestamp: Date.now() });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('incoming-pair-request', { peerId: from, deviceName, publicKey });
  }
});

nexGrid.on('vault-sync-received', (fromPeerId, vaultData) => {
  console.log(`[Desktop] Received vault-sync from ${fromPeerId}`);
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context || !vaultData) return;
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return;

    if (Array.isArray(vaultData.passwords)) {
      for (const p of vaultData.passwords) {
        if (p.service && p.credential) {
          nexVaultDatabase.addPassword(user.id, p.service, p.credential, context.encryptionKey, p.username || '');
        }
      }
    }
    if (Array.isArray(vaultData.otps)) {
      for (const o of vaultData.otps) {
        if (o.service && o.secret) {
          nexVaultDatabase.addOTP(user.id, o.service, o.secret, context.encryptionKey);
        }
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault-updated');
    }
  } catch (err) {
    console.error('[Desktop] Failed to apply vault-sync:', err);
  }
});

nexGrid.on('secure-message', (peerId, message) => {
  if (message.type === 'extension-approval-request') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peer-requests-approval', { peerId, duration: message.duration });
    }
  } else if (message.type === 'extension-approval') {
    nexVaultSecurity.handlePeerApproval(message.publicKey);
  } else if (message.type === 'vault-sync') {
    // Handled by vault-sync-received
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('secure-message-received', { peerId, message });
  }
});

function startExtensionServer() {
  const extensionPort = Number(process.env.NEXVAULT_EXTENSION_PORT || 46124);
  try {
    extensionServer = new WebSocketServer({ port: extensionPort });
    extensionServer.on('error', (err) => {
      console.error('[Desktop] Extension server error:', err.message);
    });
    extensionServer.on('listening', () => {
      console.log(`[Desktop] Extension server listening on port ${extensionPort}`);
    });
  } catch (err) {
    console.error('[Desktop] Failed to start extension server:', err.message);
    return;
  }
  extensionServer.on('connection', (socket) => {
    let sessionKey = null;
    let deviceSession = null;
    socket.on('message', (rawMessage) => {
      try {
        const envelope = JSON.parse(rawMessage.toString());
        if (!sessionKey && !deviceSession) {
          if (envelope.type === 'device-auth') {
            const token = envelope.token;
            if (!token || !token.expiresAt || Date.now() >= new Date(token.expiresAt).getTime() ||
                !NexVaultToken.verify(token.tokenId, token.signature, token.publicKey)) {
              throw new Error('Invalid device token');
            }
            deviceSession = {
              tokenId: token.tokenId,
              deviceId: envelope.deviceId,
              publicKey: envelope.publicKey,
              socket
            };
            if (!relayClients.has(token.tokenId)) relayClients.set(token.tokenId, new Map());
            relayClients.get(token.tokenId).set(deviceSession.deviceId, deviceSession);
            const peers = [...relayClients.get(token.tokenId).values()]
              .filter((peer) => peer.deviceId !== deviceSession.deviceId)
              .map(({ deviceId, publicKey }) => ({ deviceId, publicKey }));
            socket.send(JSON.stringify({ type: 'peer-list', peers }));
            for (const peer of relayClients.get(token.tokenId).values()) {
              if (peer.deviceId !== deviceSession.deviceId) {
                peer.socket.send(JSON.stringify({
                  type: 'peer-joined',
                  peer: { deviceId: deviceSession.deviceId, publicKey: deviceSession.publicKey }
                }));
              }
            }
            return;
          }
          if (envelope.type !== 'extension-auth') throw new Error('Extension authentication required');
          const token = envelope.token;
            if (!token || !nexVaultSecurity.verifyTokenAuthorization(token.tokenId) ||
              !NexVaultToken.verify(token.tokenId, token.signature, token.publicKey) ||
              !token.expiresAt || Date.now() >= new Date(token.expiresAt).getTime()) {
            throw new Error('Invalid extension token');
          }
          sessionKey = crypto.createHash('sha256').update(token.tokenId).digest();
          socket.send(JSON.stringify({ type: 'extension-authenticated' }));
          return;
        }
        if (sessionKey) { // Handle extension encrypted messages
          try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, Buffer.from(envelope.iv, 'base64'));
            decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            let decrypted = decipher.update(Buffer.from(envelope.data, 'base64'), null, 'utf8');
            decrypted += decipher.final('utf8');
            const message = JSON.parse(decrypted);

            if (message.type === 'get-password') {
              const context = nexVaultSecurity.getUserContext();
              if (!context) {
                socket.send(JSON.stringify({
                  type: 'vault-response',
                  success: false,
                  error: 'Desktop vault is locked. Please unlock NexVault Desktop app.'
                }));
                return;
              }
              const user = nexVaultDatabase.getUser(context.username);
              if (!user) {
                socket.send(JSON.stringify({
                  type: 'vault-response',
                  success: false,
                  error: 'User not found in desktop vault'
                }));
                return;
              }
              const result = nexVaultDatabase.getPassword(user.id, message.serviceName);
              if (result) {
                try {
                  const password = nexVaultDatabase.decryptData(result.encrypted_data, context.encryptionKey, result.iv);
                  socket.send(JSON.stringify({
                    type: 'vault-response',
                    success: true,
                    password,
                    username: result.username || ''
                  }));
                } catch (decErr) {
                  socket.send(JSON.stringify({
                    type: 'vault-response',
                    success: false,
                    error: 'Decryption error for ' + message.serviceName
                  }));
                }
              } else {
                socket.send(JSON.stringify({ type: 'vault-response', success: false, error: 'No credentials found for ' + message.serviceName }));
              }
              return;
            }

            if (message.type === 'search-vault') {
              const context = nexVaultSecurity.getUserContext();
              if (!context) {
                socket.send(JSON.stringify({
                  type: 'vault-search-response',
                  success: false,
                  entries: [],
                  error: 'Desktop vault is locked. Please unlock NexVault Desktop app.'
                }));
                return;
              }
              const user = nexVaultDatabase.getUser(context.username);
              if (!user) {
                socket.send(JSON.stringify({
                  type: 'vault-search-response',
                  success: false,
                  entries: [],
                  error: 'User not found in desktop vault'
                }));
                return;
              }
              const q = (message.query || '').toLowerCase();
              const all = nexVaultDatabase.listPasswords(user.id);
              const entries = all.filter(e => e.service.toLowerCase().includes(q));
              socket.send(JSON.stringify({ type: 'vault-search-response', success: true, entries }));
              return;
            }
          } catch (e) {
            console.error('Extension message error', e);
            socket.send(JSON.stringify({
              type: 'vault-response',
              success: false,
              error: e.message || 'Error processing vault request'
            }));
            return;
          }
        }
        if (deviceSession) {
          if (envelope.type === 'peer-discover') {
            const peers = [...(relayClients.get(envelope.tokenId) || new Map()).values()]
              .filter((peer) => peer.deviceId !== deviceSession.deviceId)
              .map(({ deviceId, publicKey }) => ({ deviceId, publicKey }));
            socket.send(JSON.stringify({ type: 'peer-list', peers }));
            return;
          }
          if (envelope.type === 'signal') {
            const peer = relayClients.get(deviceSession.tokenId)?.get(envelope.to);
            if (peer) peer.socket.send(JSON.stringify({
              type: 'signal',
              from: deviceSession.deviceId,
              payload: envelope.payload
            }));
            return;
          }
          return;
        }
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          sessionKey,
          Buffer.from(envelope.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        const message = JSON.parse(Buffer.concat([
          decipher.update(Buffer.from(envelope.data, 'base64')),
          decipher.final()
        ]).toString('utf8'));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension-message', message);
        }
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', error: error.message || 'Invalid message' }));
      }
    });
    socket.on('close', () => {
      if (!deviceSession) return;
      const peers = relayClients.get(deviceSession.tokenId);
      peers?.delete(deviceSession.deviceId);
      if (peers?.size === 0) relayClients.delete(deviceSession.tokenId);
    });
  });
}

// IPC handlers for renderer-process communication
ipcMain.handle('initialize-new-user', async (event, username, password) => {
  try {
    const result = nexVaultSecurity.initializeNewUser(username, password);
    nexVaultDatabase.createUser(
      username,
      nexVaultDatabase.hashPassword(password),
      result.bootstrapToken
    );
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('initialize-existing-user', async (event, tokenId, publicKey, signature, password, expiresAt) => {
  try {
    const result = await nexVaultSecurity.initializeExistingUser(tokenId, publicKey, signature, password, expiresAt);
    const context = nexVaultSecurity.getUserContext();
    nexVaultDatabase.createUser(context.username, nexVaultDatabase.hashPassword(password), { publicKey, signature });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('authenticate-user', async (event, username, password) => {
  try {
    const result = nexVaultSecurity.authenticate(username, password);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-vault-profile', async () => {
  try {
    const username = nexVaultSecurity.store.get('user.username');
    const bootstrapToken = nexVaultSecurity.store.get('user.bootstrapToken');
    return {
      success: true,
      hasUser: Boolean(username && bootstrapToken),
      username: username || '',
      bootstrapToken: bootstrapToken || null
    };
  } catch (error) {
    return { success: false, hasUser: false, error: error.message };
  }
});

ipcMain.handle('get-token', async () => {
  return nexVaultSecurity.getToken();
});

ipcMain.handle('start-nex-grid', async (event, customRelayUrl) => {
  try {
    const token = nexVaultSecurity.getToken();
    if (token && token.publicKey) {
      if (customRelayUrl && typeof customRelayUrl === 'string' && customRelayUrl.trim()) {
        nexGrid.relayUrl = customRelayUrl.trim();
      }
      nexGrid.deviceName = 'NexVault Desktop';
      const peers = await nexGrid.discoverPeers(token);
      return { success: true, peers, deviceId: nexGrid.deviceId };
    }
    return { success: false, error: 'No token available' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('connect-peer', async (event, peerId) => {
  try {
    const connection = await nexGrid.connectToPeer(peerId);
    return { success: true, ...connection };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('accept-connection', async (event, peerId) => {
  try {
    const connection = await nexGrid.acceptConnection(peerId);
    return { success: true, ...connection };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-secure-message', async (event, peerId, message) => {
  try {
    nexGrid.sendSecureMessage(peerId, message);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-peer-public-key', async (event, peerId, publicKey) => {
  try {
    nexGrid.setPeerPublicKey(peerId, publicKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-password', async (event, serviceName, password, username = '') => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    nexVaultDatabase.addPassword(user.id, serviceName, password, context.encryptionKey, username);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-passwords', async () => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) return { success: true, entries: [] };
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return { success: true, entries: [] };
    const entries = nexVaultDatabase.listPasswords(user.id);
    return { success: true, entries };
  } catch (error) {
    return { success: false, error: error.message, entries: [] };
  }
});

ipcMain.handle('delete-password', async (event, serviceName) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    nexVaultDatabase.deletePassword(user.id, serviceName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-password', async (event, serviceName) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    
    const result = nexVaultDatabase.getPassword(user.id, serviceName);
    if (!result) return { success: false, error: 'Password not found' };
    
    const decrypted = nexVaultDatabase.decryptData(
      result.encrypted_data,
      context.encryptionKey,
      result.iv
    );
    return { success: true, password: decrypted, username: result.username || '' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-otp', async (event, serviceName, secret) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    nexVaultDatabase.addOtpSecret(user.id, serviceName, 'TOTP', secret, context.encryptionKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-otps', async () => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) return { success: true, entries: [] };
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return { success: true, entries: [] };
    const entries = nexVaultDatabase.listOtpSecrets(user.id);
    return { success: true, entries };
  } catch (error) {
    return { success: false, error: error.message, entries: [] };
  }
});

ipcMain.handle('get-otp', async (event, serviceName) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const result = nexVaultDatabase.getOtpSecretByService(user.id, serviceName);
    if (!result) return { success: false, error: 'OTP secret not found' };
    const secret = nexVaultDatabase.decryptData(result.encrypted_data, context.encryptionKey, result.iv);
    return { success: true, code: generateTotp(secret), period: 30 };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-otp', async (event, serviceName) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    nexVaultDatabase.deleteOtpSecret(user.id, serviceName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-otp-secret', async (event, otpType, secret) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    nexVaultDatabase.addOtpSecret(user.id, otpType, secret, context.encryptionKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-otp-secret', async (event, otpType) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const result = nexVaultDatabase.getOtpSecretByType(user.id, otpType);
    if (!result) return { success: false, error: 'OTP secret not found' };
    const secret = nexVaultDatabase.decryptData(
      result.encrypted_data,
      context.encryptionKey,
      result.iv
    );
    return { success: true, secret, otpType: result.otp_type };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-otp-code', async (event, otpType) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    const result = nexVaultDatabase.getOtpSecretByType(user.id, otpType);
    if (!result) return { success: false, error: 'OTP secret not found' };
    const secret = nexVaultDatabase.decryptData(result.encrypted_data, context.encryptionKey, result.iv);
    return { success: true, code: generateTotp(secret), period: 30 };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-security-status', async () => {
  return nexVaultSecurity.getSecurityStatus();
});

ipcMain.handle('extend-security-window', async (event, duration) => {
  try {
    const result = await nexVaultSecurity.extendSecurityWindow(duration);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('approve-extension', async (event, peerId) => {
  try {
    nexGrid.sendSecureMessage(peerId, { type: 'extension-approval', publicKey: nexVaultSecurity.getToken().publicKey });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('nuke', async () => {
  try {
    nexVaultSecurity.triggerNuke();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('authorize-token', async (event, token) => {
  try {
    return nexVaultSecurity.authorizeToken(token);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-trust-history', async () => ({
  valid: nexVaultSecurity.verifyTrustHistory(),
  events: nexVaultSecurity.getTrustHistory()
}));

ipcMain.handle('start-security-countdown', async () => {
  nexVaultSecurity.startSecurityCountdown();
  return nexVaultSecurity.getSecurityStatus();
});

ipcMain.handle('stop-security-countdown', async () => {
  nexVaultSecurity.resetCountdown();
  return nexVaultSecurity.getSecurityStatus();
});

ipcMain.handle('check-integrity', async () => {
  return nexVaultSecurity.checkIntegrity();
});

ipcMain.handle('run-integrity-check', async () => {
  return nexVaultSecurity.checkIntegrity();
});

ipcMain.handle('trigger-emergency-nuke', async () => {
  try {
    nexVaultSecurity.triggerNuke();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-nex-grid', async () => {
  try {
    nexGrid.closeAll();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('request-pairing-code', async () => {
  try {
    const token = nexVaultSecurity.getToken();
    if (!token) throw new Error('No identity token found');
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    activePairingCode = {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    };
    return { success: true, code, tokenId: token.tokenId, expiresAt: activePairingCode.expiresAt };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('approve-pair-request', async (event, peerId) => {
  try {
    const pending = pendingPairingRequests.get(peerId);
    if (!pending) return { success: false, error: 'No pending pairing request found for peer ' + peerId };
    approvePairing(peerId, pending.publicKey, pending.deviceName);
    pendingPairingRequests.delete(peerId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reject-pair-request', async (event, peerId) => {
  try {
    pendingPairingRequests.delete(peerId);
    nexGrid.sendRelaySignal(peerId, { type: 'pair-rejected', reason: 'Declined by desktop user' });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync-vault-to-peers', async () => {
  try {
    for (const peerId of trustedPeers) {
      syncVaultToPeer(peerId);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-tamper-monitor', async () => {
  try {
    const result = nexVaultSecurity.checkIntegrity();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-integrity-status', async () => {
  return nexVaultSecurity.integrity.status();
});

// Window management
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  // Run startup integrity check safely
  try {
    nexVaultSecurity.checkIntegrity();
  } catch (err) {
    console.error('Integrity check startup warning:', err);
  }
  startExtensionServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle application quit
app.on('before-quit', () => {
  // Clean up resources
  nexGrid.closeAll();
  if (extensionServer) extensionServer.close();
});