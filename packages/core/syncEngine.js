/**
 * packages/core/syncEngine.js
 *
 * NexVault Universal Multi-Leader Synchronization Engine
 *
 * Provides deterministic cross-platform vault delta reconciliation,
 * tombstone enforcement, resurrection handling, and sync payload preparation.
 * Pure and platform-agnostic: decoupled from network transport and physical storage.
 */

'use strict';

const { compareLogicalClocks } = require('./conflictResolver');
const { normalizeDomain } = require('./domainUtils');

class SyncEngine {
  /**
   * Reconciles incoming peer vault data against local vault state.
   *
   * @param {Object} localState
   * @param {Array<Object>} [localState.passwords]
   * @param {Array<Object>} [localState.otps]
   * @param {Array<Object>} [localState.deletedRecords]
   * @param {Object} incomingData
   * @param {Array<Object>} [incomingData.passwords]
   * @param {Array<Object>} [incomingData.otps]
   * @param {Array<Object>} [incomingData.deleted]
   * @param {string} [fromPeerId=''] Sender peer identifier for clock attribution
   * @returns {{
   *   stateChanged: boolean,
   *   passwords: Array<Object>,
   *   otps: Array<Object>,
   *   deletedRecords: Array<Object>,
   *   stats: {
   *     appliedPasswords: number,
   *     appliedOtps: number,
   *     appliedTombstones: number,
   *     resurrectedRecords: number,
   *     skippedRecords: number
   *   }
   * }}
   */
  static reconcileVaultData(localState, incomingData, fromPeerId = '') {
    const passwords = Array.isArray(localState?.passwords) ? [...localState.passwords] : [];
    const otps = Array.isArray(localState?.otps) ? [...localState.otps] : [];
    const deletedRecords = Array.isArray(localState?.deletedRecords) ? [...localState.deletedRecords] : [];

    let stateChanged = false;
    const stats = {
      appliedPasswords: 0,
      appliedOtps: 0,
      appliedTombstones: 0,
      resurrectedRecords: 0,
      skippedRecords: 0
    };

    if (!incomingData || typeof incomingData !== 'object') {
      return { stateChanged, passwords, otps, deletedRecords, stats };
    }

    // 1. Process incoming tombstones / deletions
    const incomingDeleted = incomingData.deleted || incomingData.deletedRecords;
    if (Array.isArray(incomingDeleted)) {
      for (const d of incomingDeleted) {
        if (!d || !d.service) continue;
        const target = normalizeDomain(d.service);
        const remoteDeletedAt = Number(d.deletedAt || d.deleted_at) || Date.now();
        const remoteClock = {
          counter: Number(d.logicalCounter ?? d.logical_counter) || 0,
          peerId: d.peerId || d.peer_id || fromPeerId,
          updatedAt: remoteDeletedAt
        };

        if (d.type === 'otp') {
          const localIdx = otps.findIndex(o => normalizeDomain(o.service) === target);
          if (localIdx >= 0) {
            const localOtp = otps[localIdx];
            const localClock = {
              counter: Number(localOtp.logicalCounter ?? localOtp.logical_counter) || 0,
              peerId: localOtp.peerId || localOtp.peer_id || '',
              updatedAt: Number(localOtp.updatedAt ?? localOtp.updated_at) || 0
            };
            if (compareLogicalClocks(remoteClock, localClock) >= 0) {
              otps.splice(localIdx, 1);
              stateChanged = true;
              stats.appliedTombstones++;
            }
          }
        } else {
          // Password deletion
          const dUser = String(d.username || '').trim().toLowerCase();
          const localIdx = passwords.findIndex(p => {
            const matchDomain = normalizeDomain(p.service) === target;
            if (!matchDomain) return false;
            if (!dUser) return true; // tombstone without explicit username applies to domain
            const pUser = String(p.username || '').trim().toLowerCase();
            return pUser === dUser;
          });

          if (localIdx >= 0) {
            const localPwd = passwords[localIdx];
            const localClock = {
              counter: Number(localPwd.logicalCounter ?? localPwd.logical_counter) || 0,
              peerId: localPwd.peerId || localPwd.peer_id || '',
              updatedAt: Number(localPwd.updatedAt ?? localPwd.updated_at) || 0
            };
            if (compareLogicalClocks(remoteClock, localClock) >= 0) {
              passwords.splice(localIdx, 1);
              stateChanged = true;
              stats.appliedTombstones++;
            }
          }
        }

        // Record or update local tombstone
        const existingTombIdx = deletedRecords.findIndex(r => {
          return normalizeDomain(r.service) === target && r.type === d.type;
        });

        if (existingTombIdx >= 0) {
          const existingTomb = deletedRecords[existingTombIdx];
          const existingClock = {
            counter: Number(existingTomb.logicalCounter ?? existingTomb.logical_counter) || 0,
            peerId: existingTomb.peerId || existingTomb.peer_id || '',
            updatedAt: Number(existingTomb.deletedAt ?? existingTomb.deleted_at) || 0
          };
          if (compareLogicalClocks(remoteClock, existingClock) > 0) {
            deletedRecords[existingTombIdx] = {
              ...existingTomb,
              service: d.service,
              type: d.type,
              deletedAt: remoteDeletedAt,
              logicalCounter: remoteClock.counter,
              peerId: remoteClock.peerId
            };
          }
        } else {
          deletedRecords.push({
            service: d.service,
            type: d.type,
            deletedAt: remoteDeletedAt,
            logicalCounter: remoteClock.counter,
            peerId: remoteClock.peerId
          });
        }
      }
    }

    // 2. Reconcile passwords
    if (Array.isArray(incomingData.passwords)) {
      for (const p of incomingData.passwords) {
        if (!p || !p.service || !p.credential) continue;
        const target = normalizeDomain(p.service);
        const pUser = String(p.username || '').trim();
        const pUserLower = pUser.toLowerCase();
        const remoteUpdatedAt = Number(p.updatedAt ?? p.updated_at) || (p.createdAt ? new Date(p.createdAt).getTime() : Date.now());
        const remoteClock = {
          counter: Number(p.logicalCounter ?? p.logical_counter) || 0,
          peerId: p.peerId || p.peer_id || fromPeerId,
          updatedAt: remoteUpdatedAt
        };

        // Check if there is an existing tombstone
        const tombIdx = deletedRecords.findIndex(r => {
          return normalizeDomain(r.service) === target && r.type === 'password';
        });

        if (tombIdx >= 0) {
          const tomb = deletedRecords[tombIdx];
          const tombClock = {
            counter: Number(tomb.logicalCounter ?? tomb.logical_counter) || 0,
            peerId: tomb.peerId || tomb.peer_id || '',
            updatedAt: Number(tomb.deletedAt ?? tomb.deleted_at) || 0
          };

          if (compareLogicalClocks(tombClock, remoteClock) >= 0) {
            stats.skippedRecords++;
            continue; // Tombstone is newer or concurrent tie-break winner; password remains deleted
          }

          // Incoming password is strictly newer than tombstone: resurrect!
          deletedRecords.splice(tombIdx, 1);
          stateChanged = true;
          stats.resurrectedRecords++;
        }

        // Check matching local password
        const existingIdx = passwords.findIndex(x => {
          if (normalizeDomain(x.service) !== target) return false;
          const xUser = String(x.username || '').trim().toLowerCase();
          if (xUser && pUserLower) {
            return xUser === pUserLower;
          }
          return !xUser && !pUserLower;
        });

        if (existingIdx >= 0) {
          const localPwd = passwords[existingIdx];
          const localClock = {
            counter: Number(localPwd.logicalCounter ?? localPwd.logical_counter) || 0,
            peerId: localPwd.peerId || localPwd.peer_id || '',
            updatedAt: Number(localPwd.updatedAt ?? localPwd.updated_at) || 0
          };

          if (compareLogicalClocks(remoteClock, localClock) > 0) {
            passwords[existingIdx] = {
              service: p.service,
              credential: p.credential,
              username: pUser || localPwd.username || '',
              otpSecret: p.otpSecret || localPwd.otpSecret || '',
              createdAt: p.createdAt || localPwd.createdAt || new Date().toISOString(),
              updatedAt: remoteUpdatedAt,
              logicalCounter: remoteClock.counter,
              peerId: remoteClock.peerId
            };
            stateChanged = true;
            stats.appliedPasswords++;
          } else {
            stats.skippedRecords++;
          }
        } else {
          // New password entry
          passwords.push({
            service: p.service,
            credential: p.credential,
            username: pUser,
            otpSecret: p.otpSecret || '',
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: remoteUpdatedAt,
            logicalCounter: remoteClock.counter || 1,
            peerId: remoteClock.peerId
          });
          stateChanged = true;
          stats.appliedPasswords++;
        }
      }
    }

    // 3. Reconcile OTPs
    if (Array.isArray(incomingData.otps)) {
      for (const o of incomingData.otps) {
        if (!o || !o.service || !o.secret) continue;
        const target = normalizeDomain(o.service);
        const remoteUpdatedAt = Number(o.updatedAt ?? o.updated_at) || (o.createdAt ? new Date(o.createdAt).getTime() : Date.now());
        const remoteClock = {
          counter: Number(o.logicalCounter ?? o.logical_counter) || 0,
          peerId: o.peerId || o.peer_id || fromPeerId,
          updatedAt: remoteUpdatedAt
        };

        const tombIdx = deletedRecords.findIndex(r => {
          return normalizeDomain(r.service) === target && r.type === 'otp';
        });

        if (tombIdx >= 0) {
          const tomb = deletedRecords[tombIdx];
          const tombClock = {
            counter: Number(tomb.logicalCounter ?? tomb.logical_counter) || 0,
            peerId: tomb.peerId || tomb.peer_id || '',
            updatedAt: Number(tomb.deletedAt ?? tomb.deleted_at) || 0
          };

          if (compareLogicalClocks(tombClock, remoteClock) >= 0) {
            stats.skippedRecords++;
            continue;
          }

          // Resurrect OTP
          deletedRecords.splice(tombIdx, 1);
          stateChanged = true;
          stats.resurrectedRecords++;
        }

        const existingIdx = otps.findIndex(x => normalizeDomain(x.service) === target);
        if (existingIdx >= 0) {
          const localOtp = otps[existingIdx];
          const localClock = {
            counter: Number(localOtp.logicalCounter ?? localOtp.logical_counter) || 0,
            peerId: localOtp.peerId || localOtp.peer_id || '',
            updatedAt: Number(localOtp.updatedAt ?? localOtp.updated_at) || 0
          };

          if (compareLogicalClocks(remoteClock, localClock) > 0) {
            otps[existingIdx] = {
              service: o.service,
              secret: o.secret,
              createdAt: o.createdAt || localOtp.createdAt || new Date().toISOString(),
              updatedAt: remoteUpdatedAt,
              logicalCounter: remoteClock.counter,
              peerId: remoteClock.peerId,
              account: o.account || localOtp.account || '',
              digits: o.digits || localOtp.digits || 6,
              period: o.period || localOtp.period || 30,
              algorithm: o.algorithm || localOtp.algorithm || 'SHA1'
            };
            stateChanged = true;
            stats.appliedOtps++;
          } else {
            stats.skippedRecords++;
          }
        } else {
          otps.push({
            service: o.service,
            secret: o.secret,
            createdAt: o.createdAt || new Date().toISOString(),
            updatedAt: remoteUpdatedAt,
            logicalCounter: remoteClock.counter || 1,
            peerId: remoteClock.peerId,
            account: o.account || '',
            digits: o.digits || 6,
            period: o.period || 30,
            algorithm: o.algorithm || 'SHA1'
          });
          stateChanged = true;
          stats.appliedOtps++;
        }
      }
    }

    return {
      stateChanged,
      passwords,
      otps,
      deletedRecords,
      stats
    };
  }

