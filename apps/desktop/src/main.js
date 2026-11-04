const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { NexVaultToken, NexVaultCrypto, NexVaultSecurity, NexGrid, NexVaultDatabase, generateTotp, parseBulkImport, parseOtpAuthUri } = require('@nexvault/core');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { setupLinuxDesktopIntegration } = require('./linuxIntegration');
const { setupBrowserExtensionIntegration } = require('./browserExtensionIntegration');

function loadDesktopDotenv() {
  const envCandidates = [
    path.join(__dirname, '..', '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '..', '.env.dev'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env.dev')
  ];
  for (const envFile of envCandidates) {
    if (!fs.existsSync(envFile)) continue;
    try {
      const content = fs.readFileSync(envFile, 'utf8');
      for (const rawLine of content.split('\n')) {
        let line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('export ')) line = line.slice(7).trim();
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    } catch {}
  }
}
loadDesktopDotenv();

// Single instance lock for Linux & Desktop: focus existing window on duplicate launch
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[Desktop] Another NexVault instance is already active. Quitting duplicate.');
  app.quit();
  process.exit(0);
}

let mainWindow;
let nexVaultSecurity = new NexVaultSecurity(app.getPath('userData'));
let nexGrid = new NexGrid();
try {
  const savedRelay = nexVaultSecurity.store.get('settings.relayUrl');
  if (savedRelay && typeof savedRelay === 'string' && savedRelay.trim()) {
    nexGrid.relayUrl = savedRelay.trim();
  }
} catch {}
let nexVaultDatabase = new NexVaultDatabase(app.getPath('userData'));
let extensionServer;
const relayClients = new Map();
const pendingPairingRequests = new Map();
let activePairingCode = null;
const trustedPeers = new Set();

const CURRENT_VERSION = (function() {
  try {
    return app?.getVersion ? (app.getVersion() || '0.1.9') : '0.1.9';
  } catch {
    return '0.1.9';
  }
})();
const GITHUB_REPO = 'yousseflashin/nextvault';

// Persistent trusted devices management
function getTrustedDevices() {
  try {
    return nexVaultSecurity.store.get('security.trustedDevices', []) || [];
  } catch {
    return [];
  }
}

function isDeviceTrusted(deviceId, publicKey) {
  const list = getTrustedDevices();
  return list.some(d => (deviceId && d.deviceId === deviceId) || (publicKey && d.publicKey === publicKey));
}

function saveTrustedDevice({ deviceId, publicKey, deviceName }) {
  try {
    const list = getTrustedDevices();
    const idx = list.findIndex(d => (deviceId && d.deviceId === deviceId) || (publicKey && d.publicKey === publicKey));
    const entry = {
      deviceId,
      publicKey: publicKey || (idx >= 0 ? list[idx].publicKey : null),
      deviceName: deviceName || (idx >= 0 ? list[idx].deviceName : 'NexVault Device'),
      pairedAt: idx >= 0 ? list[idx].pairedAt : new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    nexVaultSecurity.store.set('security.trustedDevices', list);
    trustedPeers.add(deviceId);
    if (publicKey) trustedPeers.add(publicKey);
    return entry;
  } catch (err) {
    console.error('[Desktop] Failed to save trusted device:', err);
  }
}

function removeTrustedDevice(deviceId) {
  try {
    let list = getTrustedDevices();
    list = list.filter(d => d.deviceId !== deviceId);
    nexVaultSecurity.store.set('security.trustedDevices', list);
    trustedPeers.delete(deviceId);
    return true;
  } catch (err) {
    console.error('[Desktop] Failed to remove trusted device:', err);
    return false;
  }
}

function loadStoredTrustedPeers() {
  const stored = getTrustedDevices();
  for (const dev of stored) {
    if (dev.deviceId) trustedPeers.add(dev.deviceId);
    if (dev.publicKey) {
      trustedPeers.add(dev.publicKey);
      nexGrid.setPeerPublicKey(dev.deviceId, dev.publicKey);
    }
  }
  console.log(`[Desktop] Loaded ${stored.length} persistent trusted device(s).`);
}

loadStoredTrustedPeers();

function approvePairing(peerId, publicKey, deviceName) {
  saveTrustedDevice({ deviceId: peerId, publicKey, deviceName });
  nexGrid.setPeerPublicKey(peerId, publicKey);

  if (nexVaultSecurity.ledger) {
    nexVaultSecurity.ledger.append('device-paired', { peerId, deviceName: deviceName || 'Mesh Peer' });
  }

  nexGrid.sendRelaySignal(peerId, {
    type: 'pair-approved',
    fromDeviceId: nexGrid.deviceId,
    fromDeviceName: 'NextVault Desktop Mesh Node',
    publicKey: nexGrid.localKeyPairs.get(nexGrid.deviceId)?.publicKey
  });

  // Automatically sync vault to the newly paired peer
  syncVaultToPeer(peerId);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peer-paired', { peerId, deviceName: deviceName || 'Mesh Peer' });
  }
}

