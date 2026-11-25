/**
 * NexVault Threat Defense: File & Asset Integrity Verifier
 * Verifies binary checksums, detect unauthorized mutations, and ensures
 * zero-compromise runtime environment integrity.
 */

const crypto = require('crypto');
const fs = require('fs');

class IntegrityAuditor {
  /**
   * Computes SHA-256 digest of a local file.
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  static computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return reject(new Error(`File not found: ${filePath}`));
      }
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  /**
   * Verifies a file against an expected SHA-256 hash.
   * @param {string} filePath 
   * @param {string} expectedHash 
   * @returns {Promise<{ valid: boolean, actualHash: string, expectedHash: string }>}
   */
  static async verifyFile(filePath, expectedHash) {
    try {
      const actualHash = await this.computeFileHash(filePath);
      const cleanExpected = String(expectedHash).trim().toLowerCase();
      return {
        valid: actualHash === cleanExpected,
        actualHash,
        expectedHash: cleanExpected
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message,
        expectedHash
      };
    }
  }

  /**
   * Evaluates memory or string payload integrity against expected SHA-256.
   * @param {string|Buffer} content 
   * @param {string} expectedHash 
   * @returns {boolean}
   */
  static verifyBuffer(content, expectedHash) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return hash === String(expectedHash).trim().toLowerCase();
  }
}

module.exports = { IntegrityAuditor };
