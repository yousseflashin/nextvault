// Shared release helpers used by the release, manifest and website scripts.
// Keep this file dependency-free so it runs in CI, on Vercel and locally.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const GITHUB_REPO = 'yousseflashin/nextvault';
export const MANIFEST_FILENAME = 'release-info.json';
export const MANIFEST_SCHEMA_VERSION = 2;

/** Stable URL that always resolves to the manifest attached to the latest GitHub release. */
export const LATEST_MANIFEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/${MANIFEST_FILENAME}`;

/** Minimum OS requirements shown on the website and embedded in the manifest. */
export const PLATFORM_REQUIREMENTS = {
  desktop: 'Linux x86_64 · glibc 2.35+ (Ubuntu 22.04+, Debian 12+, Fedora 36+)',
  // apps/mobile/android/variables.gradle → minSdkVersion = 24
  mobile: 'Android 7.0+ (API 24+ · ARM64 / x86_64)'
};

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version) {
  const match = SEMVER_RE.exec(String(version || '').replace(/^v/, '').trim());
  if (!match) throw new Error(`Invalid version "${version}" (expected MAJOR.MINOR.PATCH)`);
  return match.slice(1, 4).map(Number);
}

export function isValidVersion(version) {
  try { parseVersion(version); return true; } catch { return false; }
}

export function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current);
  switch (kind) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: {
      const explicit = String(kind).replace(/^v/, '');
      parseVersion(explicit);
      return explicit;
    }
  }
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Android versionCode derived from semver. MUST stay in sync with
 * apps/mobile/android/app/build.gradle (computeVersionCode).
 * Monotonic as long as minor/patch stay < 1000, and always greater than the
 * legacy scheme (10000 + …) that shipped up to v0.1.30.
 */
export function androidVersionCode(version) {
  const [major, minor, patch] = parseVersion(version);
  return 100000 + major * 1000000 + minor * 1000 + patch;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function readRootVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  parseVersion(pkg.version);
  return pkg.version;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export function releaseDownloadUrl(tag, filename) {
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${encodeURIComponent(filename)}`;
}

/** Validates a schema-v2 manifest. Returns an array of problems (empty = valid). */
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  if (!isValidVersion(manifest.version)) problems.push('version is not valid semver');
  if (manifest.tag !== `v${manifest.version}`) problems.push('tag must equal "v" + version');
  for (const key of ['desktop', 'mobile']) {
    const a = manifest[key];
    if (!a) { problems.push(`${key} is missing`); continue; }
    if (!a.filename) problems.push(`${key}.filename is missing`);
    if (!/^https:\/\/github\.com\//.test(a.url || '')) problems.push(`${key}.url must be a github.com URL`);
    if (!Number.isInteger(a.size) || a.size <= 0) problems.push(`${key}.size must be a positive integer (bytes)`);
    if (!/^[a-f0-9]{64}$/.test(a.sha256 || '')) problems.push(`${key}.sha256 must be a hex SHA-256 digest`);
  }
  return problems;
}