function syncVaultToPeer(peerId, options = {}) {
  try {
    if (!peerId) return;
    const context = nexVaultSecurity.getUserContext();
    if (!context) {
      console.warn(`[Desktop] syncVaultToPeer: User not authenticated / vault locked.`);
      return;
    }
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) {
      console.warn(`[Desktop] syncVaultToPeer: User "${context.username}" not found.`);
      return;
    }

    // Ensure remote public key is registered in nexGrid
    const trustedList = getTrustedDevices();
    const matchedDev = trustedList.find(d => d.deviceId === peerId);
    if (matchedDev?.publicKey) {
      nexGrid.setPeerPublicKey(peerId, matchedDev.publicKey);
    }

    // Safely retrieve and decrypt all passwords with updatedAt
    const rawPasswords = nexVaultDatabase.getPasswords(user.id) || [];
    const decryptedPasswords = [];
    for (const p of rawPasswords) {
      try {
        const credential = nexVaultDatabase.decryptData(p.encrypted_data, context.encryptionKey, p.iv);
        decryptedPasswords.push({
          service: p.service_name,
          username: p.username || '',
          credential,
          createdAt: p.created_at,
          updatedAt: Number(p.updated_at) || (p.created_at ? new Date(p.created_at).getTime() : Date.now())
        });
      } catch (err) {
        console.error(`[Desktop] Error decrypting password for ${p.service_name}:`, err.message);
      }
    }

    // Safely retrieve and decrypt all OTP secrets with updatedAt
    const rawOtps = nexVaultDatabase.getOtpSecrets(user.id) || [];
    const decryptedOtps = [];
    for (const o of rawOtps) {
      try {
        const secret = nexVaultDatabase.decryptData(o.encrypted_data, context.encryptionKey, o.iv);
        decryptedOtps.push({
          service: o.service_name,
          secret,
          createdAt: o.created_at,
          updatedAt: Number(o.updated_at) || (o.created_at ? new Date(o.created_at).getTime() : Date.now())
        });
      } catch (err) {
        console.error(`[Desktop] Error decrypting OTP for ${o.service_name}:`, err.message);
      }
    }

    const deletedRecords = nexVaultDatabase.getDeletedRecords(user.id) || [];

    nexGrid.sendSecureMessage(peerId, {
      type: 'vault-sync',
      vaultData: {
        passwords: decryptedPasswords,
        otps: decryptedOtps,
        deleted: deletedRecords,
        timestamp: Date.now(),
        isReply: Boolean(options?.isReply)
      }
    });
    console.log(`[Desktop] Successfully synchronized vault (${decryptedPasswords.length} passwords, ${decryptedOtps.length} OTPs, ${deletedRecords.length} tombstones, isReply=${Boolean(options?.isReply)}) to peer: ${peerId}`);
  } catch (err) {
    console.error(`[Desktop] Error syncing vault to peer "${peerId}":`, err);
  }
}

function broadcastCredentialDeleted(itemType, service, deletedAt = Date.now()) {
  try {
    const targetPeerIds = new Set();
    const list = getTrustedDevices();
    for (const d of list) {
      if (d.deviceId) targetPeerIds.add(d.deviceId);
    }
    for (const p of trustedPeers) {
      if (p && typeof p === 'string' && !p.includes('=') && !p.includes('/')) {
        targetPeerIds.add(p);
      }
    }
    if (nexGrid.connectedRelayPeers) {
      for (const [peerId] of nexGrid.connectedRelayPeers.entries()) {
        if (peerId && peerId !== nexGrid.deviceId) {
          targetPeerIds.add(peerId);
        }
      }
    }
    const effectiveDeletedAt = Number(deletedAt) || Date.now();
    for (const pid of targetPeerIds) {
      try {
        nexGrid.sendSecureMessage(pid, {
          type: 'credential-deleted',
          itemType,
          service,
          deletedAt: effectiveDeletedAt,
          timestamp: effectiveDeletedAt
        });
      } catch (err) {
        console.warn(`[Desktop] Failed to send credential-deleted to peer ${pid}:`, err.message);
      }
    }

    // Also broadcast to entire authenticated room via relay so any connected peer receives it immediately
    if (nexGrid.relaySocket && nexGrid.relaySocket.readyState === 1) {
      try {
        nexGrid.sendRelaySignal('*', {
          type: 'credential-deleted',
          itemType,
          service,
          deletedAt: effectiveDeletedAt,
          timestamp: effectiveDeletedAt
        });
      } catch (err) {
        console.warn('[Desktop] Failed to broadcast deletion to relay room:', err.message);
      }
    }

    console.log(`[Desktop] Broadcasted deletion of ${itemType} "${service}" to ${targetPeerIds.size} peer(s) + room`);
  } catch (err) {
    console.error('[Desktop] Failed to broadcast deletion:', err);
  }
}

