const SyncEngine = require('../syncEngine');

describe('Universal Synchronization Engine', () => {
  test('handles empty or null incoming data safely', () => {
    const local = { passwords: [{ service: 'google.com', credential: 'pass' }], otps: [], deletedRecords: [] };
    const res = SyncEngine.reconcileVaultData(local, null);
    expect(res.stateChanged).toBe(false);
    expect(res.passwords.length).toBe(1);
  });

  test('applies fresh incoming passwords and OTPs with logical clock preservation', () => {
    const local = { passwords: [], otps: [], deletedRecords: [] };
    const incoming = {
      passwords: [
        { service: 'https://github.com', credential: 'gh-secret-token', username: 'alice', logicalCounter: 3, peerId: 'peer-A' }
      ],
      otps: [
        { service: 'aws.amazon.com', secret: 'JBSWY3DPEHPK3PXP', logicalCounter: 2, peerId: 'peer-A' }
      ]
    };

    const result = SyncEngine.reconcileVaultData(local, incoming, 'peer-A');
    expect(result.stateChanged).toBe(true);
    expect(result.passwords.length).toBe(1);
    expect(result.passwords[0].service).toBe('https://github.com');
    expect(result.passwords[0].logicalCounter).toBe(3);
    expect(result.otps.length).toBe(1);
    expect(result.otps[0].secret).toBe('JBSWY3DPEHPK3PXP');
    expect(result.stats.appliedPasswords).toBe(1);
    expect(result.stats.appliedOtps).toBe(1);
  });

  test('applies tombstones to delete active records when tombstone clock is newer', () => {
    const local = {
      passwords: [
        { service: 'discord.com', credential: 'disc-password', logicalCounter: 2, peerId: 'p1', updatedAt: 1000 }
      ],
      otps: [
        { service: 'cloudflare.com', secret: 'CFTOTPKEY', logicalCounter: 1, peerId: 'p1', updatedAt: 1000 }
      ],
      deletedRecords: []
    };

    const incoming = {
      deleted: [
        { service: 'https://discord.com', type: 'password', logicalCounter: 3, peerId: 'p2', deletedAt: 2000 },
        { service: 'cloudflare.com', type: 'otp', logicalCounter: 2, peerId: 'p2', deletedAt: 2000 }
      ]
    };

    const result = SyncEngine.reconcileVaultData(local, incoming, 'p2');
    expect(result.stateChanged).toBe(true);
    expect(result.passwords.length).toBe(0);
    expect(result.otps.length).toBe(0);
    expect(result.deletedRecords.length).toBe(2);
    expect(result.stats.appliedTombstones).toBe(2);
  });

  test('tombstones suppress older incoming records', () => {
    const local = {
      passwords: [],
      otps: [],
      deletedRecords: [
        { service: 'gitlab.com', type: 'password', logicalCounter: 5, peerId: 'p1', deletedAt: 5000 }
      ]
    };

    const incoming = {
      passwords: [
        { service: 'gitlab.com', credential: 'stale-pass', logicalCounter: 4, peerId: 'p2', updatedAt: 4000 }
      ]
    };

    const result = SyncEngine.reconcileVaultData(local, incoming, 'p2');
    expect(result.stateChanged).toBe(false);
    expect(result.passwords.length).toBe(0);
    expect(result.stats.skippedRecords).toBe(1);
    expect(result.deletedRecords.length).toBe(1);
  });

  test('newer incoming record resurrects previously deleted tombstone', () => {
    const local = {
      passwords: [],
      otps: [],
      deletedRecords: [
        { service: 'slack.com', type: 'password', logicalCounter: 2, peerId: 'p1', deletedAt: 2000 }
      ]
    };

    const incoming = {
      passwords: [
        { service: 'slack.com', credential: 'recreated-slack-pass', logicalCounter: 3, peerId: 'p2', updatedAt: 3000 }
      ]
    };

    const result = SyncEngine.reconcileVaultData(local, incoming, 'p2');
    expect(result.stateChanged).toBe(true);
    expect(result.passwords.length).toBe(1);
    expect(result.passwords[0].credential).toBe('recreated-slack-pass');
    expect(result.deletedRecords.length).toBe(0); // Tombstone removed on resurrection
    expect(result.stats.resurrectedRecords).toBe(1);
  });

  test('prepareSyncPayload sanitizes and formats wire structure', () => {
    const state = {
      passwords: [
        { service: 'github.com', credential: 'pwd', username: 'dev', logicalCounter: 1, peerId: 'p1' }
      ],
      otps: [
        { service: 'github.com', secret: 'TOTP', logicalCounter: 1, peerId: 'p1' }
      ],
      deletedRecords: [
        { service: 'old.com', type: 'password', logicalCounter: 2, peerId: 'p1', deletedAt: 1234 }
      ]
    };

    const payload = SyncEngine.prepareSyncPayload(state);
    expect(payload).toHaveProperty('passwords');
    expect(payload).toHaveProperty('otps');
    expect(payload).toHaveProperty('deleted');
    expect(payload.passwords[0].service).toBe('github.com');
    expect(payload.deleted[0].service).toBe('old.com');
  });

  test('computeDigest generates key-based clock catalog', () => {
    const state = {
      passwords: [
        { service: 'https://login.live.com', credential: 'p', username: 'test@live.com', logicalCounter: 4, peerId: 'node-A' }
      ],
      otps: [],
      deletedRecords: []
    };

    const digest = SyncEngine.computeDigest(state);
    expect(digest['pwd:login.live.com:test@live.com']).toEqual({
      counter: 4,
      peerId: 'node-A',
      updatedAt: 0,
      isDeleted: false
    });
  });
});
