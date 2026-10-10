const Database = require('better-sqlite3-multiple-ciphers');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { nacl, naclUtil } = require('./crypto');
const { getStoreKey } = require('./storeKey');

class NexVaultDatabase {
  constructor(userDataPath) {
    // If userDataPath is provided (e.g., from Electron), use it. 
    // Otherwise fallback to local dir for testing.
    this.path = path.join(userDataPath || __dirname, 'nexvault.db');
    this.store = new Store({
      name: 'nexvault-security',
      cwd: userDataPath, // Store keys in the same location
      encryptionKey: getStoreKey()
    });
    this.databaseKey = this.getDatabaseKey();
    this.init();
  }

  getDatabaseKey() {
    let key = this.store.get('database.key');
    if (!key) {
      key = require('crypto').randomBytes(32).toString('hex');
      this.store.set('database.key', key);
    }
    return key;
  }

  init() {
    // Ensure data directory exists
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.path)) {
      this.createDatabase();
      return;
    }

    try {
      const db = this.openDatabase();
      db.prepare('SELECT count(*) AS count FROM sqlite_master').get();
      db.close();
    } catch {
      const legacyPath = `${this.path}.legacy-${Date.now()}`;
      fs.renameSync(this.path, legacyPath);
      this.createDatabase();
    }
  }

  createDatabase() {
    const db = this.openDatabase();
    
    // Create tables
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        token_public_key TEXT NOT NULL,
        token_signature TEXT NOT NULL,
        token_ephemeral_pubkey TEXT,
        token_ephemeral_nonce TEXT,
        token_ephemeral_secretkey TEXT,
        token_ephemeral_nonce2 TEXT,
        token_ephemeral_secretkey2 TEXT
      );

      CREATE TABLE passwords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        service_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        iv TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE otp_secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        otp_type TEXT NOT NULL,  -- TOTP, HOTP
        secret TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        iv TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    db.close();
  }

  openDatabase() {
    const db = new Database(this.path, { readonly: false });
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.pragma(`key='${this.databaseKey}'`);
    db.pragma('foreign_keys = ON');
    return db;
  }

  /**
   * Create or update user with token
   */
  createUser(username, passwordHash, tokenData = {}) {
    const db = this.getDb();
    
    // Store token data for future reference
    db.prepare(`
      INSERT INTO users (username, password_hash, token_public_key, token_signature, 
                         token_ephemeral_pubkey, token_ephemeral_nonce, 
                         token_ephemeral_secretkey, token_ephemeral_nonce2, token_ephemeral_secretkey2)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      username,
      passwordHash,
      tokenData.publicKey || null,
      tokenData.signature || null,
      tokenData.ephemeralPublicKey || null,
      tokenData.ephemeralNonce || null,
      tokenData.ephemeralSecretKey || null,
      tokenData.ephemeralNonce2 || null,
      tokenData.ephemeralSecretKey2 || null
    );

    return this.getUser(username);
  }

  /**
   * Get user by username
   */
  getUser(username) {
    return this.getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  /**
   * Get user by ID
   */
  getUserById(id) {
    return this.getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  /**
   * Add password for user
   */
  addPassword(userId, serviceName, passwordPlainText, encryptionKey) {
    const passwordHash = this.hashPassword(passwordPlainText);
    const iv = this.generateIv();
    const encryptedData = this.encryptData(passwordPlainText, encryptionKey, iv);
    
    this.getDb().prepare(`
      INSERT INTO passwords (user_id, service_name, password_hash, iv, encrypted_data)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, serviceName, passwordHash, iv, encryptedData);
  }

  /**
   * Get password for user and service
   */
  getPassword(userId, serviceName) {
    return this.getDb().prepare(`
      SELECT password_hash, iv, encrypted_data 
      FROM passwords 
      WHERE user_id = ? AND service_name = ?
    `).get(userId, serviceName);
  }

  /**
   * Get OTP secret for user
   */
  getOtpSecret(userId) {
    return this.getDb().prepare('SELECT * FROM otp_secrets WHERE user_id = ?').get(userId);
  }

  getOtpSecretByType(userId, otpType) {
    return this.getDb().prepare(
      'SELECT * FROM otp_secrets WHERE user_id = ? AND otp_type = ?'
    ).get(userId, otpType);
  }

  /**
   * Add OTP secret for user
   */
  addOtpSecret(userId, otpType, secretPlainText, encryptionKey) {
    const iv = this.generateIv();
    const encryptedData = this.encryptData(secretPlainText, encryptionKey, iv);
    
    this.getDb().prepare(`
      INSERT INTO otp_secrets (user_id, otp_type, secret, iv, encrypted_data)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, otpType, this.hashWithSalt(secretPlainText, iv), iv, encryptedData);
  }

  /**
   * Get all passwords for a user
   */
  getPasswords(userId) {
    return this.getDb().prepare('SELECT * FROM passwords WHERE user_id = ?').all(userId);
  }

  /**
   * Get all OTP secrets for a user
   */
  getOtpSecrets(userId) {
    return this.getDb().prepare('SELECT * FROM otp_secrets WHERE user_id = ?').all(userId);
  }

  /**
   * Generate random IV for encryption
   */
  generateIv() {
    return naclUtil.encodeBase64(nacl.randomBytes(24));
  }

  /**
   * Encrypt data using symmetric key
   */
  encryptData(plainText, symmetricKeyBase64, ivBase64) {
    const key = naclUtil.decodeBase64(symmetricKeyBase64);
    const nonce = ivBase64 ? naclUtil.decodeBase64(ivBase64) : nacl.randomBytes(24);
    const ciphertext = nacl.secretbox(naclUtil.decodeUTF8(plainText), nonce, key);
    return naclUtil.encodeBase64(ciphertext);
  }

  /**
   * Decrypt data using symmetric key
   */
  decryptData(cipherTextBase64, symmetricKeyBase64, ivBase64) {
    const key = naclUtil.decodeBase64(symmetricKeyBase64);
    const cipherText = naclUtil.decodeBase64(cipherTextBase64);
    if (!ivBase64) throw new Error('Nonce is required for decryption');
    const decrypted = nacl.secretbox.open(cipherText, naclUtil.decodeBase64(ivBase64), key);
    if (!decrypted) throw new Error('Decryption failed');
    return naclUtil.decodeUTF8(decrypted);
  }

  /**
   * Password hashing (simplified for now)
   */
  hashPassword(password) {
    // In a real implementation, use a proper password hashing algorithm like bcrypt
    // For simplicity, we'll use SHA-256 with a salt
    return this.hashWithSalt(password, 'nexvault-salt-123');
  }

  /**
   * Hash with salt
   */
  hashWithSalt(data, salt) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(salt + data);
    return hash.digest('hex');
  }

  /**
   * Get database connection
   */
  getDb() {
    return this.openDatabase();
  }
}

module.exports = NexVaultDatabase;