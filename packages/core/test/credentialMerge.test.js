const { normalizeDomain } = require('../domainUtils');
const { mergeCredentials } = require('../conflictResolver');

describe('Credential Merge & Inbound Queue Ingestion Logic', () => {

  test('315-credential vault increments to 316 when receiving fresh Android autofill save', () => {
    // Generate 315 existing mock credentials
    const existing = [];
    for (let i = 1; i <= 315; i++) {
      existing.push({
        service: `service-${i}.com`,
        credential: `secret-pass-${i}`,
        username: `user_${i}@example.com`,
        logicalCounter: 1
      });
    }
    expect(existing.length).toBe(315);

    // Incoming new login from Android Autofill
    const incoming = [
      {
        service: 'https://newservice.org/login',
        password: 'SuperSecretNewPassword2026!',
        username: 'youssef@nexvault.dev'
      }
    ];

    const result = mergeCredentials(existing, incoming);
    expect(result.changed).toBe(true);
    expect(result.passwords.length).toBe(316);

    const newlyAdded = result.passwords.find(p => p.username === 'youssef@nexvault.dev');
    expect(newlyAdded).toBeDefined();
    expect(newlyAdded.credential).toBe('SuperSecretNewPassword2026!');
    expect(newlyAdded.logicalCounter).toBe(1);
  });

  test('distinct usernames for the same service do not clobber each other', () => {
    const existing = [
      {
        service: 'github.com',
        credential: 'personal-password',
        username: 'alice@corp.com',
        logicalCounter: 1
      }
    ];

    const incoming = [
      {
        service: 'https://github.com',
        password: 'work-password',
        username: 'bob@corp.com'
      }
    ];

    const result = mergeCredentials(existing, incoming);
    expect(result.changed).toBe(true);
    expect(result.passwords.length).toBe(2);

    const alice = result.passwords.find(p => p.username === 'alice@corp.com');
    const bob = result.passwords.find(p => p.username === 'bob@corp.com');
    expect(alice.credential).toBe('personal-password');
    expect(bob.credential).toBe('work-password');
  });

  test('updating existing credential bumps logical counter and updates credential', () => {
    const existing = [
      {
        service: 'gitlab.com',
        credential: 'old-password',
        username: 'engineer@corp.com',
        logicalCounter: 4
      }
    ];

    const incoming = [
      {
        service: 'gitlab.com',
        password: 'brand-new-password',
        username: 'engineer@corp.com'
      }
    ];

    const result = mergeCredentials(existing, incoming);
    expect(result.changed).toBe(true);
    expect(result.passwords.length).toBe(1);
    expect(result.passwords[0].credential).toBe('brand-new-password');
    expect(result.passwords[0].logicalCounter).toBe(5);
  });

  test('identical incoming credentials do not produce duplicate records or changes', () => {
    const existing = [
      {
        service: 'proton.me',
        credential: 'unchanged-pass',
        username: 'user@proton.me',
        logicalCounter: 1
      }
    ];

    const incoming = [
      {
        service: 'https://proton.me/login',
        password: 'unchanged-pass',
        username: 'user@proton.me'
      }
    ];

    const result = mergeCredentials(existing, incoming);
    expect(result.changed).toBe(false);
    expect(result.passwords.length).toBe(1);
  });
});
