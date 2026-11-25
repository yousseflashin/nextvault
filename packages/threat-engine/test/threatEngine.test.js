const { DomainShield, SecurityEventBus, IntegrityAuditor } = require('../index');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('NextVault Threat Defense Engine', () => {
  describe('DomainShield', () => {
    it('identifies legitimate high-value domains as safe', () => {
      const res = DomainShield.evaluate('https://github.com/login');
      expect(res.safe).toBe(true);
      expect(res.score).toBeLessThan(50);
      expect(res.threats).toHaveLength(0);
    });

    it('detects deceptive subdomain brand masquerading', () => {
      const res = DomainShield.evaluate('https://paypal.com.account-update.xyz/login');
      expect(res.safe).toBe(false);
      expect(res.score).toBeGreaterThanOrEqual(50);
      expect(res.threats).toContain('DECEPTIVE_SUBDOMAIN_BRAND_MASQUERADE:paypal');
    });

    it('detects typosquatting against major targets', () => {
      const res = DomainShield.evaluate('https://githyb.com');
      expect(res.safe).toBe(false);
      expect(res.threats).toContain('TYPOSQUATTING_TARGET:github');
    });

    it('flags punycode / homograph attacks', () => {
      const res = DomainShield.evaluate('https://xn--gogle-qqa.com');
      expect(res.threats).toContain('HOMOGRAPH_PUNYCODE_ATTACK');
    });

    it('flags phishing compound brand-keyword names', () => {
      const res = DomainShield.evaluate('https://paypal-security-login.com');
      expect(res.safe).toBe(false);
      expect(res.threats.some(t => t.startsWith('PHISHING_COMPOUND_NAME:paypal'))).toBe(true);
    });
  });

  describe('SecurityEventBus', () => {
    it('dispatches security events to subscribers and maintains audit log', async () => {
      const bus = new SecurityEventBus();
      const received = [];

      const unsub = bus.on('THREAT_DETECTED', (e) => {
        received.push(e);
      });

      await bus.emit('THREAT_DETECTED', { target: 'evil.xyz', severity: 'HIGH' });
      expect(received).toHaveLength(1);
      expect(received[0].payload.target).toBe('evil.xyz');

      const log = bus.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].event).toBe('THREAT_DETECTED');

      unsub();
      await bus.emit('THREAT_DETECTED', { target: 'other.com' });
      expect(received).toHaveLength(1); // handler was unsubscribed
      expect(bus.getAuditLog()).toHaveLength(2); // audit log still tracks it
    });
  });

  describe('IntegrityAuditor', () => {
    it('verifies buffer hashes correctly', () => {
      const payload = 'NexVault-Immutable-Binary-2026';
      const crypto = require('crypto');
      const expected = crypto.createHash('sha256').update(payload).digest('hex');

      expect(IntegrityAuditor.verifyBuffer(payload, expected)).toBe(true);
      expect(IntegrityAuditor.verifyBuffer(payload, 'wronghash')).toBe(false);
    });

    it('computes and verifies file hash', async () => {
      const tmpFile = path.join(os.tmpdir(), `nv-test-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, 'SafeBinaryContent');

      try {
        const hash = await IntegrityAuditor.computeFileHash(tmpFile);
        expect(typeof hash).toBe('string');
        expect(hash).toHaveLength(64);

        const verification = await IntegrityAuditor.verifyFile(tmpFile, hash);
        expect(verification.valid).toBe(true);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });
});