  /**
   * Prepares a clean payload ready for peer-to-peer transmission.
   *
   * @param {Object} vaultState
   * @param {Array<Object>} [vaultState.passwords]
   * @param {Array<Object>} [vaultState.otps]
   * @param {Array<Object>} [vaultState.deletedRecords]
   * @returns {{ passwords: Array<Object>, otps: Array<Object>, deleted: Array<Object> }}
   */
  static prepareSyncPayload(vaultState) {
    const passwords = (vaultState?.passwords || []).map(p => ({
      service: p.service,
      credential: p.credential,
      username: p.username || '',
      otpSecret: p.otpSecret || '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      logicalCounter: p.logicalCounter || 0,
      peerId: p.peerId || ''
    }));

    const otps = (vaultState?.otps || []).map(o => ({
      service: o.service,
      secret: o.secret,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      logicalCounter: o.logicalCounter || 0,
      peerId: o.peerId || '',
      account: o.account || '',
      digits: o.digits || 6,
      period: o.period || 30,
      algorithm: o.algorithm || 'SHA1'
    }));

    const deleted = (vaultState?.deletedRecords || []).map(d => ({
      service: d.service,
      type: d.type,
      deletedAt: d.deletedAt,
      logicalCounter: d.logicalCounter || 0,
      peerId: d.peerId || ''
    }));

    return { passwords, otps, deleted };
  }

