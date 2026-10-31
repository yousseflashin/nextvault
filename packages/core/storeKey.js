const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function resolveKeyPath(baseDir) {
  if (baseDir) return path.join(baseDir, '.nexvault-store-key');
  if (process.env.NEXVAULT_DATA_DIR) return path.join(process.env.NEXVAULT_DATA_DIR, '.nexvault-store-key');
  return path.join(__dirname, '..', '..', 'data', '.nexvault-store-key');
}

const keyPath = resolveKeyPath();

function getStoreKey(baseDir) {
  const targetKeyPath = resolveKeyPath(baseDir);
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      if (fs.existsSync(targetKeyPath)) {
        return safeStorage.decryptString(fs.readFileSync(targetKeyPath));
      }
      fs.mkdirSync(path.dirname(targetKeyPath), { recursive: true });
      const key = crypto.randomBytes(32).toString('base64');
      fs.writeFileSync(targetKeyPath, safeStorage.encryptString(key), { mode: 0o600 });
      return key;
    }
  } catch {
  }
  return 'nexvault-security-store-test-key';
}

module.exports = { getStoreKey, keyPath, resolveKeyPath };
