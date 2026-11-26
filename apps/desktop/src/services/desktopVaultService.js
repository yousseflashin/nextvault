/**
 * apps/desktop/src/services/desktopVaultService.js
 *
 * Desktop Vault Business Logic & Domain Service
 *
 * Encapsulates vault business rules, credential CRUD, bulk operations,
 * and peer-to-peer sync reconciliation using the shared @nexvault/core engines.
 * Keeps main.js purely focused on Electron application lifecycle and IPC routing.
 */

'use strict';

const {
  SyncEngine,
  ConflictResolver,
  normalizeDomain,
  mergeCredentials
} = require('@nexvault/core');

class DesktopVaultService {
  /**
   * @param {Object} options
   * @param {Object} options.database NexVaultDatabase instance
   * @param {Object} options.security NexVaultSecurity instance
   */
  constructor({ database, security }) {
    this.database = database;
    this.security = security;
  }

  /**
   * Returns the current authenticated user context, or null if locked.
   */
  getUserContext() {
    return this.security.getUserContext();
  }

  /**
   * Checks if the master password is valid and unlocks user context.
   */
  authenticateUser(username, password) {
    const user = this.database.getUser(username);
    if (!user) {
      throw new Error('User not found');
    }
    const isValid = this.security.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid master password');
    }
    const encryptionKey = this.security.deriveMasterKey(password, user.username);
    this.security.setUserContext({
      username: user.username,
      encryptionKey,
      userId: user.id
    });
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        tokenPublicKey: user.token_public_key,
        tokenSignature: user.token_signature
      }
    };
  }

  /**
   * Locks the vault by clearing security session.
   */
  lockVault() {
    this.security.clearUserContext();
    return { success: true };
  }

  /**
   * Lists decrypted passwords for the active user.
   */
  listPasswords() {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');
    return this.database.listPasswords(user.id, context.encryptionKey);
  }

  /**
   * Adds or updates a password with Lamport clock increment.
   */
  addPassword(serviceName, password, username = '') {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');

    const existing = this.database.getPassword(user.id, serviceName);
    const logicalCounter = (Number(existing?.logical_counter) || 0) + 1;
    const updatedAt = Date.now();
    const deviceId = this.security.getDeviceId ? this.security.getDeviceId() : 'desktop-node';

    return this.database.addPassword(
      user.id,
      serviceName,
      password,
      context.encryptionKey,
      username,
      updatedAt,
      logicalCounter,
      deviceId,
      existing?.otp_secret || ''
    );
  }

  /**
   * Deletes a password and creates an incremental tombstone.
   */
  deletePassword(serviceName) {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');

    const existing = this.database.getPassword(user.id, serviceName);
    const logicalCounter = (Number(existing?.logical_counter) || 0) + 1;
    const deletedAt = Date.now();
    const deviceId = this.security.getDeviceId ? this.security.getDeviceId() : 'desktop-node';

    return this.database.deletePassword(
      user.id,
      serviceName,
      deletedAt,
      logicalCounter,
      deviceId
    );
  }

  /**
   * Lists OTP records for the active user.
   */
  listOTPs() {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');
    return this.database.listOTPs(user.id, context.encryptionKey);
  }

  /**
   * Adds or updates an OTP secret.
   */
  addOTP(serviceName, secret) {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');

    const existing = this.database.getOtpSecretByService(user.id, serviceName);
    const logicalCounter = (Number(existing?.logical_counter) || 0) + 1;
    const updatedAt = Date.now();

    return this.database.addOTP(
      user.id,
      serviceName,
      secret,
      context.encryptionKey,
      updatedAt,
      logicalCounter
    );
  }

  /**
   * Deletes all passwords and generates tombstones.
   */
  deleteAllPasswords() {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');
    const now = Date.now();
    return this.database.deleteAllPasswords(user.id, now);
  }

  /**
   * Deletes all OTP secrets and generates tombstones.
   */
  deleteAllOTPs() {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');
    const now = Date.now();
    return this.database.deleteAllOTPs(user.id, now);
  }

  /**
   * Deletes all vault entries (both passwords and OTPs).
   */
  deleteAllVault() {
    const pwdRes = this.deleteAllPasswords();
    const otpRes = this.deleteAllOTPs();
    return {
      passwordsCount: pwdRes.count || 0,
      otpsCount: otpRes.count || 0,
      deletedServices: [...(pwdRes.deletedServices || []), ...(otpRes.deletedServices || [])]
    };
  }

  /**
   * Retrieves a single password by service name.
   */
  getPassword(serviceName) {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');
    const p = this.database.getPassword(user.id, serviceName);
    if (!p) return null;
    const credential = this.database.decryptData(p.encrypted_data, context.encryptionKey, p.iv);
    return {
      service: p.service_name,
      username: p.username || '',
      password: credential,
      otpSecret: p.otp_secret || '',
      updatedAt: p.updated_at,
      logicalCounter: p.logical_counter,
      peerId: p.peer_id
    };
  }

  /**
   * Deletes an OTP secret and creates a tombstone.
   */
  deleteOTP(serviceName) {
    const context = this.getUserContext();
    if (!context) throw new Error('Vault is locked');
    const user = this.database.getUser(context.username);
    if (!user) throw new Error('User not found');

    const deletedAt = Date.now();
    return this.database.deleteOtpSecret(user.id, serviceName, deletedAt);
  }

  /**
   * Reconciles incoming peer vault data using the shared cross-platform SyncEngine.
   *
   * @param {Object} vaultData Inbound vault payload from peer
   * @param {string} fromPeerId Peer device ID
   * @returns {{ stateChanged: boolean, stats: Object }}
   */
  reconcilePeerVaultSync(vaultData, fromPeerId) {
    const context = this.getUserContext();
    if (!context || !vaultData) return { stateChanged: false, stats: {} };
    const user = this.database.getUser(context.username);
    if (!user) return { stateChanged: false, stats: {} };

    // 1. Gather current local state from database
    const currentPasswords = this.database.listPasswords(user.id, context.encryptionKey) || [];
    const currentOtps = this.database.listOTPs(user.id, context.encryptionKey) || [];
    const currentDeleted = this.database.getDeletedRecords(user.id) || [];

    const localState = {
      passwords: currentPasswords.map(p => ({
        service: p.service_name,
        credential: p.password,
        username: p.username || '',
        otpSecret: p.otp_secret || '',
        updatedAt: Number(p.updated_at) || 0,
        logicalCounter: Number(p.logical_counter) || 0,
        peerId: p.peer_id || ''
      })),
      otps: currentOtps.map(o => ({
        service: o.service_name,
        secret: o.secret,
        updatedAt: Number(o.updated_at) || 0,
        logicalCounter: Number(o.logical_counter) || 0,
        peerId: o.peer_id || '',
        account: o.account || '',
        digits: o.digits || 6,
        period: o.period || 30,
        algorithm: o.algorithm || 'SHA1'
      })),
      deletedRecords: currentDeleted.map(d => ({
        service: d.service,
        type: d.type,
        deletedAt: Number(d.deletedAt) || 0,
        logicalCounter: Number(d.logicalCounter) || 0,
        peerId: d.peerId || ''
      }))
    };

    // 2. Deterministic conflict resolution & delta reconciliation via SyncEngine
    const result = SyncEngine.reconcileVaultData(localState, vaultData, fromPeerId);

    if (!result.stateChanged) {
      return { stateChanged: false, stats: result.stats };
    }

    // 3. Persist reconciled changes into SQLite
    // A. Reconcile tombstones
    for (const d of result.deletedRecords) {
      this.database.recordTombstone(
        user.id,
        d.service,
        d.type,
        d.deletedAt,
        d.logicalCounter,
        d.peerId
      );
    }

    // B. Reconcile passwords
    for (const p of result.passwords) {
      this.database.addPassword(
        user.id,
        p.service,
        p.credential,
        context.encryptionKey,
        p.username || '',
        p.updatedAt,
        p.logicalCounter,
        p.peerId,
        p.otpSecret || ''
      );
    }

    // C. Remove passwords deleted by tombstones
    for (const oldP of currentPasswords) {
      const match = result.passwords.some(p => {
        return normalizeDomain(p.service) === normalizeDomain(oldP.service_name) &&
               String(p.username || '').toLowerCase() === String(oldP.username || '').toLowerCase();
      });
      if (!match) {
        this.database.deletePassword(user.id, oldP.service_name, Date.now(), 0, fromPeerId);
      }
    }

    // D. Reconcile OTPs
    for (const o of result.otps) {
      this.database.addOTP(
        user.id,
        o.service,
        o.secret,
        context.encryptionKey,
        o.updatedAt
      );
    }

    // E. Remove OTPs deleted by tombstones
    for (const oldO of currentOtps) {
      const match = result.otps.some(o => {
        return normalizeDomain(o.service) === normalizeDomain(oldO.service_name);
      });
      if (!match) {
        this.database.deleteOtpSecret(user.id, oldO.service_name, Date.now());
      }
    }

    return { stateChanged: true, stats: result.stats };
  }

  /**
   * Prepares the full vault payload for peer synchronization.
   */
  getSyncPayload() {
    const context = this.getUserContext();
    if (!context) return null;
    const user = this.database.getUser(context.username);
    if (!user) return null;

    const passwords = this.database.listPasswords(user.id, context.encryptionKey) || [];
    const otps = this.database.listOTPs(user.id, context.encryptionKey) || [];
    const deleted = this.database.getDeletedRecords(user.id) || [];

    return SyncEngine.prepareSyncPayload({
      passwords: passwords.map(p => ({
        service: p.service_name,
        credential: p.password,
        username: p.username || '',
        otpSecret: p.otp_secret || '',
        updatedAt: p.updated_at,
        logicalCounter: p.logical_counter,
        peerId: p.peer_id
      })),
      otps: otps.map(o => ({
        service: o.service_name,
        secret: o.secret,
        updatedAt: o.updated_at,
        logicalCounter: o.logical_counter,
        peerId: o.peer_id
      })),
      deletedRecords: deleted.map(d => ({
        service: d.service,
        type: d.type,
        deletedAt: d.deletedAt,
        logicalCounter: d.logicalCounter,
        peerId: d.peerId
      }))
    });
  }
}

module.exports = DesktopVaultService;
