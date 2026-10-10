jest.mock('electron-store', () => {
  const storeData = {};
  return jest.fn(() => ({
    data: storeData,
    get: jest.fn((key) => storeData[key]),
    set: jest.fn((key, value) => { storeData[key] = value; }),
    delete: jest.fn((key) => { delete storeData[key]; }),
    clear: jest.fn(() => { Object.keys(storeData).forEach(k => delete storeData[k]); })
  }));
});

const NexVaultSecurity = require('@nexvault/core/security');

describe('NexVault Security', () => {
  let security;

  beforeEach(() => {
    security = new NexVaultSecurity();
  });

  test('should initialize new user', () => {
    const result = security.initializeNewUser('testuser', 'testpassword');
    
    expect(result.publicKey).toBeDefined();
    expect(result.bootstrapToken).toBeDefined();
    expect(result.tokenId).toBeDefined();
  });

  test('should derive key from password', () => {
    const key1 = security.deriveKeyFromPassword('password123', 'salt456');
    const key2 = security.deriveKeyFromPassword('password123', 'salt456');
    const key3 = security.deriveKeyFromPassword('different', 'salt456');
    
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  test('should authenticate user with correct credentials', () => {
    // First initialize a user
    security.initializeNewUser('testuser', 'testpassword');
    
    // Then authenticate
    const result = security.authenticate('testuser', 'testpassword');
    expect(result.success).toBe(true);
  });

  test('should reject authentication with wrong password', () => {
    // First initialize a user
    security.initializeNewUser('testuser', 'testpassword');
    
    // Try wrong password
    const result = security.authenticate('testuser', 'wrongpassword');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should start security countdown', () => {
    security.startSecurityCountdown();
    expect(security.isCountdownActive).toBe(true);
    
    // Clean up
    security.resetCountdown();
    expect(security.isCountdownActive).toBe(false);
  });

  test('should reset security countdown', () => {
    security.startSecurityCountdown();
    expect(security.isCountdownActive).toBe(true);
    
    security.resetCountdown();
    expect(security.isCountdownActive).toBe(false);
  });

  test('should extend security window', async () => {
    const result = await security.extendSecurityWindow('1week');
    expect(result.success).toBe(true);
    expect(result.duration).toBe('1week');
    expect(result.expiresAt).toBeDefined();
  });

  test('should reject invalid extension duration', async () => {
    try {
      await security.extendSecurityWindow('invalid');
    } catch (error) {
      expect(error.message).toContain('Invalid');
    }
  });

  test('should get security status', () => {
    const status = security.getSecurityStatus();
    expect(status).toHaveProperty('isWithinWindow');
    expect(status).toHaveProperty('lastActive');
    expect(status).toHaveProperty('windowEnd');
    expect(status).toHaveProperty('extension');
    expect(status).toHaveProperty('countdownActive');
  });
});