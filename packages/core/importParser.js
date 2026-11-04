/**
 * importParser.js - Universal bulk import parser for passwords and 2FA OTPs.
 * Supports:
 * - Google Chrome / Edge / Brave CSV exports
 * - Bitwarden CSV and JSON exports
 * - 1Password CSV exports
 * - Generic CSV (auto-detects service, username, password, totp columns)
 * - Raw JSON arrays of credentials
 * - otpauth:// URI lists and 2FA QR code payloads
 */

function parseOtpAuthUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const clean = uri.trim();
  if (!clean.startsWith('otpauth://')) return null;

  try {
    const url = new URL(clean);
    const type = url.host.toUpperCase(); // TOTP or HOTP
    let label = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let service = label;
    let account = '';

    if (label.includes(':')) {
      const parts = label.split(':');
      service = parts[0].trim();
      account = parts.slice(1).join(':').trim();
    }

    const secret = url.searchParams.get('secret');
    const issuer = url.searchParams.get('issuer');
    if (issuer) service = issuer.trim();

    if (!secret) return null;

    return {
      type: type || 'TOTP',
      service: service || '2FA Service',
      account,
      secret: secret.replace(/\s+/g, '').toUpperCase(),
      algorithm: url.searchParams.get('algorithm') || 'SHA1',
      digits: parseInt(url.searchParams.get('digits') || '6', 10),
      period: parseInt(url.searchParams.get('period') || '30', 10)
    };
  } catch {
    return null;
  }
}

function parseCsvRows(text) {
  const lines = [];
  let row = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push('');
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      if (row.length > 1 || row[0] !== '') {
        lines.push(row);
      }
      row = [''];
    } else {
      row[row.length - 1] += ch;
    }
  }

  if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    lines.push(row);
  }

  return lines;
}

function cleanServiceUrl(service) {
  if (!service) return 'Service';
  let s = String(service).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      return u.hostname.replace(/^www\./, '') || s;
    } catch {
      return s;
    }
  }
  return s;
}

function parseBulkImport(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    return { passwords: [], otps: [], totalCount: 0 };
  }

  const trimmed = rawContent.trim();
  const passwords = [];
  const otps = [];

  // 1. JSON Format Check
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const items = Array.isArray(data)
        ? data
        : (data.items || data.passwords || data.credentials || data.logins || []);

      for (const item of items) {
        // Bitwarden item structure
        if (item.login) {
          const serviceName = item.name || (item.login.uris && item.login.uris[0]?.uri) || 'Service';
          const service = cleanServiceUrl(serviceName);
          if (item.login.password) {
            passwords.push({
              service,
              username: item.login.username || '',
              credential: item.login.password
            });
          }
          if (item.login.totp) {
            const parsedUri = parseOtpAuthUri(item.login.totp);
            const secret = parsedUri ? parsedUri.secret : item.login.totp.replace(/\s+/g, '').toUpperCase();
            otps.push({ service, secret });
          }
          continue;
        }

        // Generic JSON object
        const serviceRaw = item.service || item.name || item.title || item.url || item.website || '';
        const service = cleanServiceUrl(serviceRaw);
        const username = item.username || item.user || item.login || item.email || '';
        const credential = item.credential || item.password || item.pass || '';
        const otpRaw = item.secret || item.totp || item.otp || item.otpSecret || '';

        if (service && credential) {
          passwords.push({ service, username, credential });
        }
        if (service && otpRaw) {
          const parsed = parseOtpAuthUri(otpRaw);
          const secret = parsed ? parsed.secret : otpRaw.replace(/\s+/g, '').toUpperCase();
          otps.push({ service, secret });
        }
      }

      if (passwords.length > 0 || otps.length > 0) {
        return { passwords, otps, totalCount: passwords.length + otps.length };
      }
    } catch {
      // Continue to next parsers
    }
  }

  // 2. Lines of otpauth:// URIs Check
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  const uriMatches = lines.filter(l => l.startsWith('otpauth://'));
  if (uriMatches.length > 0 && uriMatches.length >= lines.length / 2) {
    for (const uri of uriMatches) {
      const parsed = parseOtpAuthUri(uri);
      if (parsed) {
        otps.push({ service: parsed.service, secret: parsed.secret });
      }
    }
    return { passwords, otps, totalCount: otps.length };
  }

  // 3. CSV Format Check
  const rows = parseCsvRows(trimmed);
  if (rows.length >= 2) {
    const headers = rows[0].map(h => h.trim().toLowerCase());

    const serviceIdx = headers.findIndex(h =>
      ['service', 'name', 'title', 'url', 'website', 'login_uri'].includes(h)
    );
    const userIdx = headers.findIndex(h =>
      ['username', 'user', 'login', 'email', 'login_username'].includes(h)
    );
    const passIdx = headers.findIndex(h =>
      ['password', 'pass', 'credential', 'login_password'].includes(h)
    );
    const totpIdx = headers.findIndex(h =>
      ['totp', 'otp', '2fa', 'secret', 'login_totp'].includes(h)
    );

    if (passIdx >= 0 || totpIdx >= 0 || (serviceIdx >= 0 && userIdx >= 0)) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(cell => !cell.trim())) continue;

        let service = (serviceIdx >= 0 && r[serviceIdx]) ? r[serviceIdx].trim() : `Entry ${i}`;
        service = cleanServiceUrl(service);

        const username = (userIdx >= 0 && r[userIdx]) ? r[userIdx].trim() : '';
        const credential = (passIdx >= 0 && r[passIdx]) ? r[passIdx].trim() : '';
        const totpRaw = (totpIdx >= 0 && r[totpIdx]) ? r[totpIdx].trim() : '';

        if (credential) {
          passwords.push({ service, username, credential });
        }

        if (totpRaw) {
          const parsed = parseOtpAuthUri(totpRaw);
          const secret = parsed ? parsed.secret : totpRaw.replace(/\s+/g, '').toUpperCase();
          otps.push({ service, secret });
        }
      }

      return { passwords, otps, totalCount: passwords.length + otps.length };
    }
  }

  return { passwords, otps, totalCount: passwords.length + otps.length };
}

module.exports = {
  parseOtpAuthUri,
  parseCsvRows,
  parseBulkImport
};

