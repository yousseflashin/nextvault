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
    this._db = null;
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
      try {
        const columns = db.pragma('table_info(otp_secrets)');
        if (Array.isArray(columns) && !columns.some(c => c.name === 'service_name')) {
          db.exec('ALTER TABLE otp_secrets ADD COLUMN service_name TEXT DEFAULT ""');
        }
        const passCols = db.pragma('table_info(passwords)');
        if (Array.isArray(passCols) && !passCols.some(c => c.name === 'username')) {
          db.exec('ALTER TABLE passwords ADD COLUMN username TEXT DEFAULT ""');
        }
      } catch {}
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
        username TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        iv TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE otp_secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        service_name TEXT NOT NULL,
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
    const existing = this.getUser(username);

    const publicKey = tokenData.publicKey ?? existing?.token_public_key ?? '';
    const signature = tokenData.signature ?? existing?.token_signature ?? '';
    const ephemeralPublicKey = tokenData.ephemeralPublicKey ?? existing?.token_ephemeral_pubkey ?? null;
    const ephemeralNonce = tokenData.ephemeralNonce ?? existing?.token_ephemeral_nonce ?? null;
    const ephemeralSecretKey = tokenData.ephemeralSecretKey ?? existing?.token_ephemeral_secretkey ?? null;
    const ephemeralNonce2 = tokenData.ephemeralNonce2 ?? existing?.token_ephemeral_nonce2 ?? null;
    const ephemeralSecretKey2 = tokenData.ephemeralSecretKey2 ?? existing?.token_ephemeral_secretkey2 ?? null;

    if (existing) {
      db.prepare(`
        UPDATE users SET 
          password_hash = ?, 
          token_public_key = ?, 
          token_signature = ?, 
          token_ephemeral_pubkey = ?, 
          token_ephemeral_nonce = ?, 
          token_ephemeral_secretkey = ?, 
          token_ephemeral_nonce2 = ?, 
          token_ephemeral_secretkey2 = ?
        WHERE username = ?
      `).run(
        passwordHash,
        publicKey,
        signature,
        ephemeralPublicKey,
        ephemeralNonce,
        ephemeralSecretKey,
        ephemeralNonce2,
        ephemeralSecretKey2,
        username
      );
    } else {
      db.prepare(`
        INSERT INTO users (username, password_hash, token_public_key, token_signature, 
                           token_ephemeral_pubkey, token_ephemeral_nonce, 
                           token_ephemeral_secretkey, token_ephemeral_nonce2, token_ephemeral_secretkey2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        username,
        passwordHash,
        publicKey,
        signature,
        ephemeralPublicKey,
        ephemeralNonce,
        ephemeralSecretKey,
        ephemeralNonce2,
        ephemeralSecretKey2
      );
    }

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
   * Add or update password for user
   */
  addPassword(userId, serviceName, passwordPlainText, encryptionKey, username = '') {
    const passwordHash = this.hashPassword(passwordPlainText);
    const iv = this.generateIv();
    const encryptedData = this.encryptData(passwordPlainText, encryptionKey, iv);
    
    const existing = this.getPassword(userId, serviceName);
    if (existing) {
      this.getDb().prepare(`
        UPDATE passwords SET username = ?, password_hash = ?, iv = ?, encrypted_data = ?, created_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND service_name = ?
      `).run(username, passwordHash, iv, encryptedData, userId, serviceName);
    } else {
      this.getDb().prepare(`
        INSERT INTO passwords (user_id, service_name, username, password_hash, iv, encrypted_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, serviceName, username, passwordHash, iv, encryptedData);
    }
  }

  /**
   * Delete password for user and service
   */
  deletePassword(userId, serviceName) {
    return this.getDb().prepare('DELETE FROM passwords WHERE user_id = ? AND service_name = ?').run(userId, serviceName);
  }

  /**
   * List passwords for user (for UI display)
   */
  listPasswords(userId) {
    const rows = this.getDb().prepare('SELECT service_name, username, created_at FROM passwords WHERE user_id = ? ORDER BY service_name ASC').all(userId);
    return rows.map(r => ({ service: r.service_name, username: r.username || '', createdAt: r.created_at }));
  }

  /**
   * Get password for user and service (smart domain and service matching)
   */
  getPassword(userId, serviceName) {
    if (!serviceName) return null;
    const clean = String(serviceName).trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
    const baseName = clean.includes('.') ? clean.split('.')[0] : clean;

    return this.getDb().prepare(`
      SELECT username, password_hash, iv, encrypted_data, service_name 
      FROM passwords 
      WHERE user_id = ? AND (
        LOWER(service_name) = LOWER(?)
        OR LOWER(service_name) = LOWER(?)
        OR LOWER(service_name) = LOWER(?)
        OR LOWER(?) LIKE '%' || LOWER(service_name) || '%'
        OR LOWER(service_name) LIKE '%' || LOWER(?) || '%'
      )
      ORDER BY 
        CASE 
          WHEN LOWER(service_name) = LOWER(?) THEN 1
          WHEN LOWER(service_name) = LOWER(?) THEN 2
          WHEN LOWER(service_name) = LOWER(?) THEN 3
          ELSE 4
        END,
        LENGTH(service_name) DESC
      LIMIT 1
    `).get(userId, serviceName, clean, baseName, clean, clean, serviceName, clean, baseName);
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

  getOtpSecretByService(userId, serviceName) {
    return this.getDb().prepare(
      'SELECT * FROM otp_secrets WHERE user_id = ? AND (service_name = ? OR otp_type = ?)'
    ).get(userId, serviceName, serviceName);
  }

  /**
   * Delete OTP secret by service
   */
  deleteOtpSecret(userId, serviceName) {
    return this.getDb().prepare(
      'DELETE FROM otp_secrets WHERE user_id = ? AND (service_name = ? OR otp_type = ?)'
    ).run(userId, serviceName, serviceName);
  }

  /**
   * List all OTP secrets for user
   */
  listOtpSecrets(userId) {
    const rows = this.getDb().prepare(
      'SELECT service_name, otp_type, created_at FROM otp_secrets WHERE user_id = ? ORDER BY service_name ASC'
    ).all(userId);
    return rows.map(r => ({ service: r.service_name || r.otp_type, otpType: r.otp_type, createdAt: r.created_at }));
  }

  /**
   * Add or update OTP secret for user
   * Supports:
   *   addOtpSecret(userId, serviceName, otpType, secretPlainText, encryptionKey)
   *   addOtpSecret(userId, otpType, secretPlainText, encryptionKey)
   *   addOtpSecret(userId, serviceName, secretPlainText, encryptionKey)
   */
  addOtpSecret(userId, arg2, arg3, arg4, arg5) {
    let serviceName = 'Default';
    let otpType = 'TOTP';
    let secretPlainText = '';
    let encryptionKey = '';

    if (arg5 !== undefined) {
      serviceName = arg2;
      otpType = arg3 || 'TOTP';
      secretPlainText = arg4;
      encryptionKey = arg5;
    } else if (arg2 === 'TOTP' || arg2 === 'HOTP') {
      otpType = arg2;
      serviceName = arg2;
      secretPlainText = arg3;
      encryptionKey = arg4;
    } else {
      serviceName = arg2;
      otpType = 'TOTP';
      secretPlainText = arg3;
      encryptionKey = arg4;
    }

    const iv = this.generateIv();
    const encryptedData = this.encryptData(secretPlainText, encryptionKey, iv);
    
    const existing = this.getOtpSecretByService(userId, serviceName);
    if (existing) {
      this.getDb().prepare(`
        UPDATE otp_secrets 
        SET service_name = ?, otp_type = ?, secret = ?, iv = ?, encrypted_data = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(serviceName, otpType, this.hashWithSalt(secretPlainText, iv), iv, encryptedData, existing.id);
    } else {
      this.getDb().prepare(`
        INSERT INTO otp_secrets (user_id, service_name, otp_type, secret, iv, encrypted_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, serviceName, otpType, this.hashWithSalt(secretPlainText, iv), iv, encryptedData);
    }
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
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(decrypted).toString('utf8');
    }
    return naclUtil.encodeUTF8(decrypted);
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
   * Get database connection (cached)
   */
  getDb() {
    if (!this._db) {
      this._db = this.openDatabase();
    }
    return this._db;
  }

  /**
   * Close database connection
   */
  close() {
    if (this._db) {
      try {
        this._db.close();
      } catch {}
      this._db = null;
    }
  }
}

module.exports = NexVaultDatabase;