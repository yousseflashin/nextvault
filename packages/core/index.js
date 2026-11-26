'use strict';

let _database = null;
let _security = null;

module.exports = {
  // Universal Cross-Platform Engines
  compareLogicalClocks: require('./conflictResolver').compareLogicalClocks,
  LamportClock: require('./conflictResolver').LamportClock,
  mergeCredentials: require('./conflictResolver').mergeCredentials,
  resolveRecordConflict: require('./conflictResolver').resolveRecordConflict,
  ConflictResolver: require('./conflictResolver'),

  SyncEngine: require('./syncEngine'),

  VaultStorage: require('./vaultStorage').VaultStorage,
  MemoryVaultStorage: require('./vaultStorage').MemoryVaultStorage,

  normalizeDomain: require('./domainUtils').normalizeDomain,
  generateTotp: require('./otp').generateTotp,
  parseBulkImport: require('./importParser').parseBulkImport,
  parseOtpAuthUri: require('./importParser').parseOtpAuthUri,
  parseCsvRows: require('./importParser').parseCsvRows,

  MultiLeaderReplica: require('./multiLeaderReplica').MultiLeaderReplica,
  TrustLedger: require('./trustLedger'),
  IntegrityMonitor: require('./integrity'),
  NexGrid: require('./grid'),
  NexVaultToken: require('./crypto').NexVaultToken,
  NexVaultCrypto: require('./crypto').NexVaultCrypto,

  // Platform-specific storage engines (lazy getters so universal bundlers and web/mobile don't crash on sqlite native binaries)
  get NexVaultDatabase() {
    if (!_database) {
      _database = require('./database');
    }
    return _database;
  },
  set NexVaultDatabase(val) {
    _database = val;
  },

  get NexVaultSecurity() {
    if (!_security) {
      _security = require('./security');
    }
    return _security;
  },
  set NexVaultSecurity(val) {
    _security = val;
  }
};
