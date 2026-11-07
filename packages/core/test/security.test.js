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

  test('should schedule and cancel emergency nuke', () => {
    security.triggerNuke();
    expect(security.nukeWarningTimer).toBeDefined();
    security.cancelNuke();
    expect(security.nukeWarningTimer).toBeNull();
  });

  test('should create peer mesh extension request and apply upon approval', async () => {
    const reqResult = await security.extendSecurityWindow('1month', { mesh: true });
    expect(reqResult.success).toBe(true);
    expect(reqResult.pendingApproval).toBe(true);
    expect(reqResult.requestId).toBeDefined();

    // Generate approval response from a peer
    const approvalResponse = {
      type: 'extension-approval-response',
      requestId: reqResult.requestId,
      approved: true,
      approverDeviceId: 'peer-device-key-123',
      approverDeviceName: 'Pixel 8 Pro',
      duration: '1month',
      newDeadline: reqResult.newDeadline
    };

    const approved = security.handlePeerApproval(approvalResponse);
    expect(approved).toBe(true);

    const status = security.getSecurityStatus();
    expect(status.extension).toBeDefined();
    expect(status.extension.duration).toBe('1month');
    expect(status.extension.approverName).toBe('Pixel 8 Pro');
  });

  test('should handle peer extension rejection', async () => {
    const reqResult = await security.extendSecurityWindow('3months', { mesh: true });
    expect(reqResult.pendingApproval).toBe(true);

    let rejectedEvent = null;
    security.on('extension-rejected', (data) => {
      rejectedEvent = data;
    });

    const rejection = {
      type: 'extension-approval-response',
      requestId: reqResult.requestId,
      approved: false,
      reason: 'User declined'
    };

    const result = security.handlePeerApproval(rejection);
    expect(result).toBe(false);
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent.reason).toBe('User declined');
  });

  test('should grant peer extension and apply grant on target peer', () => {
    // Device A grants extension to Device B
    const targetPeerId = 'target-peer-device-id-999';
    const grantResult = security.grantPeerExtension(targetPeerId, '1month');
    expect(grantResult.success).toBe(true);
    expect(grantResult.grant).toBeDefined();
    expect(grantResult.grant.type).toBe('extension-grant');
    expect(grantResult.grant.targetDeviceId).toBe(targetPeerId);
    expect(grantResult.grant.duration).toBe('1month');

    // Device B receives and applies the grant
    const targetSecurity = new NexVaultSecurity();
    targetSecurity.initializeNewUser('targetuser', 'targetpassword');

    let grantReceivedEvent = null;
    targetSecurity.on('extension-grant-received', (data) => {
      grantReceivedEvent = data;
    });

    const applyResult = targetSecurity.applyPeerExtensionGrant(grantResult.grant);
    expect(applyResult.success).toBe(true);
    expect(applyResult.ack).toBeDefined();
    expect(applyResult.ack.type).toBe('extension-grant-ack');
    expect(applyResult.ack.accepted).toBe(true);
    expect(grantReceivedEvent).toBeDefined();

    const targetStatus = targetSecurity.getSecurityStatus();
    expect(targetStatus.extension).toBeDefined();
    expect(targetStatus.extension.duration).toBe('1month');
    expect(targetStatus.extension.grantedBy).toBeDefined();
  });
});