function broadcastVaultToPeers(options = {}) {
  try {
    const targetPeerIds = new Set();
    const list = getTrustedDevices();
    for (const d of list) {
      if (d.deviceId) {
        targetPeerIds.add(d.deviceId);
        if (d.publicKey) nexGrid.setPeerPublicKey(d.deviceId, d.publicKey);
      }
    }
    for (const p of trustedPeers) {
      if (p && typeof p === 'string' && !p.includes('=') && !p.includes('/')) {
        targetPeerIds.add(p);
      }
    }
    // Automatically include all active peers connected in the same authenticated mesh room
    if (nexGrid.connectedRelayPeers) {
      for (const [peerId, peer] of nexGrid.connectedRelayPeers.entries()) {
        if (peerId && peerId !== nexGrid.deviceId) {
          targetPeerIds.add(peerId);
          if (peer.publicKey) nexGrid.setPeerPublicKey(peerId, peer.publicKey);
          trustedPeers.add(peerId);
        }
      }
    }

    for (const pid of targetPeerIds) {
      try {
        syncVaultToPeer(pid, options);
      } catch (err) {
        console.warn(`[Desktop] Failed to sync vault to peer ${pid}:`, err.message);
      }
    }

    // Also broadcast full vault state to all peers in room via relay
    if (nexGrid.relaySocket && nexGrid.relaySocket.readyState === 1) {
      try {
        const context = nexVaultSecurity.getUserContext();
        if (context) {
          const user = nexVaultDatabase.getUser(context.username);
          if (user) {
            const rawPasswords = nexVaultDatabase.getPasswords(user.id) || [];
            const decryptedPasswords = [];
            for (const p of rawPasswords) {
              try {
                const credential = nexVaultDatabase.decryptData(p.encrypted_data, context.encryptionKey, p.iv);
                decryptedPasswords.push({
                  service: p.service_name,
                  username: p.username || '',
                  credential,
                  createdAt: p.created_at,
                  updatedAt: Number(p.updated_at) || (p.created_at ? new Date(p.created_at).getTime() : Date.now())
                });
              } catch {}
            }
            const rawOtps = nexVaultDatabase.getOtpSecrets(user.id) || [];
            const decryptedOtps = [];
            for (const o of rawOtps) {
              try {
                const secret = nexVaultDatabase.decryptData(o.encrypted_data, context.encryptionKey, o.iv);
                decryptedOtps.push({
                  service: o.service_name,
                  secret,
                  createdAt: o.created_at,
                  updatedAt: Number(o.updated_at) || (o.created_at ? new Date(o.created_at).getTime() : Date.now())
                });
              } catch {}
            }
            const deletedRecords = nexVaultDatabase.getDeletedRecords(user.id) || [];
            nexGrid.sendRelaySignal('*', {
              type: 'vault-sync',
              vaultData: {
                passwords: decryptedPasswords,
                otps: decryptedOtps,
                deleted: deletedRecords,
                timestamp: Date.now(),
                isReply: Boolean(options?.isReply)
              }
            });
          }
        }
      } catch (err) {
        console.warn('[Desktop] Failed to broadcast vault to room:', err.message);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault-synced-to-peers', { count: targetPeerIds.size });
    }
  } catch (err) {
    console.error('[Desktop] Failed to broadcast vault update to peers:', err);
  }
}

async function autoStartNexGrid() {
  try {
    const token = nexVaultSecurity.getToken();
    if (token && token.publicKey) {
      const savedRelay = nexVaultSecurity.store.get('settings.relayUrl');
      if (savedRelay && typeof savedRelay === 'string' && savedRelay.trim()) {
        nexGrid.relayUrl = savedRelay.trim();
      }
      nexGrid.deviceName = 'NextVault Desktop Mesh Node';
      console.log(`[Desktop] Auto-connecting NexGrid mesh on ${nexGrid.relayUrl}...`);
      const peers = await nexGrid.discoverPeers(token);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('grid-status', { status: 'connected', relayUrl: nexGrid.relayUrl, peers });
      }
    }
  } catch (err) {
    console.warn('[Desktop] autoStartNexGrid notice:', err.message);
  }
}

nexGrid.on('relay-disconnected', () => {
  console.log('[Desktop] NexGrid disconnected from relay. Auto-reconnecting in 3s...');
  setTimeout(() => {
    autoStartNexGrid();
  }, 3000);
});

nexGrid.on('peer-disconnected', (peerId) => {
  nexVaultSecurity.startSecurityCountdown();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security-countdown-started', nexVaultSecurity.getSecurityStatus());
    mainWindow.webContents.send('peer-disconnected', peerId);
  }
});

nexGrid.on('peer-connected', (peerId) => {
  nexVaultSecurity.resetCountdown();
  if (isDeviceTrusted(peerId) || trustedPeers.has(peerId)) {
    syncVaultToPeer(peerId);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security-countdown-stopped');
    mainWindow.webContents.send('peer-connected', peerId);
  }
});

nexGrid.on('peer-list', (peers) => {
  if (!Array.isArray(peers)) return;
  for (const peer of peers) {
    if (peer.deviceId && peer.deviceId !== nexGrid.deviceId) {
      console.log(`[Desktop] Mesh peer in room: ${peer.deviceName || peer.deviceId}. Registering & syncing.`);
      if (peer.publicKey) {
        nexGrid.setPeerPublicKey(peer.deviceId, peer.publicKey);
        trustedPeers.add(peer.publicKey);
      }
      trustedPeers.add(peer.deviceId);
      saveTrustedDevice({
        deviceId: peer.deviceId,
        publicKey: peer.publicKey,
        deviceName: peer.deviceName || 'Mesh Peer'
      });
      nexGrid.sendRelaySignal(peer.deviceId, {
        type: 'pair-approved',
        fromDeviceId: nexGrid.deviceId,
        fromDeviceName: 'NextVault Desktop Mesh Node',
        publicKey: nexGrid.localKeyPairs.get(nexGrid.deviceId)?.publicKey
      });
      syncVaultToPeer(peer.deviceId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('peer-paired', { peerId: peer.deviceId, deviceName: peer.deviceName || 'Mesh Peer' });
      }
    }
  }
});

