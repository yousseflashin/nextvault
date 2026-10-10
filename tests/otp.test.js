const { generateTotp } = require('@nexvault/core/otp');

describe('OTP authenticator', () => {
  test('generates the RFC 6238-compatible TOTP vector', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082');
  });
});
