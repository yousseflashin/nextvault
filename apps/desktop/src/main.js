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
    const pkgVersion = require('../package.json')?.version;
    return (app?.getVersion && app.getVersion()) || pkgVersion || '0.1.30';
  } catch {
    return '0.1.30';
  }
})();
const GITHUB_REPO = 'yousseflashin/nextvault';
const LATEST_MANIFEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/release-info.json`;
const GITHUB_API_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const ALLOWED_UPDATE_HOST_SUFFIXES = ['github.com', 'githubusercontent.com'];
let lastVerifiedUpdate = null;

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

nexGrid.on('extension-grant', (peerId, message) => {
  try {
    const result = nexVaultSecurity.applyPeerExtensionGrant(message);
    if (result.ack) {
      nexGrid.sendSecureMessage(peerId, result.ack);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension-grant-received', {
        peerId,
        ...message,
        ...result
      });
    }
  } catch (err) {
    console.error('[NexVault Desktop] Error applying extension grant:', err);
  }
});

nexGrid.on('extension-grant-ack', (peerId, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension-grant-acknowledged', {
      peerId,
      ...message
    });
  }
});

nexGrid.on('extension-prompt-request', (peerId, message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension-prompt-received', {
      peerId,
      ...message
    });
  }
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

ipcMain.handle('grant-peer-extension', async (event, targetPeerId, duration = '1week') => {
  try {
    const result = nexVaultSecurity.grantPeerExtension(targetPeerId, duration);
    if (result.grant && targetPeerId) {
      nexGrid.sendSecureMessage(targetPeerId, result.grant);
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('request-peer-to-extend', async (event, targetPeerId, duration = '1week') => {
  try {
    const promptPayload = {
      type: 'extension-prompt-request',
      fromDeviceId: nexVaultSecurity.getToken().publicKey,
      fromDeviceName: 'NexVault Desktop',
      targetDeviceId: targetPeerId,
      duration,
      timestamp: new Date().toISOString()
    };
    if (targetPeerId) {
      nexGrid.sendSecureMessage(targetPeerId, promptPayload);
    }
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
  const p1 = normalizeVersion(v1).split('.').map(Number);
  const p2 = normalizeVersion(v2).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function normalizeVersion(version) {
  const match = String(version || '').match(/\d+(?:\.\d+){0,2}/);
  return match ? match[0].split('.').concat(['0', '0']).slice(0, 3).join('.') : '0.0.0';
}

function isAllowedUpdateUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_UPDATE_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith('.' + suffix)
    );
  } catch {
    return false;
  }
}

function getGithubAuthToken() {
  let storedToken = null;
  try {
    storedToken = nexVaultSecurity.store.get('security.githubToken');
  } catch {}
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || storedToken || null;
}

function fetchJsonWithRedirects(startUrl, extraHeaders = {}, maxRedirects = 8) {
  return new Promise((resolve) => {
    function step(currentUrl, depth) {
      if (depth > maxRedirects) {
        return resolve({ success: false, error: 'Too many redirects' });
      }
      if (!isAllowedUpdateUrl(currentUrl)) {
        return resolve({ success: false, error: `Blocked untrusted update URL: ${currentUrl}` });
      }
      const parsed = new URL(currentUrl);
      const headers = {
        'User-Agent': 'NexVault-Desktop/' + CURRENT_VERSION,
        'Accept': 'application/json',
        ...extraHeaders
      };
      const token = getGithubAuthToken();
      if (token && parsed.hostname === 'api.github.com') {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = https.get(currentUrl, { headers, timeout: 10000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          return step(nextUrl, depth + 1);
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return resolve({
              success: false,
              statusCode: res.statusCode,
              error: `HTTP ${res.statusCode}`
            });
          }
          try {
            resolve({ success: true, data: JSON.parse(body) });
          } catch (err) {
            resolve({ success: false, error: 'Invalid JSON response: ' + err.message });
          }
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timed out' });
      });
    }
    step(startUrl, 0);
  });
}

async function resolveLatestDesktopRelease() {
  // 1. Primary source: signed release-info.json manifest attached to latest GitHub release
  const manifestRes = await fetchJsonWithRedirects(LATEST_MANIFEST_URL);
  if (manifestRes.success && manifestRes.data) {
    const m = manifestRes.data;
    const dt = m.desktop;
    if (
      m.version &&
      dt?.url &&
      isAllowedUpdateUrl(dt.url) &&
      typeof dt.sha256 === 'string' &&
      /^[a-f0-9]{64}$/i.test(dt.sha256)
    ) {
      return {
        success: true,
        source: 'manifest',
        latestVersion: normalizeVersion(m.version),
        latestTag: m.tag || `v${normalizeVersion(m.version)}`,
        filename: dt.filename || `NexVault-${normalizeVersion(m.version)}-x86_64.AppImage`,
        downloadUrl: dt.url,
        size: Number(dt.size) || 0,
        sha256: dt.sha256.toLowerCase(),
        releaseUrl: m.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/tag/v${normalizeVersion(m.version)}`,
        releaseName: `NexVault v${normalizeVersion(m.version)}`,
        notes: m.notes || '',
        publishedAt: m.publishedAt || null
      };
    }
  }

  // 2. Fallback: GitHub Releases REST API
  const apiRes = await fetchJsonWithRedirects(GITHUB_API_LATEST_URL, {
    'Accept': 'application/vnd.github+json'
  });
  if (!apiRes.success || !apiRes.data) {
    return {
      success: false,
      statusCode: apiRes.statusCode,
      error: apiRes.error || 'Unable to reach GitHub Releases'
    };
  }

  const release = apiRes.data;
  const latestTag = release.tag_name || `v${CURRENT_VERSION}`;
  const latestVersion = normalizeVersion(latestTag);
  const assets = release.assets || [];
  const appImageAsset = assets.find((a) => /\.AppImage$/i.test(a.name));
  const digestHex = String(appImageAsset?.digest || '').replace(/^sha256:/i, '');

  return {
    success: true,
    source: 'github-api',
    latestVersion,
    latestTag,
    filename: appImageAsset?.name || `NexVault-${latestVersion}.AppImage`,
    downloadUrl: appImageAsset?.browser_download_url || null,
    size: Number(appImageAsset?.size) || 0,
    sha256: /^[a-f0-9]{64}$/i.test(digestHex) ? digestHex.toLowerCase() : null,
    releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    releaseName: release.name || latestTag,
    notes: release.body || '',
    publishedAt: release.published_at || null
  };
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const resolved = await resolveLatestDesktopRelease();
    if (!resolved.success) {
      const is404 = resolved.statusCode === 404;
      return {
        success: false,
        statusCode: resolved.statusCode,
        error: is404
          ? `GitHub returned 404 (Not Found). Note: If repository '${GITHUB_REPO}' is private, make it public or configure a token.`
          : (resolved.error || `HTTP error ${resolved.statusCode || 'unknown'}`),
        currentVersion: CURRENT_VERSION,
        latestVersion: normalizeVersion(CURRENT_VERSION),
        hasUpdate: false,
        message: is404
          ? `Repository is private (HTTP 404). Make '${GITHUB_REPO}' public on GitHub or configure a token.`
          : (resolved.error || 'Unable to check for updates.')
      };
    }

    const hasUpdate =
      compareVersions(resolved.latestVersion, CURRENT_VERSION) > 0 &&
      Boolean(resolved.downloadUrl) &&
      isAllowedUpdateUrl(resolved.downloadUrl);

    lastVerifiedUpdate = hasUpdate ? resolved : null;

    return {
      success: true,
      source: resolved.source,
      currentVersion: CURRENT_VERSION,
      latestVersion: resolved.latestVersion,
      hasUpdate,
      filename: resolved.filename,
      downloadUrl: resolved.downloadUrl,
      size: resolved.size,
      sha256: resolved.sha256,
      releaseUrl: resolved.releaseUrl,
      releaseName: resolved.releaseName,
      notes: resolved.notes,
      publishedAt: resolved.publishedAt,
      message: hasUpdate
        ? `Update available: v${resolved.latestVersion} (installed: v${normalizeVersion(CURRENT_VERSION)})`
        : `NexVault is up to date (v${CURRENT_VERSION})`
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

function downloadAndVerifyAppImage(targetUrl, destinationPath, expectedSize, onProgress, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    function fetchUrl(currentUrl, depth) {
      if (depth > maxRedirects) {
        return reject(new Error('Too many HTTP redirects'));
      }
      if (!isAllowedUpdateUrl(currentUrl)) {
        return reject(new Error(`Blocked download from untrusted host: ${currentUrl}`));
      }
      const parsed = new URL(currentUrl);
      const headers = {
        'User-Agent': 'NexVault-Desktop/' + CURRENT_VERSION,
        'Accept': 'application/octet-stream'
      };
      const token = getGithubAuthToken();
      if (token && parsed.hostname === 'api.github.com') {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = https.get(currentUrl, { headers, timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          return fetchUrl(nextUrl, depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || expectedSize || 0;
        let downloadedBytes = 0;
        const hash = crypto.createHash('sha256');
        const fileStream = fs.createWriteStream(destinationPath, { mode: 0o600 });

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (expectedSize > 0 && downloadedBytes > expectedSize) {
            req.destroy(new Error('Downloaded file exceeds expected release size'));
            return;
          }
          hash.update(chunk);
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
          fileStream.close(() => {
            resolve({
              path: destinationPath,
              size: downloadedBytes,
              sha256: hash.digest('hex')
            });
          });
        });
        fileStream.on('error', (err) => {
          fs.unlink(destinationPath, () => {});
          reject(err);
        });
      });
      req.on('error', (err) => {
        fs.unlink(destinationPath, () => {});
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        fs.unlink(destinationPath, () => {});
        reject(new Error('Download timed out'));
      });
    }
    fetchUrl(targetUrl, 0);
  });
}