nexGrid.on('peer-joined', (peer) => {
  if (peer && peer.deviceId && peer.deviceId !== nexGrid.deviceId) {
    console.log(`[Desktop] Mesh peer joined room: ${peer.deviceName || peer.deviceId}. Registering & syncing.`);
    if (peer.publicKey) {
      nexGrid.setPeerPublicKey(peer.deviceId, peer.publicKey);
      trustedPeers.add(peer.publicKey);
    }
    trustedPeers.add(peer.deviceId);
    saveTrustedDevice({
      deviceId: peer.deviceId,
      publicKey: peer.publicKey,
      deviceName: peer.deviceName || 'Mesh Peer'
    });
    nexGrid.sendRelaySignal(peer.deviceId, {
      type: 'pair-approved',
      fromDeviceId: nexGrid.deviceId,
      fromDeviceName: 'NextVault Desktop Mesh Node',
      publicKey: nexGrid.localKeyPairs.get(nexGrid.deviceId)?.publicKey
    });
    syncVaultToPeer(peer.deviceId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peer-paired', { peerId: peer.deviceId, deviceName: peer.deviceName || 'Mesh Peer' });
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peer-joined', peer);
  }
});

nexGrid.on('pair-request', ({ from, deviceName, publicKey, code }) => {
  console.log(`[Desktop] Received pair request from ${deviceName} (${from})`);
  // All nodes connecting with this vault token share the same root trust
  approvePairing(from, publicKey, deviceName);
});

nexGrid.on('vault-sync-requested', (fromPeerId, payload) => {
  console.log(`[Desktop] Peer ${fromPeerId} requested vault sync.`);
  if (payload?.publicKey) {
    nexGrid.setPeerPublicKey(fromPeerId, payload.publicKey);
    trustedPeers.add(payload.publicKey);
  }
  trustedPeers.add(fromPeerId);
  saveTrustedDevice({
    deviceId: fromPeerId,
    publicKey: payload?.publicKey,
    deviceName: payload?.fromDeviceName || 'Mesh Peer'
  });
  syncVaultToPeer(fromPeerId);
});

nexGrid.on('vault-sync-received', (fromPeerId, vaultData) => {
  console.log(`[Desktop] Received vault-sync from ${fromPeerId} (isReply=${Boolean(vaultData?.isReply)})`);
  try {
    trustedPeers.add(fromPeerId);
    saveTrustedDevice({
      deviceId: fromPeerId,
      deviceName: 'Mesh Peer'
    });
    const context = nexVaultSecurity.getUserContext();
    if (!context || !vaultData) return;
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return;

    let stateChanged = false;

    // 1. Process incoming tombstones / deletions with timestamp
    if (Array.isArray(vaultData.deleted)) {
      for (const d of vaultData.deleted) {
        if (!d || !d.service) continue;
        const remoteDeletedAt = Number(d.deletedAt) || Date.now();
        if (d.type === 'otp') {
          const localOtp = nexVaultDatabase.getOtpSecretByService(user.id, d.service);
          if (localOtp) {
            const localUpdatedAt = Number(localOtp.updated_at) || (localOtp.created_at ? new Date(localOtp.created_at).getTime() : 0);
            if (remoteDeletedAt >= localUpdatedAt) {
              nexVaultDatabase.deleteOtpSecret(user.id, d.service, remoteDeletedAt);
              stateChanged = true;
            }
          } else {
            nexVaultDatabase.recordTombstone(user.id, d.service, 'otp', remoteDeletedAt);
          }
        } else {
          const localPwd = nexVaultDatabase.getPassword(user.id, d.service);
          if (localPwd) {
            const localUpdatedAt = Number(localPwd.updated_at) || (localPwd.created_at ? new Date(localPwd.created_at).getTime() : 0);
            if (remoteDeletedAt >= localUpdatedAt) {
              nexVaultDatabase.deletePassword(user.id, d.service, remoteDeletedAt);
              stateChanged = true;
            }
          } else {
            nexVaultDatabase.recordTombstone(user.id, d.service, 'password', remoteDeletedAt);
          }
        }
      }
    }

    // 2. Process incoming passwords with LWW reconciliation
    if (Array.isArray(vaultData.passwords)) {
      for (const p of vaultData.passwords) {
        if (!p.service || !p.credential) continue;
        const remoteUpdatedAt = Number(p.updatedAt) || (p.createdAt ? new Date(p.createdAt).getTime() : Date.now());
        const tombstone = nexVaultDatabase.getDeletedRecord(user.id, p.service, 'password');
        if (tombstone && Number(tombstone.deleted_at) >= remoteUpdatedAt) {
          continue; // Local deletion is newer than incoming password
        }

        const localPwd = nexVaultDatabase.getPassword(user.id, p.service);
        if (localPwd) {
          const localUpdatedAt = Number(localPwd.updated_at) || (localPwd.created_at ? new Date(localPwd.created_at).getTime() : 0);
          if (remoteUpdatedAt > localUpdatedAt) {
            nexVaultDatabase.addPassword(user.id, p.service, p.credential, context.encryptionKey, p.username || '', remoteUpdatedAt);
            stateChanged = true;
          }
        } else {
          nexVaultDatabase.addPassword(user.id, p.service, p.credential, context.encryptionKey, p.username || '', remoteUpdatedAt);
          stateChanged = true;
        }
      }
    }

    // 3. Process incoming OTPs with LWW reconciliation
    if (Array.isArray(vaultData.otps)) {
      for (const o of vaultData.otps) {
        if (!o.service || !o.secret) continue;
        const remoteUpdatedAt = Number(o.updatedAt) || (o.createdAt ? new Date(o.createdAt).getTime() : Date.now());
        const tombstone = nexVaultDatabase.getDeletedRecord(user.id, o.service, 'otp');
        if (tombstone && Number(tombstone.deleted_at) >= remoteUpdatedAt) {
          continue; // Local deletion is newer than incoming OTP
        }

        const localOtp = nexVaultDatabase.getOtpSecretByService(user.id, o.service);
        if (localOtp) {
          const localUpdatedAt = Number(localOtp.updated_at) || (localOtp.created_at ? new Date(localOtp.created_at).getTime() : 0);
          if (remoteUpdatedAt > localUpdatedAt) {
            nexVaultDatabase.addOTP(user.id, o.service, o.secret, context.encryptionKey, remoteUpdatedAt);
            stateChanged = true;
          }
        } else {
          nexVaultDatabase.addOTP(user.id, o.service, o.secret, context.encryptionKey, remoteUpdatedAt);
          stateChanged = true;
        }
      }
    }

    if (stateChanged && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault-updated');
    }

    // If this sync was not already a reply, sync our full reconciled state back so the peer has all items
    if (!vaultData.isReply) {
      syncVaultToPeer(fromPeerId, { isReply: true });
    }
  } catch (err) {
    console.error('[Desktop] Failed to apply vault-sync:', err);
  }
});

function handleRemoteCredentialDeleted(peerId, message) {
  try {
    if (!message || !message.service) return;
    const context = nexVaultSecurity.getUserContext();
    if (!context) return;
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) return;

    const deletedAt = Number(message.deletedAt) || Number(message.timestamp) || Date.now();
    if (message.itemType === 'otp') {
      const localOtp = nexVaultDatabase.getOtpSecretByService(user.id, message.service);
      const localUpdatedAt = localOtp ? (Number(localOtp.updated_at) || (localOtp.created_at ? new Date(localOtp.created_at).getTime() : 0)) : 0;
      if (deletedAt >= localUpdatedAt) {
        nexVaultDatabase.deleteOtpSecret(user.id, message.service, deletedAt);
        console.log(`[Desktop] Successfully deleted OTP "${message.service}" requested by peer ${peerId}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-updated');
      }
    } else {
      const localPwd = nexVaultDatabase.getPassword(user.id, message.service);
      const localUpdatedAt = localPwd ? (Number(localPwd.updated_at) || (localPwd.created_at ? new Date(localPwd.created_at).getTime() : 0)) : 0;
      if (deletedAt >= localUpdatedAt) {
        nexVaultDatabase.deletePassword(user.id, message.service, deletedAt);
        console.log(`[Desktop] Successfully deleted password "${message.service}" requested by peer ${peerId}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-updated');
      }
    }
  } catch (err) {
    console.error('[Desktop] Failed to process remote credential deletion:', err);
  }
}

nexGrid.on('credential-deleted', (peerId, message) => {
  handleRemoteCredentialDeleted(peerId, message);
});

nexGrid.on('message', (peerId, message) => {
  if (message && message.type === 'credential-deleted') {
    handleRemoteCredentialDeleted(peerId, message);
  }
});

nexGrid.on('extension-approval-request', (peerId, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peer-requests-approval', {
      peerId,
      requestId: message.requestId,
      deviceName: message.fromDeviceName || message.deviceName || 'Mesh Peer',
      duration: message.duration,
      newDeadline: message.newDeadline,
      requestedAt: message.requestedAt
    });
  }
});

