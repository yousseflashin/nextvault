/**
 * NexVault Threat Defense: Domain Shield & Phishing Heuristic Engine
 * Protects users against phishing, typosquatting, deceptive brand prefixes,
 * and malicious domains during credential input and autofill.
 */

const HIGH_VALUE_BRANDS = [
  'google', 'microsoft', 'apple', 'github', 'paypal', 'amazon',
  'netflix', 'spotify', 'discord', 'telegram', 'facebook', 'instagram',
  'binance', 'coinbase', 'kraken', 'chase', 'bankofamerica', 'wellsfargo'
];

const SUSPICIOUS_KEYWORDS = [
  'login', 'verify', 'account', 'secure', 'auth', 'update', 'billing',
  'support', 'security', 'wallet', 'claim', 'recovery', 'airdrop'
];

const SUSPICIOUS_TLDS = new Set([
  'xyz', 'top', 'work', 'click', 'loan', 'gq', 'cf', 'ml', 'ga', 'buzz',
  'fit', 'tk', 'cc', 'rest', 'monster', 'country', 'surf'
]);

class DomainShield {
  /**
   * Analyzes a target URL or domain for phishing, typosquatting, and deceptive patterns.
   * @param {string} urlOrDomain 
   * @returns {{ safe: boolean, score: number, threats: string[], details: object }}
   */
  static evaluate(urlOrDomain) {
    if (!urlOrDomain) return { safe: true, score: 0, threats: [], details: {} };

    const threats = [];
    let score = 0; // 0 = completely safe, 100 = critical threat

    const domain = this.normalize(urlOrDomain);
    const parts = domain.split('.');
    const tld = parts.length > 1 ? parts[parts.length - 1] : '';

    // 1. Punycode / Homograph Attack Detection
    if (domain.includes('xn--')) {
      threats.push('HOMOGRAPH_PUNYCODE_ATTACK');
      score += 50;
    }

    // 2. High-Risk / Abused TLD Detection
    if (SUSPICIOUS_TLDS.has(tld)) {
      threats.push(`SUSPICIOUS_TLD_${tld.toUpperCase()}`);
      score += 25;
    }

    // 3. Deceptive Subdomain Brand Masquerading (e.g. "paypal.com.phishingsite.xyz")
    if (parts.length >= 3) {
      const rootDomain = parts.slice(-2).join('.');
      for (const brand of HIGH_VALUE_BRANDS) {
        if (!rootDomain.includes(brand)) {
          // Check if brand appears in leading subdomains
          const subdomains = parts.slice(0, -2).join('.');
          if (subdomains.includes(brand)) {
            threats.push(`DECEPTIVE_SUBDOMAIN_BRAND_MASQUERADE:${brand}`);
            score += 65;
            break;
          }
        }
      }
    }

    // 4. Typosquatting / Levenshtein Distance Check on High-Value Brands
    const domainStem = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    for (const brand of HIGH_VALUE_BRANDS) {
      if (domainStem === brand) continue; // Exact brand domain is legitimate
      
      const distance = this.levenshtein(domainStem, brand);
      if (distance === 1 && brand.length >= 5) {
        threats.push(`TYPOSQUATTING_TARGET:${brand}`);
        score += 60;
        break;
      }
      
      // Look for brand with suspicious suffix (e.g. "github-login", "paypal-security")
      if (domainStem.startsWith(brand + '-') || domainStem.endsWith('-' + brand)) {
        for (const kw of SUSPICIOUS_KEYWORDS) {
          if (domainStem.includes(kw)) {
            threats.push(`PHISHING_COMPOUND_NAME:${brand}-${kw}`);
            score += 70;
            break;
          }
        }
      }
    }

    // 5. Excessive Subdomain / Multi-Level Obfuscation
    if (parts.length >= 5) {
      threats.push('EXCESSIVE_SUBDOMAIN_NESTING');
      score += 20;
    }

    // 6. Suspicious Keyword Stuffing in Host
    let keywordHits = 0;
    for (const kw of SUSPICIOUS_KEYWORDS) {
      if (domain.includes(kw)) keywordHits++;
    }
    if (keywordHits >= 2) {
      threats.push('MULTIPLE_SECURITY_KEYWORDS_STUFFED');
      score += 30;
    }

    const finalScore = Math.min(100, score);
    const safe = finalScore < 50;

    return {
      safe,
      score: finalScore,
      threats,
      details: {
        domain,
        tld,
        isHomograph: domain.includes('xn--'),
        evaluatedAt: new Date().toISOString()
      }
    };
  }

  static normalize(value) {
    if (!value) return '';
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .replace(/[:\/].*$/, '');
  }

  static levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
}

module.exports = { DomainShield };
