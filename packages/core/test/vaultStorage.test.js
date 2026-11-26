const { MemoryVaultStorage } = require('../vaultStorage');

describe('Storage Engine Abstraction', () => {
  test('initializes with empty or specified state', async () => {
    const storage = new MemoryVaultStorage();
    const state = await storage.loadState();
    expect(state.passwords).toEqual([]);
    expect(state.otps).toEqual([]);
    expect(state.deletedRecords).toEqual([]);
  });

  test('saves and loads state safely with isolation', async () => {
    const storage = new MemoryVaultStorage();
    await storage.saveState({
      passwords: [{ service: 'protonmail.com', credential: 'enc' }],
      otps: [],
      deletedRecords: []
    });

    const state = await storage.loadState();
    expect(state.passwords.length).toBe(1);
    expect(state.passwords[0].service).toBe('protonmail.com');

    // Mutating loaded array does not corrupt internal state
    state.passwords.push({ service: 'corrupt.com' });
    const fresh = await storage.loadState();
    expect(fresh.passwords.length).toBe(1);
  });

  test('records and updates tombstones', async () => {
    const storage = new MemoryVaultStorage();
    await storage.recordTombstone('github.com', 'password', 1000, 1, 'peer-1');
    let state = await storage.loadState();
    expect(state.deletedRecords.length).toBe(1);
    expect(state.deletedRecords[0].logicalCounter).toBe(1);

    await storage.recordTombstone('github.com', 'password', 2000, 2, 'peer-2');
    state = await storage.loadState();
    expect(state.deletedRecords.length).toBe(1);
    expect(state.deletedRecords[0].logicalCounter).toBe(2);
    expect(state.deletedRecords[0].peerId).toBe('peer-2');
  });

  test('applies reconciliation result atomically', async () => {
    const storage = new MemoryVaultStorage();
    await storage.applyReconciliation({
      passwords: [{ service: 'service1.org', credential: 'pwd' }],
      otps: [{ service: 'service1.org', secret: 'TOTP' }],
      deletedRecords: [{ service: 'old.org', type: 'password' }]
    });

    const state = await storage.loadState();
    expect(state.passwords.length).toBe(1);
    expect(state.otps.length).toBe(1);
    expect(state.deletedRecords.length).toBe(1);
  });
});
