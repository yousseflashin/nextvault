const { NexVaultToken, NexVaultCrypto, nacl, naclUtil } = require('@nexvault/core/crypto');

describe('NexVault Token', () => {
  test('should generate a valid token keypair', () => {
    const token = new NexVaultToken();
    const keys = token.generate();
    
    expect(keys.publicKey).toBeDefined();
    expect(keys.secretKey).toBeDefined();
    expect(typeof keys.publicKey).toBe('string');
    expect(typeof keys.secretKey).toBe('string');
  });

  test('should sign and verify messages correctly', () => {
    const token = new NexVaultToken();
    token.generate();
    
    const message = 'test-message-123';
    const signature = token.sign(message);
    
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    
    const publicKey = naclUtil.encodeBase64(token.keyPair.publicKey);
    const verification = NexVaultToken.verify(message, signature, publicKey);
    expect(verification).toBe(true);
  });

  test('should generate unique bootstrap tokens', () => {
    const token = new NexVaultToken();
    token.generate();
    
    const token1 = token.generateBootstrapToken();
    const token2 = token.generateBootstrapToken();
    
    expect(token1.tokenId).toBeDefined();
    expect(token1.publicKey).toBeDefined();
    expect(token1.signature).toBeDefined();
    expect(token1.tokenId).not.toBe(token2.tokenId);
  });
});

describe('NexVault Crypto', () => {
  test('should generate asymmetric key pair for X25519', () => {
    const keyPair = NexVaultCrypto.generateKeyPair();
    
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.secretKey).toBeDefined();
    expect(typeof keyPair.publicKey).toBe('string');
    expect(typeof keyPair.secretKey).toBe('string');
  });

  test('should encrypt and decrypt symmetric data', () => {
    const symmetricKey = NexVaultCrypto.generateSymmetricKey();
    const message = 'sensitive-password-data';
    
    const encrypted = NexVaultCrypto.encryptSymmetric(message, symmetricKey);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.nonce).toBeDefined();
    
    const decrypted = NexVaultCrypto.decryptSymmetric(encrypted, symmetricKey);
    expect(decrypted).toBe(message);
  });

  test('should encrypt and decrypt for recipient', () => {
    const recipientKeys = NexVaultCrypto.generateKeyPair();
    const message = 'encrypted-message';
    
    const encrypted = NexVaultCrypto.encrypt(message, recipientKeys.publicKey);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.nonce).toBeDefined();
    expect(encrypted.ephemeralPublicKey).toBeDefined();
    
    const decrypted = NexVaultCrypto.decrypt(encrypted, recipientKeys.secretKey);
    expect(decrypted).toBe(message);
  });

  test('should fail decryption with wrong key', () => {
    const keyPair1 = NexVaultCrypto.generateKeyPair();
    const keyPair2 = NexVaultCrypto.generateKeyPair();
    const message = 'secret';
    
    const encrypted = NexVaultCrypto.encrypt(message, keyPair1.publicKey);
    
    expect(() => {
      NexVaultCrypto.decrypt(encrypted, keyPair2.secretKey);
    }).toThrow();
  });
});