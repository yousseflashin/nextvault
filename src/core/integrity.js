const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

/**
 * IntegrityMonitor - protects against tampering with protected storage.
 *
 * Maintains a stored SHA-256 manifest of every protected file. On startup
 * and on demand it re-hashes the files and compares them. A mismatch is a
 * confirmed security violation and can trigger the nuke process.
 *
 * Normal filesystem noise (backups, OS ops, crashes) is not treated as an
 * attacker: we only raise an alarm when the on-disk hash disagrees with the
 * last-known-good manifest, and the alarm is reported (not auto-destroyed) so
 * that human confirmation is required before any destructive action.
 */
class IntegrityMonitor {
  constructor(dataDir, manifestKey = 'security.integrityManifest', windowMs = 5 * 60 * 1000) {
    this.dataDir = dataDir;
    this.manifestKey = manifestKey;
    this.windowMs = windowMs; // new manifests are valid for 5 minutes
    this.violations = [];
    this.nukeThreshold = 3; // confirmed violations within the window
  }

  /**
   * Files whose on-disk hash must match the stored manifest.
   */
  protectedPaths() {
    return [
      'nexvault.db',
      '.nexvault-store-key',
      '.nexvault-security-store-key',
      '.nexvault.db',
    ].map(f => path.join(this.dataDir, f));
  }

  /**
   * Build a manifest from the current state of protected files.
   */
  snapshot() {
    const manifest = {};
    for (const p of this.protectedPaths()) {
      if (fs.existsSync(p)) {
        try {
          const buf = fs.readFileSync(p);
          manifest[path.relative(this.dataDir, p)] = {
            size: buf.length,
            hash: crypto.createHash('sha256').update(buf).digest('hex')
          };
        } catch {
          manifest[path.relative(this.dataDir, p)] = { error: 'read-failed' };
        }
      } else {
        manifest[path.relative(this.dataDir, p)] = { exists: false };
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      files: manifest
    };
  }

  /**
   * Persist the current snapshot as the last-known-good manifest.
   */
  record(store) {
    store.set(this.manifestKey, this.snapshot());
  }

  /**
   * Load the stored manifest.
   */
  load(store) {
    return store.get(this.manifestKey);
  }

  /**
   * Verify the filesystem against the stored manifest.
   * Returns { ok: boolean, mismatches: [...] } .
   */
  verify(store) {
    const manifest = this.load(store);
    if (!manifest || !manifest.files) {
      // First run: record and pass.
      return { ok: true, mismatches: [], recorded: true };
    }

    const current = this.snapshot();
    const mismatches = [];

    for (const [rel, cur] of Object.entries(current.files)) {
      const prev = manifest.files[rel];
      if (!prev) {
        if (cur.exists === false) continue; // absent both sides
        mismatches.push({ file: rel, reason: 'new-file', current: cur });
        continue;
      }
      if (cur.error || prev.error || cur.size !== prev.size) {
        mismatches.push({ file: rel, reason: 'size-or-read-error', current: cur, previous: prev });
        continue;
      }
      if (cur.hash !== prev.hash) {
        mismatches.push({ file: rel, reason: 'hash-mismatch', current: cur, previous: prev });
      }
    }

    return { ok: mismatches.length === 0, mismatches, recorded: false };
  }

  /**
   * Record a violation and report whether the threshold is crossed.
   */
  report(violation) {
    const entry = { at: Date.now(), ...violation };
    this.violations.push(entry);
    this.violations = this.violations.filter(v => Date.now() - v.at < this.windowMs);

    const confirmed = this.violations.length >= this.nukeThreshold;
    return { entry, confirmed, count: this.violations.length };
  }

  /**
   * Clear tracked violations (e.g. after human review / re-verification).
   */
  reset() {
    this.violations = [];
  }

  status() {
    return {
      violations: this.violations.slice(),
      confirmed: this.violations.length >= this.nukeThreshold,
      threshold: this.nukeThreshold
    };
  }
}

module.exports = IntegrityMonitor;
