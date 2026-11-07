const { NexVaultToken, NexVaultCrypto } = require('../core/crypto');
const Store = require('electron-store');
const crypto = require('crypto');
const path = require('path');
const EventEmitter = require('events');
const TrustLedger = require('./trustLedger');
const IntegrityMonitor = require('./integrity');
const { getStoreKey } = require('./storeKey');

const DAY_SECONDS = 24 * 60 * 60;
const MAX_EXTENDED_SECONDS = 30 * DAY_SECONDS;
const ABSOLUTE_OFFLINE_SECONDS = 90 * DAY_SECONDS;

class NexVaultSecurity extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.userDataPath = userDataPath || (process.env.NEXVAULT_DATA_DIR || path.join(__dirname, '..', '..', 'data'));
    this.store = new Store({
      name: 'nexvault-security',
      cwd: userDataPath,
      encryptionKey: getStoreKey(this.userDataPath)
    });
    this.token = new NexVaultToken();
    // In-memory session flag: the vault is locked on every launch until the password is verified.
    this.unlocked = false;
    this.securityCountdown = null;
    this.isCountdownActive = false;
    this.remainingSeconds = 24 * 60 * 60;
    this.nukeWarningTimer = null;
    this.integrity = new IntegrityMonitor(this.userDataPath);
    const publicKey = this.store.get('device.publicKey');
    this.ledger = publicKey ? new TrustLedger(this.store, publicKey) : null;
  }

  initializeNewUser(username, password) {
    const existingUser = this.store.get('user.username');
    const existingPub = this.store.get('device.publicKey');
    const existingDerived = this.store.get('user.derivedKey');
    const existingBootstrap = this.store.get('user.bootstrapToken');

    // If this identity already exists on device with matching password, preserve keys to avoid breaking existing data
    if (existingUser === username && existingPub && existingDerived && existingBootstrap) {
      const checkKey = this.deriveKeyFromPassword(password, existingPub);
      if (checkKey === existingDerived) {
        this.store.set('security.lastActive', new Date().toISOString());
        this.store.set('security.lastVerifiedAt', new Date().toISOString());
        this.unlocked = true;
        return {
          publicKey: existingPub,
          bootstrapToken: existingBootstrap,
          tokenId: existingBootstrap.tokenId
        };
      }
    }

    // Generate device identity
    const identity = this.token.generate();
    
    // Derive encryption key from password (in production, use PBKDF2/Argon2)
    const derivedKey = this.deriveKeyFromPassword(password, identity.publicKey);
    
    // Generate bootstrap token
    const bootstrapToken = this.token.generateBootstrapToken();
    
    // Store securely
    this.store.set('device.publicKey', identity.publicKey);
    this.store.set('device.secretKey', identity.secretKey);
    this.store.set('user.username', username);
    this.store.set('user.derivedKey', derivedKey);
    this.store.set('user.bootstrapToken', bootstrapToken);
    this.store.set('user.createdAt', new Date().toISOString());
    this.store.set('security.lastActive', new Date().toISOString());
    this.store.set('security.lastVerifiedAt', new Date().toISOString());
    this.store.set('security.offlineDeadline', new Date(Date.now() + DAY_SECONDS * 1000).toISOString());
    this.store.set('security.absoluteOfflineDeadline', new Date(Date.now() + ABSOLUTE_OFFLINE_SECONDS * 1000).toISOString());
    this.ledger = new TrustLedger(this.store, identity.publicKey);
    this.ledger.append('application-created', { username });
    this.unlocked = true;
    
    return {
      publicKey: identity.publicKey,
      bootstrapToken: bootstrapToken,
      tokenId: bootstrapToken.tokenId
    };
  }

  deriveKeyFromPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64');
  }

  async initializeExistingUser(tokenId, publicKey, signature, password, expiresAt) {
    // Verify token signature
    const isValid = NexVaultToken.verify(
      tokenId,
      signature,
      publicKey
    );
    
    if (!isValid) {
      throw new Error('Invalid token signature');
    }
    if (!expiresAt || Date.now() >= new Date(expiresAt).getTime()) {
      throw new Error('Token is expired');
    }

    const storedToken = this.store.get('user.bootstrapToken');
    if (storedToken && storedToken.tokenId !== tokenId) {
      throw new Error('Token does not belong to this environment');
    }
    
    const localSecretKey = this.store.get('device.secretKey');
    if (!localSecretKey) {
      const identity = this.token.generate();
      this.store.set('device.publicKey', identity.publicKey);
      this.store.set('device.secretKey', identity.secretKey);
      this.store.set('user.username', `device-${tokenId.slice(-8)}`);
      this.store.set('user.derivedKey', this.deriveKeyFromPassword(password, identity.publicKey));
    } else {
      const derivedKey = this.deriveKeyFromPassword(password, this.store.get('device.publicKey'));
      if (this.store.get('user.derivedKey') !== derivedKey) throw new Error('Invalid password');
    }
    this.store.set('user.bootstrapToken', { tokenId, publicKey, signature, expiresAt });
    this.store.set('security.lastActive', new Date().toISOString());
    this.store.set('security.lastVerifiedAt', new Date().toISOString());
    this.store.set('security.offlineDeadline', new Date(Date.now() + DAY_SECONDS * 1000).toISOString());
    this.store.set('security.absoluteOfflineDeadline', new Date(Date.now() + ABSOLUTE_OFFLINE_SECONDS * 1000).toISOString());
    this.ledger = new TrustLedger(this.store, this.store.get('device.publicKey'));
    this.ledger.append('application-added', { sourceTokenId: tokenId });
    this.authorizeToken({ tokenId, publicKey, signature });
    this.unlocked = true;
    return { success: true, tokenId };
  }

  authenticate(username, password) {
    const storedUsername = this.store.get('user.username');
    const storedKey = this.store.get('user.derivedKey');
    
    if (storedUsername !== username) {
      return { success: false, error: 'Invalid username' };
    }
    
    const publicKey = this.store.get('device.publicKey');
    const derivedKey = this.deriveKeyFromPassword(password, publicKey);
    
    if (derivedKey !== storedKey) {
      return { success: false, error: 'Invalid password' };
    }
    
    // Update last active
    this.store.set('security.lastActive', new Date().toISOString());
    this.store.set('security.lastVerifiedAt', new Date().toISOString());
    this.resetCountdown();
    this.unlocked = true;
    
    return { success: true };
  }

  lock() {
    this.unlocked = false;
    if (this.ledger) {
      try { this.ledger.append('vault-locked', {}); } catch {}
    }
    return { success: true };
  }

  getToken() {
    const devicePublicKey = this.store.get('device.publicKey');
    const bootstrapToken = this.store.get('user.bootstrapToken');

    if (!devicePublicKey || !bootstrapToken) return null;
    return {
      ...bootstrapToken,
      devicePublicKey,
      deviceId: devicePublicKey
    };
  }

  getUserContext() {
    if (!this.unlocked) return null;
    const username = this.store.get('user.username');
    const publicKey = this.store.get('device.publicKey');
    const encryptionKey = this.store.get('user.derivedKey');

    if (!username || !publicKey || !encryptionKey) return null;
    return { username, publicKey, encryptionKey };
  }

  authorizeToken(tokenData) {
    if (!tokenData || !tokenData.tokenId || !tokenData.publicKey || !tokenData.signature) {
      throw new Error('Complete token data is required');
    }
    if (!NexVaultToken.verify(tokenData.tokenId, tokenData.signature, tokenData.publicKey)) {
      throw new Error('Invalid token signature');
    }
    if (!this.verifyTokenAuthorization(tokenData.tokenId)) {
      throw new Error('Token is expired or revoked');
    }
    this.store.set('security.lastVerifiedAt', new Date().toISOString());
    this.store.set('security.lastActive', new Date().toISOString());
    this.resetCountdown();
    this.cancelNuke();
    if (this.ledger) this.ledger.append('token-authorized', { tokenId: tokenData.tokenId });
    return { success: true };
  }

  startSecurityCountdown() {
    if (this.isCountdownActive) return;
    this.enforceAbsoluteDeadline();
    
    this.isCountdownActive = true;
    this.remainingSeconds = 24 * 60 * 60;
    
    this.securityCountdown = setInterval(() => {
      this.remainingSeconds--;
      
      if (this.remainingSeconds <= 0) {
        this.triggerNuke();
      }
      
      // Emit countdown update
      if (this.remainingSeconds % 3600 === 0) {
        console.log(`Security countdown: ${this.remainingSeconds / 3600} hours remaining`);
      }
    }, 1000);
    
    console.log(`Security countdown started: 24 hours`);
  }

  resetCountdown() {
    if (this.securityCountdown) {
      clearInterval(this.securityCountdown);
      this.securityCountdown = null;
    }
    this.isCountdownActive = false;
    this.remainingSeconds = DAY_SECONDS;
    this.store.set('security.lastActive', new Date().toISOString());
    console.log('Security countdown reset');
  }

  async extendSecurityWindow(duration, options = {}) {
    const extensions = {
      '1week': 7 * 24 * 60 * 60,
      '1month': 30 * 24 * 60 * 60,
      '3months': ABSOLUTE_OFFLINE_SECONDS
    };
    
    const seconds = extensions[duration];
    if (!seconds) {
      throw new Error('Invalid extension duration');
    }

    const newDeadline = new Date(Date.now() + seconds * 1000).toISOString();

    // If options explicitly ask for peer mesh approval, or duration is 3months without local flag
    if (options.mesh || options.requirePeerApproval || (seconds > MAX_EXTENDED_SECONDS && !options.local)) {
      const requestId = 'ext-req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      this.pendingExtension = {
        requestId,
        duration,
        seconds,
        requestedAt: new Date().toISOString(),
        expiresAt: newDeadline,
        approvals: new Set()
      };
      
      this.emit('broadcast-approval-request', {
        requestId,
        duration,
        newDeadline
      });
      
      return { success: true, pendingApproval: true, duration, requestId, newDeadline };
    }
    
    // Normal extension (local or standalone grace)
    this.store.set('security.extension', {
      duration,
      requestedAt: new Date().toISOString(),
      expiresAt: newDeadline
    });
    this.store.set('security.offlineDeadline', newDeadline);
    if (this.ledger) this.ledger.append('security-window-extended', { duration, expiresAt: newDeadline });
    
    return { success: true, pendingApproval: false, duration, expiresAt: newDeadline };
  }

  createPeerExtensionResponse(request, approved, reason = '') {
    const approverPublicKey = this.store.get('device.publicKey') || '';
    const approverDeviceName = this.store.get('user.username') || 'NexVault Node';
    if (approved) {
      if (this.ledger) {
        this.ledger.append('security-window-extension-approved-for-peer', {
          requestId: request.requestId,
          peerId: request.fromDeviceId || request.peerId,
          peerName: request.fromDeviceName || request.peerName,
          duration: request.duration
        });
      }
    }
    return {
      type: 'extension-approval-response',
      requestId: request.requestId,
      approved: Boolean(approved),
      reason,
      approverPublicKey,
      approverDeviceId: approverPublicKey,
      approverDeviceName,
      duration: request.duration,
      newDeadline: request.newDeadline,
      timestamp: new Date().toISOString()
    };
  }

  grantPeerExtension(targetDeviceId, duration = '1week', options = {}) {
    const extensions = {
      '1week': 7 * 24 * 60 * 60,
      '1month': 30 * 24 * 60 * 60,
      '3months': ABSOLUTE_OFFLINE_SECONDS
    };
    const seconds = extensions[duration] || extensions['1week'];
    const newDeadline = new Date(Date.now() + seconds * 1000).toISOString();
    const granterPublicKey = this.store.get('device.publicKey') || '';
    const granterDeviceName = this.store.get('user.username') || 'NexVault Node';
    const grantId = 'grant-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    const grant = {
      type: 'extension-grant',
      grantId,
      targetDeviceId,
      granterDeviceId: granterPublicKey,
      granterPublicKey,
      granterDeviceName,
      duration,
      newDeadline,
      timestamp: new Date().toISOString()
    };

    if (this.ledger) {
      this.ledger.append('security-window-extension-granted-to-peer', {
        grantId,
        targetDeviceId,
        duration,
        newDeadline
      });
    }

    this.emit('broadcast-extension-grant', { grant, targetDeviceId });
    return { success: true, grant };
  }

  applyPeerExtensionGrant(grantData) {
    if (!grantData || !grantData.duration) {
      throw new Error('Invalid grant data');
    }
    const duration = grantData.duration;
    const expiresAt = grantData.newDeadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const granterName = grantData.granterDeviceName || grantData.granterDeviceId || 'Mesh Peer';

    this.store.set('security.extension', {
      duration,
      requestedAt: grantData.timestamp || new Date().toISOString(),
      expiresAt,
      grantedBy: granterName,
      granterDeviceId: grantData.granterDeviceId,
      grantId: grantData.grantId
    });
    this.store.set('security.offlineDeadline', expiresAt);
    this.resetCountdown();

    if (this.ledger) {
      this.ledger.append('security-window-extended-by-peer-grant', {
        duration,
        grantedBy: granterName,
        granterDeviceId: grantData.granterDeviceId,
        grantId: grantData.grantId,
        expiresAt
      });
    }

    this.emit('extension-grant-received', {
      duration,
      expiresAt,
      grantedBy: granterName,
      grantId: grantData.grantId
    });

    const myPublicKey = this.store.get('device.publicKey') || '';
    const myDeviceName = this.store.get('user.username') || 'NexVault Node';

    return {
      success: true,
      duration,
      expiresAt,
      grantedBy: granterName,
      ack: {
        type: 'extension-grant-ack',
        grantId: grantData.grantId,
        targetDeviceId: grantData.granterDeviceId,
        fromDeviceId: myPublicKey,
        fromDeviceName: myDeviceName,
        accepted: true,
        newDeadline: expiresAt
      }
    };
  }

  handlePeerApproval(approvalData) {
    if (!this.pendingExtension) return false;

    let peerKey = null;
    let peerName = 'Mesh Peer';
    let duration = this.pendingExtension.duration;
    let expiresAt = this.pendingExtension.expiresAt;
    let approved = true;

    if (typeof approvalData === 'string') {
      peerKey = approvalData;
    } else if (approvalData && typeof approvalData === 'object') {
      if (approvalData.approved === false) {
        this.emit('extension-rejected', {
          requestId: approvalData.requestId,
          reason: approvalData.reason || 'Rejected by peer'
        });
        return false;
      }
      peerKey = approvalData.approverPublicKey || approvalData.approverDeviceId || approvalData.publicKey || approvalData.from;
      peerName = approvalData.approverDeviceName || approvalData.deviceName || 'Mesh Peer';
      if (approvalData.duration) duration = approvalData.duration;
      if (approvalData.newDeadline) expiresAt = approvalData.newDeadline;
      if (approvalData.expiresAt) expiresAt = approvalData.expiresAt;
    }

    if (peerKey) {
      this.pendingExtension.approvals.add(peerKey);
    }
    
    // 1 approval from a trusted peer is sufficient for mesh extension
    if (this.pendingExtension.approvals.size >= 1) {
      this.store.set('security.extension', {
        duration,
        requestedAt: this.pendingExtension.requestedAt,
        expiresAt,
        approvers: Array.from(this.pendingExtension.approvals),
        approverName: peerName
      });
      this.store.set('security.offlineDeadline', expiresAt);
      if (this.ledger) {
        this.ledger.append('security-window-extended-with-approval', { 
          duration, 
          approvers: Array.from(this.pendingExtension.approvals),
          approverName: peerName,
          expiresAt
        });
      }
      
      this.emit('extension-approved', {
        duration,
        expiresAt,
        approverName: peerName
      });
      this.pendingExtension = null;
      return true;
    }
    return false;
  }

  triggerNuke() {
    console.log('NUKE: Emergency cryptographic destruction initiated');
    
    // Stop countdown
    this.resetCountdown();
    this.store.set('security.nukeScheduledAt', new Date().toISOString());
    
    // 30-minute warning
    this.nukeWarningTimer = setTimeout(() => {
      this.executeNuke();
    }, 30 * 60 * 1000); // 30 minutes
    
    console.log('Nuke scheduled in 30 minutes');
  }

  cancelNuke() {
    if (this.nukeWarningTimer) {
      clearTimeout(this.nukeWarningTimer);
      this.nukeWarningTimer = null;
      this.store.delete('security.nukeScheduledAt');
      if (this.ledger) this.ledger.append('nuke-cancelled');
    }
  }

  executeNuke() {
    try {
      // 1. Destroy encryption keys
      this.store.delete('device.secretKey');
      this.store.delete('user.derivedKey');
      this.store.delete('user.bootstrapToken');
      
      // 2. Delete sensitive data files
      const fs = require('fs');
      const path = require('path');
      
      const dataDir = this.userDataPath || path.join(__dirname, '..', '..', 'data');
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        files.forEach(file => {
          if (file.endsWith('.db') || file.endsWith('.key') || file === '.nexvault-store-key') {
            // Overwrite with random data before deletion
            const filePath = path.join(dataDir, file);
            const stats = fs.statSync(filePath);
            const randomData = crypto.randomBytes(stats.size);
            fs.writeFileSync(filePath, randomData);
            fs.unlinkSync(filePath);
          }
        });
      }
      
      // 3. Clear all store data
      this.store.clear();
      
      console.log('NUKE: All sensitive data destroyed');
      console.log('NUKE: Encryption keys destroyed');
      console.log('NUKE: Database files destroyed');
      
      // 4. Exit application
      const { app } = require('electron');
      app.exit(0);
      
    } catch (error) {
      console.error('NUKE: Error during destruction:', error);
      // Force exit on error
      process.exit(1);
    }
  }

  verifyTokenAuthorization(tokenId) {
    const storedToken = this.store.get('user.bootstrapToken');
    if (!storedToken) return false;
    
    return storedToken.tokenId === tokenId && 
           Date.now() < new Date(storedToken.expiresAt).getTime();
  }

  getTrustHistory() {
    return this.ledger ? this.ledger.list() : this.store.get('trust.events', []);
  }

  enforceAbsoluteDeadline() {
    const deadline = this.store.get('security.absoluteOfflineDeadline');
    if (deadline && Date.now() >= new Date(deadline).getTime()) {
      this.triggerNuke();
      return false;
    }
    return true;
  }

  verifyTrustHistory() {
    return this.ledger ? this.ledger.verify() : false;
  }

  checkIntegrity() {
    const result = this.integrity.verify(this.store);
    if (result.recorded) {
      this.integrity.record(this.store);
      if (this.ledger) this.ledger.append('integrity-manifest-recorded');
      return { ok: true, recorded: true };
    }
    if (result.ok) {
      this.integrity.record(this.store);
      if (this.ledger) this.ledger.append('integrity-check-ok');
      return { ok: true };
    }
    // Hash mismatches or unexpected new files = confirmed tamper attempt.
    const confirmation = this.integrity.report({ reason: 'storage-tamper', mismatches: result.mismatches });
    if (confirmation.confirmed) {
      if (this.ledger) this.ledger.append('tamper-confirmed', { mismatches: result.mismatches });
      this.triggerNuke();
    }
    return { ok: false, mismatches: result.mismatches, confirmed: confirmation.confirmed };
  }

  isWithinSecurityWindow() {
    const deadline = this.store.get('security.offlineDeadline');
    return Boolean(deadline && Date.now() < new Date(deadline).getTime());
  }

  getSecurityStatus() {
    this.enforceAbsoluteDeadline();
    const lastActive = this.store.get('security.lastActive');
    const extension = this.store.get('security.extension');
    const offlineDeadline = this.store.get('security.offlineDeadline');
    const absoluteOfflineDeadline = this.store.get('security.absoluteOfflineDeadline');
    
    let windowEnd = null;
    if (lastActive) {
      const lastActiveTime = new Date(lastActive).getTime();
      const windowMs = extension ? 
        new Date(extension.expiresAt).getTime() - lastActiveTime :
        24 * 60 * 60 * 1000;
      windowEnd = new Date(lastActiveTime + windowMs);
    }
    
    return {
      isWithinWindow: this.isWithinSecurityWindow(),
      lastActive,
      windowEnd,
      extension,
      offlineDeadline,
      absoluteOfflineDeadline,
      countdownActive: this.isCountdownActive,
      remainingSeconds: this.remainingSeconds
    };
  }
}

module.exports = NexVaultSecurity;