ipcMain.handle('apply-update', async () => {
  const os = require('os');
  const { spawn } = require('child_process');
  const tempDownloadPath = path.join(os.tmpdir(), `nexvault-update-${Date.now()}.AppImage`);

  try {
    let targetRelease = lastVerifiedUpdate;
    if (!targetRelease || !targetRelease.downloadUrl) {
      const resolved = await resolveLatestDesktopRelease();
      if (!resolved.success || !resolved.downloadUrl) {
        throw new Error(resolved.error || 'Unable to retrieve latest release information');
      }
      targetRelease = resolved;
    }

    if (!isAllowedUpdateUrl(targetRelease.downloadUrl)) {
      throw new Error('Refusing update from untrusted URL');
    }
    if (!targetRelease.sha256 || !/^[a-f0-9]{64}$/i.test(targetRelease.sha256)) {
      throw new Error('Release is missing a SHA-256 checksum; refusing unverified automatic update. Please download manually from GitHub Releases.');
    }

    console.log(`[Desktop Auto-Update] Downloading ${targetRelease.downloadUrl} to ${tempDownloadPath}...`);
    const downloaded = await downloadAndVerifyAppImage(
      targetRelease.downloadUrl,
      tempDownloadPath,
      targetRelease.size,
      (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', progress);
        }
      }
    );

    if (targetRelease.size > 0 && downloaded.size !== targetRelease.size) {
      throw new Error(`Size mismatch: expected ${targetRelease.size} bytes, got ${downloaded.size} bytes`);
    }
    if (downloaded.sha256.toLowerCase() !== targetRelease.sha256.toLowerCase()) {
      throw new Error(`SHA-256 checksum mismatch! Expected ${targetRelease.sha256}, got ${downloaded.sha256}`);
    }

    // Verify ELF header magic (\x7fELF) before making executable
    const headerBuf = Buffer.alloc(4);
    const fd = fs.openSync(tempDownloadPath, 'r');
    try {
      fs.readSync(fd, headerBuf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (headerBuf[0] !== 0x7f || headerBuf[1] !== 0x45 || headerBuf[2] !== 0x4c || headerBuf[3] !== 0x46) {
      throw new Error('Downloaded file is not a valid Linux ELF/AppImage binary');
    }

    fs.chmodSync(tempDownloadPath, 0o755);

    const currentAppImage = process.env.APPIMAGE;
    if (currentAppImage && fs.existsSync(currentAppImage)) {
      console.log(`[Desktop Auto-Update] Verified SHA-256 (${downloaded.sha256.slice(0, 12)}…). Replacing AppImage at: ${currentAppImage}`);

      // Replace in-place at the exact currentAppImage path if it has no version number,
      // or update the versioned filename in the same directory.
      let targetAppImagePath = currentAppImage;
      if (/NexVault-\d+\.\d+\.\d+.*\.AppImage$/i.test(path.basename(currentAppImage)) && targetRelease.filename) {
        targetAppImagePath = path.join(path.dirname(currentAppImage), path.basename(targetRelease.filename));
      }

      const replaceScript = [
        'while kill -0 "$NV_OLD_PID" 2>/dev/null; do sleep 0.1; done',
        'if [ "$NV_OLD_FILE" != "$NV_TARGET_FILE" ] && [ -f "$NV_OLD_FILE" ]; then rm -f -- "$NV_OLD_FILE"; fi',
        'mv -f -- "$NV_TMP_FILE" "$NV_TARGET_FILE"',
        'chmod +x -- "$NV_TARGET_FILE"',
        'nohup "$NV_TARGET_FILE" >/dev/null 2>&1 &'
      ].join('\n');

      const child = spawn('/bin/bash', ['-c', replaceScript], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          NV_OLD_PID: String(process.pid),
          NV_OLD_FILE: currentAppImage,
          NV_TARGET_FILE: targetAppImagePath,
          NV_TMP_FILE: tempDownloadPath
        }
      });
      child.unref();

      app.isQuitting = true;
      app.quit();
      setTimeout(() => process.exit(0), 500);
      return { success: true, message: 'Verified SHA-256. Restarting with updated version...' };
    } else {
      console.log(`[Desktop Auto-Update] Verified SHA-256. Running outside packaged AppImage; spawning: ${tempDownloadPath}`);
      const child = spawn(tempDownloadPath, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      app.isQuitting = true;
      app.quit();
      setTimeout(() => process.exit(0), 500);
      return { success: true, message: 'Verified SHA-256. Launching updated AppImage...' };
    }
  } catch (err) {
    try {
      if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath);
    } catch {}
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
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('trigger-update-check');
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