const { parseBulkImport, parseOtpAuthUri } = require('../importParser');

describe('Universal Bulk Import & OTP Parser', () => {
  test('parses standard otpauth:// URI', () => {
    const uri = 'otpauth://totp/GitHub:youssef?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=GitHub';
    const result = parseOtpAuthUri(uri);
    expect(result).not.toBeNull();
    expect(result.service).toBe('GitHub');
    expect(result.account).toBe('youssef');
    expect(result.secret).toBe('HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ');
    expect(result.digits).toBe(6);
    expect(result.period).toBe(30);
  });

  test('parses Chrome CSV passwords export', () => {
    const csv = `name,url,username,password
GitHub,https://github.com/login,alice@gmail.com,p@ss123
Google,https://accounts.google.com,alice@gmail.com,googPass99`;

    const res = parseBulkImport(csv);
    expect(res.passwords.length).toBe(2);
    expect(res.passwords[0].service).toBe('GitHub');
    expect(res.passwords[0].username).toBe('alice@gmail.com');
    expect(res.passwords[0].credential).toBe('p@ss123');
    expect(res.passwords[1].service).toBe('Google');
    expect(res.passwords[1].credential).toBe('googPass99');
    expect(res.otps.length).toBe(0);
  });

  test('parses Bitwarden CSV export with passwords and 2FA OTP', () => {
    const csv = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,0,login,Discord,,0,,https://discord.com,alice,discPass,otpauth://totp/Discord:alice?secret=JBSWY3DPEHPK3PXP
,0,login,Slack,,0,,https://slack.com,alice,slackPass,JBSWY3DPEHPK3PXP`;

    const res = parseBulkImport(csv);
    expect(res.passwords.length).toBe(2);
    expect(res.passwords[0].service).toBe('Discord');
    expect(res.passwords[0].credential).toBe('discPass');
    expect(res.otps.length).toBe(2);
    expect(res.otps[0].service).toBe('Discord');
    expect(res.otps[0].secret).toBe('JBSWY3DPEHPK3PXP');
    expect(res.otps[1].service).toBe('Slack');
    expect(res.otps[1].secret).toBe('JBSWY3DPEHPK3PXP');
  });

  test('parses JSON format array', () => {
    const json = JSON.stringify([
      { service: 'Amazon', username: 'bob', credential: 'awsPassword!' },
      { service: 'AWS 2FA', secret: 'KVKFKRCPNZQUYMLX' }
    ]);

    const res = parseBulkImport(json);
    expect(res.passwords.length).toBe(1);
    expect(res.passwords[0].service).toBe('Amazon');
    expect(res.passwords[0].credential).toBe('awsPassword!');
    expect(res.otps.length).toBe(1);
    expect(res.otps[0].service).toBe('AWS 2FA');
    expect(res.otps[0].secret).toBe('KVKFKRCPNZQUYMLX');
  });

  test('parses list of otpauth:// URIs', () => {
    const lines = `otpauth://totp/Google:user@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google
otpauth://totp/GitHub?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ`;

    const res = parseBulkImport(lines);
    expect(res.passwords.length).toBe(0);
    expect(res.otps.length).toBe(2);
    expect(res.otps[0].service).toBe('Google');
    expect(res.otps[0].secret).toBe('JBSWY3DPEHPK3PXP');
    expect(res.otps[1].service).toBe('GitHub');
    expect(res.otps[1].secret).toBe('HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ');
  });
});

