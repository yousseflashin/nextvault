/**
 * packages/core/conflictResolver.js
 *
 * NexVault Universal Conflict Resolution & Logical Ordering Engine
 *
 * Provides deterministic conflict resolution, Lamport logical clock ordering,
 * peer tie-breaking, tombstone reconciliation, and domain-aware credential merging
 * across all platforms (Desktop, Mobile, Extension, Relay).
 */

'use strict';

const { normalizeDomain } = require('./domainUtils');

/**
 * Deterministically orders two logical clocks.
 * 1. Higher logical counter wins.
 * 2. If counters are identical (concurrent mutation), lexicographical comparison
 *    of peer IDs deterministically breaks the tie across all distributed nodes.
 * 3. Fallback to physical timestamp (updatedAt/deletedAt) if clocks are equal or unversioned.
 *
 * @param {Object} a Clock or record with clock/logicalCounter/peerId/updatedAt
 * @param {Object} b Clock or record with clock/logicalCounter/peerId/updatedAt
 * @returns {number} 1 if a > b, -1 if a < b, 0 if identical
 */
function compareLogicalClocks(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const ca = Number(a.counter !== undefined ? a.counter : a.logicalCounter) || 0;
  const cb = Number(b.counter !== undefined ? b.counter : b.logicalCounter) || 0;

  if (ca > cb) return 1;
  if (ca < cb) return -1;

  const pa = String(a.peerId || '');
  const pb = String(b.peerId || '');

  if (pa > pb) return 1;
  if (pa < pb) return -1;

  const ua = Number(a.updatedAt || a.deletedAt || a.updated_at || a.deleted_at) || 0;
  const ub = Number(b.updatedAt || b.deletedAt || b.updated_at || b.deleted_at) || 0;

  if (ua > ub) return 1;
  if (ua < ub) return -1;

  return 0;
}

/**
 * Lamport Logical Clock for tracking distributed causal event order.
 */
class LamportClock {
  /**
   * @param {string} peerId Unique identifier for this replica node (e.g. device public key)
   * @param {number} [initialCounter=0] Starting logical counter
   */
  constructor(peerId, initialCounter = 0) {
    if (!peerId) throw new Error('LamportClock requires a valid peerId');
    this.peerId = String(peerId);
    this.counter = Math.max(0, parseInt(initialCounter, 10) || 0);
  }

  /**
   * Increments the local logical clock on local mutation
   * @returns {{ counter: number, peerId: string }}
   */
  tick() {
    this.counter += 1;
    return { counter: this.counter, peerId: this.peerId };
  }

  /**
   * Advances local clock upon receiving a remote event
   * @param {number} remoteCounter
   * @returns {{ counter: number, peerId: string }}
   */
  update(remoteCounter) {
    const rc = Math.max(0, parseInt(remoteCounter, 10) || 0);
    this.counter = Math.max(this.counter, rc);
    return { counter: this.counter, peerId: this.peerId };
  }

  /**
   * Compares two logical clocks deterministically
   */
  static compare(a, b) {
    return compareLogicalClocks(a, b);
  }
}

/**
 * Merges an incoming list of credentials (e.g. from Android Autofill or Bulk Import)
 * into an existing password list without clobbering accounts with distinct usernames
 * for the same service domain.
 *
 * @param {Array<Object>} vaultPasswords Existing stored credentials
 * @param {Array<Object>} incomingList Inbound credentials to merge
 * @param {string} [devicePublicKey='local-device'] Device identifier for clock attribution
 * @returns {{ passwords: Array<Object>, changed: boolean }}
 */
function mergeCredentials(vaultPasswords, incomingList, devicePublicKey = 'local-device') {
  const passwords = Array.isArray(vaultPasswords) ? [...vaultPasswords] : [];
  let changed = false;

  if (!Array.isArray(incomingList) || incomingList.length === 0) {
    return { passwords, changed };
  }

  for (const item of incomingList) {
    if (!item) continue;
    const service = String(item.service || item.rawService || '').trim();
    const password = String(item.password || item.credential || '');
    if (!service || !password) continue;
    const username = String(item.username || '').trim();
    const target = normalizeDomain(service);

    const existingIdx = passwords.findIndex(entry => {
      const matchDomain = normalizeDomain(entry.service) === target;
      if (!matchDomain) return false;
      const entryUser = String(entry.username || '').trim().toLowerCase();
      const nativeUser = username.toLowerCase();

      // If both have usernames, they must match exactly
      if (entryUser && nativeUser) {
        return entryUser === nativeUser;
      }
      // If either username is empty, only match if BOTH are empty
      return !entryUser && !nativeUser;
    });

    if (existingIdx >= 0) {
      const existing = passwords[existingIdx];
      if (existing.credential === password && (existing.username || '') === username) {
        continue;
      }
      passwords[existingIdx] = {
        ...existing,
        credential: password,
        username: username || existing.username || '',
        updatedAt: Date.now(),
        logicalCounter: (Number(existing.logicalCounter) || 0) + 1
      };
      changed = true;
    } else {
      passwords.push({
        service,
        credential: password,
        username,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        logicalCounter: 1,
        peerId: devicePublicKey
      });
      changed = true;
    }
  }

  return { passwords, changed };
}

/**
 * Resolves conflict between a remote record, an existing local record,
 * and an optional tombstone.
 *
 * @param {Object} remoteRecord Inbound record with clock information
 * @param {Object|null} localRecord Current local record (if any)
 * @param {Object|null} tombstone Tombstone for this item (if any)
 * @returns {'suppressed_by_tombstone'|'resurrect'|'update'|'keep_local'}
 */
function resolveRecordConflict(remoteRecord, localRecord, tombstone) {
  const remoteClock = {
    counter: Number(remoteRecord?.logicalCounter ?? remoteRecord?.clock?.counter) || 0,
    peerId: remoteRecord?.peerId ?? remoteRecord?.clock?.peerId ?? '',
    updatedAt: Number(remoteRecord?.updatedAt ?? remoteRecord?.updated_at) || 0
  };

  if (tombstone) {
    const tombClock = {
      counter: Number(tombstone.logicalCounter ?? tombstone.logical_counter) || 0,
      peerId: tombstone.peerId ?? tombstone.peer_id ?? '',
      deletedAt: Number(tombstone.deletedAt ?? tombstone.deleted_at) || 0
    };

    if (compareLogicalClocks(tombClock, remoteClock) >= 0) {
      return 'suppressed_by_tombstone';
    }

    if (!localRecord) {
      return 'resurrect';
    }
  }

  if (!localRecord) {
    return 'update';
  }

  const localClock = {
    counter: Number(localRecord.logicalCounter ?? localRecord.logical_counter) || 0,
    peerId: localRecord.peerId ?? localRecord.peer_id ?? '',
    updatedAt: Number(localRecord.updatedAt ?? localRecord.updated_at) || 0
  };

  if (compareLogicalClocks(remoteClock, localClock) > 0) {
    return 'update';
  }

  return 'keep_local';
}

module.exports = {
  compareLogicalClocks,
  LamportClock,
  mergeCredentials,
  resolveRecordConflict
};
