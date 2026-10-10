const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');

/**
 * NexVault Token - Device bootstrap identity
 * Uses ed25519 keypair for device identification and signing
 */
class NexVaultToken {
  constructor() {
    this.keyPair = null;
  }

  /**
   * Generate a new device identity (ed25519 keypair)
   */
  generate() {
    this.keyPair = nacl.sign.keyPair();
    return {
      publicKey: naclUtil.encodeBase64(this.keyPair.publicKey),
      secretKey: naclUtil.encodeBase64(this.keyPair.secretKey)
    };
  }

  /**
   * Load existing token from stored data
   */
  load(publicKeyBase64, secretKeyBase64) {
    this.keyPair = {
      publicKey: naclUtil.decodeBase64(publicKeyBase64),
      secretKey: naclUtil.decodeBase64(secretKeyBase64)
    };
    return this;
  }

  /**
   * Sign a message (used for device authentication)
   */
  sign(message) {
    if (!this.keyPair) throw new Error('Token not initialized');
    const messageBytes = naclUtil.decodeUTF8(message);
    const signature = nacl.sign.detached(messageBytes, this.keyPair.secretKey);
    return naclUtil.encodeBase64(signature);
  }

  /**
   * Verify a signature against a public key
   */
  static verify(message, signatureBase64, publicKeyBase64) {
    const messageBytes = naclUtil.decodeUTF8(message);
    const signature = naclUtil.decodeBase64(signatureBase64);
    const publicKey = naclUtil.decodeBase64(publicKeyBase64);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  }

  /**
   * Generate a bootstrap token string (public key + signature)
   */
  generateBootstrapToken() {
    const tokenId = 'nexvault-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
    const signature = this.sign(tokenId);
    return {
      tokenId,
      publicKey: naclUtil.encodeBase64(this.keyPair.publicKey),
      signature,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  }
}

/**
 * NexVault Core - Cryptographic operations
 */
class NexVaultCrypto {
  /**
   * Generate a shared secret using X25519 (asymmetric key exchange)
   */
  static generateKeyPair() {
    const keyPair = nacl.box.keyPair();
    return {
      publicKey: naclUtil.encodeBase64(keyPair.publicKey),
      secretKey: naclUtil.encodeBase64(keyPair.secretKey)
    };
  }

  /**
   * Encrypt data for a recipient (sealed box)
   */
  static encrypt(message, recipientPublicKeyBase64) {
    const messageBytes = naclUtil.decodeUTF8(message);
    const recipientPublicKey = naclUtil.decodeBase64(recipientPublicKeyBase64);
    const ephemeralKeyPair = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeralKeyPair.secretKey);
    if (!encrypted) throw new Error('Encryption failed');
    return {
      ciphertext: naclUtil.encodeBase64(encrypted),
      nonce: naclUtil.encodeBase64(nonce),
      ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey)
    };
  }

  /**
   * Decrypt data (sealed box)
   */
  static decrypt(encryptedData, recipientSecretKeyBase64) {
    const ciphertext = naclUtil.decodeBase64(encryptedData.ciphertext);
    const nonce = naclUtil.decodeBase64(encryptedData.nonce);
    const ephemeralPublicKey = naclUtil.decodeBase64(encryptedData.ephemeralPublicKey);
    const secretKey = naclUtil.decodeBase64(recipientSecretKeyBase64);
    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, secretKey);
    if (!decrypted) throw new Error('Decryption failed');
    return naclUtil.encodeUTF8(decrypted);
  }

  /**
   * Symmetric encryption (for local database encryption)
   */
  static encryptSymmetric(message, keyBase64) {
    const messageBytes = naclUtil.decodeUTF8(message);
    const key = naclUtil.decodeBase64(keyBase64);
    const nonce = nacl.randomBytes(24);
    const encrypted = nacl.secretbox(messageBytes, nonce, key);
    return {
      ciphertext: naclUtil.encodeBase64(encrypted),
      nonce: naclUtil.encodeBase64(nonce)
    };
  }

  /**
   * Symmetric decryption
   */
  static decryptSymmetric(encryptedData, keyBase64) {
    const ciphertext = naclUtil.decodeBase64(encryptedData.ciphertext);
    const nonce = naclUtil.decodeBase64(encryptedData.nonce);
    const key = naclUtil.decodeBase64(keyBase64);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) throw new Error('Decryption failed');
    return naclUtil.encodeUTF8(decrypted);
  }

  /**
   * Generate a random symmetric key
   */
  static generateSymmetricKey() {
    return naclUtil.encodeBase64(nacl.randomBytes(32));
  }
}

module.exports = { NexVaultToken, NexVaultCrypto, nacl, naclUtil };