nexGrid.on('extension-approval-response', (peerId, message) => {
  nexVaultSecurity.handlePeerApproval(message);
});

nexVaultSecurity.on('broadcast-approval-request', (data) => {
  const broadcastPayload = {
    type: 'extension-approval-request',
    requestId: data.requestId,
    fromDeviceId: nexVaultSecurity.getToken().publicKey,
    fromDeviceName: 'NextVault Desktop',
    duration: data.duration,
    newDeadline: data.newDeadline,
    requestedAt: new Date().toISOString()
  };
  nexGrid.broadcastSecureMessage(broadcastPayload);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('broadcast-approval-request', data);
  }
});

nexVaultSecurity.on('extension-approved', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension-approved', data);
  }
});

nexVaultSecurity.on('extension-rejected', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension-rejected', data);
  }
});

nexGrid.on('secure-message', (peerId, message) => {
  if (message.type === 'credential-deleted') {
    handleRemoteCredentialDeleted(peerId, message);
  } else if (message.type === 'extension-approval-request') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('peer-requests-approval', {
        peerId,
        requestId: message.requestId,
        deviceName: message.fromDeviceName || message.deviceName || 'Mesh Peer',
        duration: message.duration,
        newDeadline: message.newDeadline,
        requestedAt: message.requestedAt
      });
    }
  } else if (message.type === 'extension-approval-response' || message.type === 'extension-approval') {
    nexVaultSecurity.handlePeerApproval(message);
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
    setTimeout(() => { autoStartNexGrid(); }, 100);
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
    setTimeout(() => { autoStartNexGrid(); }, 100);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('authenticate-user', async (event, username, password) => {
  try {
    const result = nexVaultSecurity.authenticate(username, password);
    if (result && result.success) {
      setTimeout(() => { autoStartNexGrid(); }, 100);
    }
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

ipcMain.handle('lock-vault', async () => {
  try {
    nexVaultSecurity.lock();
    nexGrid.closeAll();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
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
        try { nexVaultSecurity.store.set('settings.relayUrl', customRelayUrl.trim()); } catch {}
      } else {
        const savedRelay = nexVaultSecurity.store.get('settings.relayUrl');
        if (savedRelay && typeof savedRelay === 'string' && savedRelay.trim()) {
          nexGrid.relayUrl = savedRelay.trim();
        }
      }
      nexGrid.deviceName = 'NextVault Desktop Mesh Node';
      const peers = await nexGrid.discoverPeers(token);
      return { success: true, peers, deviceId: nexGrid.deviceId, relayUrl: nexGrid.relayUrl };
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
    const now = Date.now();
    nexVaultDatabase.addPassword(user.id, serviceName, password, context.encryptionKey, username, now);
    broadcastVaultToPeers();
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
    const now = Date.now();
    nexVaultDatabase.deletePassword(user.id, serviceName, now);
    broadcastCredentialDeleted('password', serviceName, now);
    broadcastVaultToPeers();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-all-passwords', async () => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const now = Date.now();
    const result = nexVaultDatabase.deleteAllPasswords(user.id, now);
    for (const service of result.deletedServices) {
      broadcastCredentialDeleted('password', service, now);
    }
    broadcastVaultToPeers();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-updated');
    return { success: true, count: result.count };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-all-otps', async () => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const now = Date.now();
    const result = nexVaultDatabase.deleteAllOtpSecrets(user.id, now);
    for (const service of result.deletedServices) {
      broadcastCredentialDeleted('otp', service, now);
    }
    broadcastVaultToPeers();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-updated');
    return { success: true, count: result.count };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-all-vault', async () => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const now = Date.now();
    const pwResult = nexVaultDatabase.deleteAllPasswords(user.id, now);
    for (const service of pwResult.deletedServices) {
      broadcastCredentialDeleted('password', service, now);
    }
    const otpResult = nexVaultDatabase.deleteAllOtpSecrets(user.id, now);
    for (const service of otpResult.deletedServices) {
      broadcastCredentialDeleted('otp', service, now);
    }
    broadcastVaultToPeers();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-updated');
    return {
      success: true,
      passwordsCount: pwResult.count,
      otpsCount: otpResult.count,
      totalCount: pwResult.count + otpResult.count
    };
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

ipcMain.handle('bulk-import-passwords', async (event, items) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

    let imported = 0;
    const now = Date.now();
    for (const item of items) {
      if (!item.service || !item.credential) continue;
      nexVaultDatabase.addPassword(user.id, item.service.trim(), item.credential, context.encryptionKey, (item.username || '').trim(), now);
      imported++;
    }
    broadcastVaultToPeers();
    return { success: true, count: imported };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('bulk-import-otps', async (event, items) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

    let imported = 0;
    const now = Date.now();
    for (const item of items) {
      if (!item.service || !item.secret) continue;
      const cleanSecret = item.secret.replace(/\s+/g, '').toUpperCase();
      nexVaultDatabase.addOtpSecret(user.id, item.service.trim(), 'TOTP', cleanSecret, context.encryptionKey, now);
      imported++;
    }
    broadcastVaultToPeers();
    return { success: true, count: imported };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('parse-bulk-import', async (event, content) => {
  try {
    const result = parseBulkImport(content);
    return { success: true, ...result };
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
    const now = Date.now();
    nexVaultDatabase.addOtpSecret(user.id, serviceName, 'TOTP', secret, context.encryptionKey, now);
    broadcastVaultToPeers();
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
    const entriesWithCodes = entries.map(e => {
      try {
        const full = nexVaultDatabase.getOtpSecretByService(user.id, e.service);
        if (full && full.encrypted_data) {
          const secret = nexVaultDatabase.decryptData(full.encrypted_data, context.encryptionKey, full.iv);
          return { ...e, code: generateTotp(secret) };
        }
      } catch {}
      return e;
    });
    return { success: true, entries: entriesWithCodes };
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

ipcMain.handle('get-otp-details', async (event, serviceName) => {
  try {
    const context = nexVaultSecurity.getUserContext();
    if (!context) throw new Error('User is not authenticated');
    const user = nexVaultDatabase.getUser(context.username);
    if (!user) throw new Error('User not found');
    const result = nexVaultDatabase.getOtpSecretByService(user.id, serviceName);
    if (!result) return { success: false, error: 'OTP secret not found' };
    const secret = nexVaultDatabase.decryptData(result.encrypted_data, context.encryptionKey, result.iv);
    return { success: true, service: result.service_name || serviceName, secret };
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
    const now = Date.now();
    nexVaultDatabase.deleteOtpSecret(user.id, serviceName, now);
    broadcastCredentialDeleted('otp', serviceName, now);
    broadcastVaultToPeers();
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
    const now = Date.now();
    nexVaultDatabase.addOtpSecret(user.id, otpType, secret, context.encryptionKey, now);
    broadcastVaultToPeers();
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

ipcMain.handle('extend-security-window', async (event, duration, options = {}) => {
  try {
    const result = await nexVaultSecurity.extendSecurityWindow(duration, options);
    if (result.pendingApproval) {
      const broadcastPayload = {
        type: 'extension-approval-request',
        requestId: result.requestId,
        fromDeviceId: nexVaultSecurity.getToken().publicKey,
        fromDeviceName: 'NexVault Desktop',
        duration: result.duration,
        newDeadline: result.newDeadline,
        requestedAt: new Date().toISOString()
      };
      const count = nexGrid.broadcastSecureMessage(broadcastPayload);
      result.broadcastCount = count;
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('approve-extension', async (event, peerId, requestId, duration, newDeadline) => {
  try {
    const responsePayload = nexVaultSecurity.createPeerExtensionResponse({
      requestId,
      fromDeviceId: peerId,
      duration,
      newDeadline
    }, true);
    nexGrid.sendSecureMessage(peerId, responsePayload);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reject-extension', async (event, peerId, requestId, reason) => {
  try {
    const responsePayload = nexVaultSecurity.createPeerExtensionResponse({
      requestId,
      fromDeviceId: peerId
    }, false, reason || 'Declined by desktop user');
    nexGrid.sendSecureMessage(peerId, responsePayload);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-browser-extension', async () => {
  return setupBrowserExtensionIntegration();
});

ipcMain.handle('get-browser-extension-status', async () => {
  return setupBrowserExtensionIntegration();
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

ipcMain.handle('trigger-emergency-nuke', async (event, immediate) => {
  try {
    if (immediate) {
      try { nexVaultDatabase.close(); } catch {}
      nexVaultSecurity.executeNuke();
    } else {
      nexVaultSecurity.triggerNuke();
    }
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
    nexGrid.sendRelaySignal(peerId, { type: 'pair-rejected', reason: 'Declined by mesh peer' });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pair-with-code', async (event, code) => {
  try {
    const token = nexVaultSecurity.getToken();
    if (!token) throw new Error('No identity token found');
    if (!code || typeof code !== 'string') throw new Error('Invalid code');
    if (!nexGrid.relaySocket || nexGrid.relaySocket.readyState !== 1) {
      throw new Error('NexGrid is not connected to relay. Start NexGrid first.');
    }
    const cleanCode = code.trim();
    nexGrid.sendRelaySignal('*', {
      type: 'pair-request',
      code: cleanCode,
      fromDeviceId: nexGrid.deviceId,
      fromDeviceName: 'NextVault Desktop Mesh Node',
      publicKey: nexGrid.localKeyPairs.get(nexGrid.deviceId)?.publicKey,
      timestamp: Date.now()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-relay-url', async () => {
  try {
    const saved = nexVaultSecurity.store.get('settings.relayUrl');
    return { success: true, relayUrl: saved || nexGrid.relayUrl || 'ws://127.0.0.1:46123' };
  } catch {
    return { success: true, relayUrl: nexGrid.relayUrl || 'ws://127.0.0.1:46123' };
  }
});

ipcMain.handle('set-relay-url', async (event, relayUrl) => {
  try {
    if (relayUrl && typeof relayUrl === 'string' && relayUrl.trim()) {
      const url = relayUrl.trim();
      nexVaultSecurity.store.set('settings.relayUrl', url);
      if (nexGrid) nexGrid.relayUrl = url;
      return { success: true, relayUrl: url };
    }
    return { success: false, error: 'Invalid URL' };
  } catch (err) {
    return { success: false, error: err.message };
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

function compareVersions(v1, v2) {
  const p1 = (v1 || '').replace(/^v/, '').split('.').map(Number);
  const p2 = (v2 || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function fetchGithubRelease() {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    let storedToken = null;
    try {
      storedToken = nexVaultSecurity.store.get('security.githubToken');
    } catch {}
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || storedToken;
    const reqHeaders = {
      'User-Agent': 'NexVault-Desktop/' + CURRENT_VERSION,
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    const req = https.get(url, {
      headers: reqHeaders,
      timeout: 6000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, {
          headers: reqHeaders,
          timeout: 6000
        }, (redirectRes) => {
          let data = '';
          redirectRes.on('data', chunk => { data += chunk; });
          redirectRes.on('end', () => {
            try {
              if (redirectRes.statusCode === 200) {
                resolve({ success: true, release: JSON.parse(data) });
              } else {
                resolve({ success: false, statusCode: redirectRes.statusCode, error: 'Status: ' + redirectRes.statusCode });
              }
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          });
        }).on('error', err => resolve({ success: false, error: err.message }));
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve({ success: true, release: JSON.parse(data) });
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: 'Status: ' + res.statusCode });
          }
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Connection timed out' }); });
  });
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await fetchGithubRelease();
    if (!result.success || !result.release) {
      const is404 = result.statusCode === 404;
      return {
        success: false,
        statusCode: result.statusCode,
        error: is404
          ? `GitHub returned 404 (Not Found). Note: If repository '${GITHUB_REPO}' is private, make it public or configure a token.`
          : (result.error || `HTTP error ${result.statusCode || 'unknown'}`),
        currentVersion: CURRENT_VERSION,
        latestVersion: CURRENT_VERSION,
        hasUpdate: false,
        message: is404
          ? `Repository is private (HTTP 404). Make '${GITHUB_REPO}' public on GitHub or configure a token.`
          : (result.error || 'Unable to check for updates.')
      };
    }
    const release = result.release;
    const latestTag = release.tag_name || CURRENT_VERSION;
    const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;
    const assets = release.assets || [];
    const appImageAsset = assets.find(a => /\.AppImage$/i.test(a.name));
    const cleanTag = latestTag.replace(/^v/, '');
    const downloadUrl = appImageAsset ? appImageAsset.browser_download_url : `https://github.com/${GITHUB_REPO}/releases/download/${latestTag}/NexVault-${cleanTag}.AppImage`;

    return {
      success: true,
      currentVersion: CURRENT_VERSION,
      latestVersion: latestTag,
      hasUpdate,
      downloadUrl,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      releaseName: release.name || latestTag,
      notes: release.body || '',
      publishedAt: release.published_at,
      message: hasUpdate
        ? `Update available: ${latestTag} (installed: v${CURRENT_VERSION})`
        : `NextVault is up to date (v${CURRENT_VERSION})`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      currentVersion: CURRENT_VERSION,
      hasUpdate: false,
      message: 'Update check failed: ' + err.message
    };
  }
});

function downloadFileWithRedirects(targetUrl, destinationPath, onProgress, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    function fetchUrl(currentUrl, depth) {
      if (depth > maxRedirects) {
        return reject(new Error('Too many HTTP redirects'));
      }
      const parsed = new URL(currentUrl);
      const httpModule = parsed.protocol === 'http:' ? require('http') : https;
      const headers = {
        'User-Agent': 'NexVault-Desktop/' + CURRENT_VERSION,
        'Accept': 'application/octet-stream'
      };
      let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      try {
        if (!token) token = nexVaultSecurity.store.get('security.githubToken');
      } catch {}
      if (token && parsed.hostname.includes('github.com')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = httpModule.get(currentUrl, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destinationPath);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            onProgress({
              percent: Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
              downloadedBytes,
              totalBytes
            });
          }
        });
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => resolve({ path: destinationPath, size: downloadedBytes }));
        });
        fileStream.on('error', (err) => {
          fs.unlink(destinationPath, () => {});
          reject(err);
        });
      });
      req.on('error', reject);
    }
    fetchUrl(targetUrl, 0);
  });
}

ipcMain.handle('apply-update', async (event, downloadUrl) => {
  try {
    if (!downloadUrl) {
      const releaseInfo = await fetchGithubRelease();
      if (!releaseInfo.success || !releaseInfo.release) {
        throw new Error('Unable to retrieve latest release information');
      }
      const assets = releaseInfo.release.assets || [];
      const appImageAsset = assets.find(a => /\.AppImage$/i.test(a.name));
      if (!appImageAsset) {
        throw new Error('No AppImage asset found in latest release');
      }
      downloadUrl = appImageAsset.browser_download_url;
    }

    const os = require('os');
    const { spawn } = require('child_process');

    const currentAppImage = process.env.APPIMAGE;
    const tempDownloadPath = path.join(os.tmpdir(), `nexvault-update-${Date.now()}.AppImage`);

    console.log(`[Desktop Auto-Update] Downloading ${downloadUrl} to ${tempDownloadPath}...`);
    await downloadFileWithRedirects(downloadUrl, tempDownloadPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', progress);
      }
    });

    fs.chmodSync(tempDownloadPath, 0o755);

    if (currentAppImage && fs.existsSync(currentAppImage)) {
      console.log(`[Desktop Auto-Update] In-place replacing AppImage at: ${currentAppImage}`);
      const updaterScriptPath = path.join(os.tmpdir(), `nexvault-restart-${Date.now()}.sh`);
      
      let targetFileName = path.basename(currentAppImage);
      try {
        const urlObj = new URL(downloadUrl);
        const parsedName = path.basename(urlObj.pathname);
        if (parsedName && parsedName.endsWith('.AppImage')) {
          targetFileName = parsedName;
        }
      } catch {}

      const targetAppImagePath = path.join(path.dirname(currentAppImage), targetFileName);

      const scriptContent = `#!/bin/bash
OLD_PID=${process.pid}
OLD_FILE="${currentAppImage}"
TARGET_FILE="${targetAppImagePath}"
TMP_FILE="${tempDownloadPath}"

while kill -0 "$OLD_PID" 2>/dev/null; do
  sleep 0.1
done

# If replacing with a new version filename, remove the old file first so no duplicates exist
if [ "$OLD_FILE" != "$TARGET_FILE" ] && [ -f "$OLD_FILE" ]; then
  rm -f "$OLD_FILE"
fi

mv -f "$TMP_FILE" "$TARGET_FILE"
chmod +x "$TARGET_FILE"

nohup "$TARGET_FILE" >/dev/null 2>&1 &
exit 0
`;
      fs.writeFileSync(updaterScriptPath, scriptContent, { mode: 0o755 });

      const child = spawn('/bin/bash', [updaterScriptPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      app.quit();
      setTimeout(() => process.exit(0), 500);
      return { success: true, message: 'Restarting with updated version...' };
    } else {
      console.log(`[Desktop Auto-Update] Running outside packaged AppImage. Spawning: ${tempDownloadPath}`);
      const child = spawn(tempDownloadPath, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      app.quit();
      setTimeout(() => process.exit(0), 500);
      return { success: true, message: 'Launching updated AppImage...' };
    }
  } catch (err) {
    console.error('[Desktop Auto-Update] Failed to apply update:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-github-token', async (event, token) => {
  try {
    if (token) {
      nexVaultSecurity.store.set('security.githubToken', token.trim());
      process.env.GITHUB_TOKEN = token.trim();
    } else {
      nexVaultSecurity.store.delete('security.githubToken');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-github-token', async () => {
  try {
    const token = process.env.GITHUB_TOKEN || nexVaultSecurity.store.get('security.githubToken') || '';
    return { success: true, token };
  } catch (err) {
    return { success: false, token: '' };
  }
});

ipcMain.handle('open-external-url', async (event, url) => {
  try {
    const { shell } = require('electron');
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Invalid URL scheme' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-trusted-devices', async () => {
  return { success: true, devices: getTrustedDevices() };
});

ipcMain.handle('get-app-version', async () => {
  return CURRENT_VERSION;
});

ipcMain.handle('remove-trusted-device', async (event, deviceId) => {
  const ok = removeTrustedDevice(deviceId);
  return { success: ok };
});

let appTray = null;

function setupTray() {
  if (appTray) return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;

  try {
    const iconImage = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
    appTray = new Tray(iconImage);
    appTray.setToolTip('NexVault - Local-First Encrypted Vault');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open NexVault',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: 'Check for Updates...',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit NexVault',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    appTray.setContextMenu(contextMenu);
    appTray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    console.warn('[Desktop] Tray initialization notice:', err.message);
  }
}

// Window management
function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'NextVault',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('nexvault');
  setupLinuxDesktopIntegration();
  setupBrowserExtensionIntegration();
  createWindow();
  setupTray();

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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
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