const path = require('path');
const fs = require('fs');

// Mock SQLCipher-backed SQLite
jest.mock('better-sqlite3-multiple-ciphers', () => {
  const database = {
    prepare: jest.fn().mockReturnThis(),
    run: jest.fn(),
    get: jest.fn(() => ({ id: 1, username: 'testuser' })),
    all: jest.fn(),
    exec: jest.fn(),
    pragma: jest.fn(),
    close: jest.fn()
  };

  return jest.fn().mockImplementation(() => database);
});

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    const store = {
      data: {},
      get: jest.fn((key) => store.data[key]),
      set: jest.fn((key, value) => { store.data[key] = value; }),
      delete: jest.fn((key) => { delete store.data[key]; }),
      clear: jest.fn(() => { store.data = {}; })
    };
    return store;
  });
});

const NexVaultDatabase = require('@nexvault/core/database');

describe('NexVault Database', () => {
  let db;

  beforeEach(() => {
    // Clean up test database
    const testPath = path.join(__dirname, '..', '..', 'data', 'test-nexvault.db');
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
    db = new NexVaultDatabase();
  });

  test('should initialize database', () => {
    expect(db.path).toBeDefined();
  });

  test('should create database schema', () => {
    const Database = require('better-sqlite3-multiple-ciphers');
    const mockDb = new Database();
    expect(mockDb.exec).toHaveBeenCalled();
  });

  test('should create user', () => {
    const tokenData = {
      publicKey: 'test-public-key',
      signature: 'test-signature'
    };
    
    const result = db.createUser('testuser', 'hashedpassword', tokenData);
    expect(result).toBeDefined();
  });

  test('should get user', () => {
    db.createUser('testuser', 'hashedpassword', {
      publicKey: 'test-public-key',
      signature: 'test-signature'
    });
    
    const user = db.getUser('testuser');
    expect(user).toBeDefined();
  });

  test('should hash password', () => {
    const hash = db.hashPassword('testpassword');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  test('should not pass OTP plaintext to the database', () => {
    const Database = require('better-sqlite3-multiple-ciphers');
    const mockDb = new Database();
    const secret = 'JBSWY3DPEHPK3PXP';
    db.addOtpSecret(1, 'TOTP', secret, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(mockDb.run.mock.calls.some((call) => call.includes(secret))).toBe(false);
  });
});