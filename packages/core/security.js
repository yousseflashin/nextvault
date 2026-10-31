const { NexVaultToken, NexVaultCrypto } = require('../core/crypto');
const Store = require('electron-store');
const crypto = require('crypto');
const path = require('path');
const TrustLedger = require('./trustLedger');
const IntegrityMonitor = require('./integrity');
const { getStoreKey } = require('./storeKey');

const DAY_SECONDS = 24 * 60 * 60;
const MAX_EXTENDED_SECONDS = 30 * DAY_SECONDS;
const ABSOLUTE_OFFLINE_SECONDS = 90 * DAY_SECONDS;

class NexVaultSecurity {
  constructor(userDataPath) {
    this.userDataPath = userDataPath || (process.env.NEXVAULT_DATA_DIR || path.join(__dirname, '..', '..', 'data'));
    this.store = new Store({
      name: 'nexvault-security',
      cwd: userDataPath,
      encryptionKey: getStoreKey(this.userDataPath)
    });
    this.token = new NexVaultToken();
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

  async extendSecurityWindow(duration) {
    const extensions = {
      '1week': 7 * 24 * 60 * 60,
      '1month': 30 * 24 * 60 * 60,
      '3months': ABSOLUTE_OFFLINE_SECONDS
    };
    
    const seconds = extensions[duration];
    if (!seconds) {
      throw new Error('Invalid extension duration');
    }

    if (seconds > MAX_EXTENDED_SECONDS) {
      // Record extension request requiring approval
      this.pendingExtension = {
        duration,
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
        approvals: new Set()
      };
      
      // Emit event so the UI/Grid can broadcast the approval request to peers
      setImmediate(() => {
        const { ipcMain } = require('electron');
        const windows = require('electron').BrowserWindow.getAllWindows();
        if (windows[0]) {
          windows[0].webContents.send('broadcast-approval-request', { duration });
        }
      });
      
      return { success: true, pendingApproval: true, duration };
    }
    
    // Normal extension (1 week / 1 month)
    this.store.set('security.extension', {
      duration,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString()
    });
    this.store.set('security.offlineDeadline', new Date(Date.now() + seconds * 1000).toISOString());
    if (this.ledger) this.ledger.append('security-window-extended', { duration });
    
    return { success: true, pendingApproval: false, duration, expiresAt: this.store.get('security.extension').expiresAt };
  }

  handlePeerApproval(peerPublicKey) {
    if (!this.pendingExtension) return false;
    
    // A real implementation would verify the peerPublicKey is in our trusted ledger.
    // For now, any connected peer approval counts.
    this.pendingExtension.approvals.add(peerPublicKey);
    
    // We need 1 approval from a trusted peer to grant the 3-month extension
    if (this.pendingExtension.approvals.size >= 1) {
      this.store.set('security.extension', {
        duration: this.pendingExtension.duration,
        requestedAt: this.pendingExtension.requestedAt,
        expiresAt: this.pendingExtension.expiresAt,
        approvers: Array.from(this.pendingExtension.approvals)
      });
      this.store.set('security.offlineDeadline', this.pendingExtension.expiresAt);
      if (this.ledger) this.ledger.append('security-window-extended-with-approval', { 
        duration: this.pendingExtension.duration, 
        approvers: Array.from(this.pendingExtension.approvals) 
      });
      
      const { ipcMain } = require('electron');
      const windows = require('electron').BrowserWindow.getAllWindows();
      if (windows[0]) {
        windows[0].webContents.send('extension-approved', { duration: this.pendingExtension.duration });
      }
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