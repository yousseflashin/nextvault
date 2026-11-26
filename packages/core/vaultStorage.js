/**
 * packages/core/vaultStorage.js
 *
 * NexVault Storage Engine Abstraction Layer
 *
 * Decouples physical file-system and database persistence from
 * sync, conflict resolution, and domain business logic.
 */

'use strict';

/**
 * Base Vault Storage Interface
 */
class VaultStorage {
  async loadState() {
    throw new Error('VaultStorage.loadState() must be implemented by subclass');
  }

  async saveState(_state) {
    throw new Error('VaultStorage.saveState() must be implemented by subclass');
  }

  async recordTombstone(_service, _type, _deletedAt, _logicalCounter, _peerId) {
    throw new Error('VaultStorage.recordTombstone() must be implemented by subclass');
  }

  async applyReconciliation(_reconcileResult) {
    throw new Error('VaultStorage.applyReconciliation() must be implemented by subclass');
  }
}

/**
 * In-memory vault storage engine for unit tests, headless runners, and CLI.
 */
class MemoryVaultStorage extends VaultStorage {
  constructor(initialState = {}) {
    super();
    this.state = {
      passwords: Array.isArray(initialState.passwords) ? [...initialState.passwords] : [],
      otps: Array.isArray(initialState.otps) ? [...initialState.otps] : [],
      deletedRecords: Array.isArray(initialState.deletedRecords) ? [...initialState.deletedRecords] : []
    };
  }

  async loadState() {
    return {
      passwords: [...this.state.passwords],
      otps: [...this.state.otps],
      deletedRecords: [...this.state.deletedRecords]
    };
  }

  async saveState(newState) {
    this.state = {
      passwords: Array.isArray(newState?.passwords) ? [...newState.passwords] : [],
      otps: Array.isArray(newState?.otps) ? [...newState.otps] : [],
      deletedRecords: Array.isArray(newState?.deletedRecords) ? [...newState.deletedRecords] : []
    };
  }

  async recordTombstone(service, type, deletedAt = Date.now(), logicalCounter = 0, peerId = '') {
    const existing = this.state.deletedRecords.find(d => d.service === service && d.type === type);
    if (existing) {
      existing.deletedAt = deletedAt;
      existing.logicalCounter = logicalCounter;
      existing.peerId = peerId;
    } else {
      this.state.deletedRecords.push({ service, type, deletedAt, logicalCounter, peerId });
    }
  }

  async applyReconciliation(reconcileResult) {
    if (!reconcileResult) return;
    this.state.passwords = [...reconcileResult.passwords];
    this.state.otps = [...reconcileResult.otps];
    this.state.deletedRecords = [...reconcileResult.deletedRecords];
  }
}

module.exports = {
  VaultStorage,
  MemoryVaultStorage
};