  /**
   * Generates a lightweight logical clock digest of all records.
   *
   * @param {Object} vaultState
   * @returns {Object} Digest map
   */
  static computeDigest(vaultState) {
    const digest = {};
    for (const p of (vaultState?.passwords || [])) {
      const key = `pwd:${normalizeDomain(p.service)}:${String(p.username || '').toLowerCase()}`;
      digest[key] = {
        counter: Number(p.logicalCounter) || 0,
        peerId: p.peerId || '',
        updatedAt: Number(p.updatedAt) || 0,
        isDeleted: false
      };
    }
    for (const o of (vaultState?.otps || [])) {
      const key = `otp:${normalizeDomain(o.service)}`;
      digest[key] = {
        counter: Number(o.logicalCounter) || 0,
        peerId: o.peerId || '',
        updatedAt: Number(o.updatedAt) || 0,
        isDeleted: false
      };
    }
    for (const d of (vaultState?.deletedRecords || [])) {
      const key = `${d.type === 'otp' ? 'otp' : 'pwd'}:${normalizeDomain(d.service)}`;
      digest[key] = {
        counter: Number(d.logicalCounter) || 0,
        peerId: d.peerId || '',
        deletedAt: Number(d.deletedAt) || 0,
        isDeleted: true
      };
    }
    return digest;
  }
}

module.exports = SyncEngine;
