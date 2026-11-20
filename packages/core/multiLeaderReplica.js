/**
 * packages/core/multiLeaderReplica.js
 *
 * NexVault Multi-Leader All-to-All Replica & CRDT State Engine
 *
 * Implements an autonomous multi-leader replica model where every client device
 * (Desktop, Mobile, Browser Extension) is a full local leader capable of immediate
 * zero-latency local writes. Conflict resolution relies on Lamport Logical Clocks
 * with deterministic peer tie-breaking, making synchronization completely immune
 * to system clock drift, manual time adjustments, or NTP backward jumps.
 */

'use strict';

class LamportClock {
  /**
   * @param {string} peerId Unique identifier for this replica node (e.g. Ed25519 device pubkey)
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
   * Deterministically orders two logical clocks.
   * Higher counter wins. If counter is equal (concurrent writes),
   * lexicographical comparison of peerId breaks the tie deterministically.
   *
   * @param {{ counter: number, peerId: string }} a
   * @param {{ counter: number, peerId: string }} b
   * @returns {number} 1 if a > b, -1 if a < b, 0 if identical
   */
  static compare(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const ca = Number(a.counter) || 0;
    const cb = Number(b.counter) || 0;

    if (ca > cb) return 1;
    if (ca < cb) return -1;

    const pa = String(a.peerId || '');
    const pb = String(b.peerId || '');

    if (pa > pb) return 1;
    if (pa < pb) return -1;

    return 0;
  }
}

class MultiLeaderReplica {
  /**
   * @param {string} peerId Unique device ID / public key of this replica node
   * @param {Map<string, Object>|Object} [initialRecords] Pre-existing record state
   */
  constructor(peerId, initialRecords = {}) {
    this.peerId = String(peerId);
    this.clock = new LamportClock(this.peerId);
    this.records = new Map();

    if (initialRecords instanceof Map) {
      for (const [k, v] of initialRecords.entries()) {
        this._loadRecord(k, v);
      }
    } else if (initialRecords && typeof initialRecords === 'object') {
      for (const [k, v] of Object.entries(initialRecords)) {
        this._loadRecord(k, v);
      }
    }
  }

  _loadRecord(id, r) {
    if (!id || !r) return;
    const c = r.clock?.counter || 0;
    if (c > this.clock.counter) {
      this.clock.counter = c;
    }
    this.records.set(String(id), { ...r });
  }

  /**
   * Creates or updates a record locally as an autonomous leader.
   * @param {string} id Stable unique identifier
   * @param {Object} data Record payload (service, username, password, otpSecret, notes, etc.)
   * @returns {Object} Stored record with Lamport clock
   */
  setRecord(id, data) {
    if (!id) throw new Error('Record id is required');
    const existing = this.records.get(String(id));
    const clock = this.clock.tick();

    const record = {
      id: String(id),
      service: String(data.service || existing?.service || ''),
      username: data.username !== undefined ? String(data.username) : (existing?.username || ''),
      password: data.password !== undefined ? String(data.password) : (existing?.password || ''),
      otpSecret: data.otpSecret !== undefined ? String(data.otpSecret) : (existing?.otpSecret || ''),
      notes: data.notes !== undefined ? String(data.notes) : (existing?.notes || ''),
      version: (existing?.version || 0) + 1,
      clock,
      isDeleted: false,
      updatedAtPhysical: Date.now()
    };

    this.records.set(String(id), record);
    return { ...record };
  }

  /**
   * Deletes a record by appending a tombstone with an incremented logical clock.
   * @param {string} id
   * @returns {Object|null}
   */
  deleteRecord(id) {
    if (!id) return null;
    const sid = String(id);
    const existing = this.records.get(sid);
    const clock = this.clock.tick();

    const tombstone = {
      id: sid,
      service: existing?.service || '',
      username: existing?.username || '',
      password: '',
      otpSecret: '',
      notes: '',
      version: (existing?.version || 0) + 1,
      clock,
      isDeleted: true,
      deletedAtPhysical: Date.now()
    };

    this.records.set(sid, tombstone);
    return { ...tombstone };
  }

  /**
   * Queries active non-deleted record
   * @param {string} id
   * @returns {Object|null}
   */
  getRecord(id) {
    const r = this.records.get(String(id));
    if (!r || r.isDeleted) return null;
    return { ...r };
  }

  /**
   * Returns raw record including tombstones for sync inspection
   * @param {string} id
   * @returns {Object|null}
   */
  getRawRecord(id) {
    const r = this.records.get(String(id));
    return r ? { ...r } : null;
  }

  /**
   * Returns all active non-deleted records
   * @returns {Object[]}
   */
  listRecords() {
    const active = [];
    for (const r of this.records.values()) {
      if (!r.isDeleted) active.push({ ...r });
    }
    return active;
  }

  /**
   * Generates a compact digest of the node's local records and tombstones
   * Shape: { [id]: { counter: number, peerId: string, isDeleted: boolean } }
   * @returns {Object}
   */
  getDigest() {
    const digest = {};
    for (const [id, r] of this.records.entries()) {
      digest[id] = {
        counter: r.clock?.counter || 0,
        peerId: r.clock?.peerId || '',
        isDeleted: Boolean(r.isDeleted)
      };
    }
    return digest;
  }

  /**
   * Computes delta records that this node has which are newer or missing from the remote digest.
   * @param {Object} remoteDigest
   * @returns {Object[]} Array of records to transmit to peer
   */
  computeDelta(remoteDigest = {}) {
    const delta = [];
    for (const [id, localRec] of this.records.entries()) {
      const remoteInfo = remoteDigest[id];
      if (!remoteInfo) {
        // Peer does not have this record at all
        delta.push({ ...localRec });
        continue;
      }

      const cmp = LamportClock.compare(localRec.clock, remoteInfo);
      if (cmp > 0) {
        // Local is strictly newer logically
        delta.push({ ...localRec });
      }
    }
    return delta;
  }

  /**
   * Applies incoming delta records from a peer using deterministic LWW conflict resolution.
   * @param {Object[]} deltaRecords
   * @returns {{ applied: number, skipped: number }}
   */
  applyDelta(deltaRecords = []) {
    let applied = 0;
    let skipped = 0;

    for (const remoteRec of deltaRecords) {
      if (!remoteRec || !remoteRec.id) continue;
      const id = String(remoteRec.id);
      const localRec = this.records.get(id);

      // Advance local Lamport clock beyond remote counter
      if (remoteRec.clock?.counter) {
        this.clock.update(remoteRec.clock.counter);
      }

      if (!localRec) {
        this.records.set(id, { ...remoteRec });
        applied++;
        continue;
      }

      const cmp = LamportClock.compare(remoteRec.clock, localRec.clock);
      if (cmp > 0) {
        // Remote is logically newer
        this.records.set(id, { ...remoteRec });
        applied++;
      } else {
        skipped++;
      }
    }

    return { applied, skipped };
  }
}

module.exports = {
  LamportClock,
  MultiLeaderReplica
};
