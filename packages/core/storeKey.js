const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, '..', '..', 'data', '.nexvault-store-key');

function getStoreKey() {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      if (fs.existsSync(keyPath)) {
        return safeStorage.decryptString(fs.readFileSync(keyPath));
      }
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      const key = crypto.randomBytes(32).toString('base64');
      fs.writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
      return key;
    }
  } catch {
  }
  return 'nexvault-security-store-test-key';
}

module.exports = { getStoreKey, keyPath };
