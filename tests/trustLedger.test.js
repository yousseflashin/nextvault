const TrustLedger = require('../src/core/trustLedger');

function createStore() {
  const values = {};
  return {
    get: (key, fallback) => values[key] ?? fallback,
    set: (key, value) => { values[key] = value; }
  };
}

describe('Trust ledger', () => {
  test('chains events and detects tampering', () => {
    const store = createStore();
    const ledger = new TrustLedger(store, 'device-key');
    ledger.append('application-created');
    ledger.append('application-added', { peer: 'peer-a' });
    expect(ledger.verify()).toBe(true);
    ledger.events[0].payload = { peer: 'tampered' };
    expect(ledger.verify()).toBe(false);
  });
});
