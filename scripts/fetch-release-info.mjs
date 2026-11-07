#!/usr/bin/env node
/**
 * scripts/fetch-release-info.mjs
 *
 * Runs before every website build. Ensures apps/website/public/release-info.json
 * has accurate, schema-v2 release metadata (byte sizes, formatted MB sizes,
 * SHA-256 digests, and download URLs).
 *
 * Resolution order:
 *   1. If ./release/ contains built binaries for the current root version, measure
 *      them directly when no newer remote release exists.
 *   2. Fetch https://github.com/<repo>/releases/latest/download/release-info.json
 *   3. Query GitHub REST API (/releases/latest)
 *   4. Preserve existing apps/website/public/release-info.json if valid schema v2.
 *
 * Never fails the build so offline/sandboxed or rate-limited builds always succeed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GITHUB_REPO,
  LATEST_MANIFEST_URL,
  MANIFEST_SCHEMA_VERSION,
  PLATFORM_REQUIREMENTS,
  ROOT,
  androidVersionCode,
  compareVersions,
  formatBytes,
   validateManifest
} from './lib/release-common.mjs';

const OUT = join(ROOT, 'apps', 'website', 'public', 'release-info.json');
const TIMEOUT_MS = 10000;

function readExistingLocalManifest() {
  if (!existsSync(OUT)) return null;
  try {
    const data = JSON.parse(readFileSync(OUT, 'utf8'));
    return validateManifest(data).length === 0 ? data : null;
  } catch {
    return null;
  }
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NexVault-Website-Build', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(await res.text());
}

async function fromManifestAsset() {
  const manifest = await getJson(LATEST_MANIFEST_URL);
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`latest manifest invalid: ${problems.join('; ')}`);
  if (manifest.desktop && !manifest.desktop.sizeFormatted) {
    manifest.desktop.sizeFormatted = formatBytes(manifest.desktop.size);
  }
  if (manifest.mobile && !manifest.mobile.sizeFormatted) {
    manifest.mobile.sizeFormatted = formatBytes(manifest.mobile.size);
  }
  return manifest;
}

async function fromGithubApi() {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const release = await getJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, headers);
  const version = String(release.tag_name || '').replace(/^v/, '');
  const assets = release.assets || [];
  const toAsset = (a) => a && {
    filename: a.name,
    url: a.browser_download_url,
    size: a.size,
    sizeFormatted: formatBytes(a.size),
    sha256: String(a.digest || '').replace(/^sha256:/, '')
  };
  const desktop = toAsset(assets.find((a) => /\.AppImage$/i.test(a.name)));
  const mobile = toAsset(assets.find((a) => /\.apk$/i.test(a.name)));
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    version,
    tag: `v${version}`,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    desktop: desktop && {
      platform: 'linux-x86_64',
      arch: 'x86_64',
      format: 'AppImage',
      ...desktop,
      requirements: PLATFORM_REQUIREMENTS.desktop
    },
    mobile: mobile && {
      platform: 'android',
      arch: 'universal',
      format: 'APK',
      ...mobile,
      versionCode: androidVersionCode(version),
      requirements: PLATFORM_REQUIREMENTS.mobile
    }
  };
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`GitHub API release incomplete: ${problems.join('; ')}`);
  return manifest;
}

const localManifest = readExistingLocalManifest();
let remoteManifest = null;

for (const [label, source] of [['release manifest asset', fromManifestAsset], ['GitHub API', fromGithubApi]]) {
  try {
    remoteManifest = await source();
    console.log(`[release-info] Fetched ${label}: ${remoteManifest.tag}`);
    break;
  } catch (err) {
    console.warn(`[release-info] ${label} unavailable: ${err.message}`);
  }
}

let chosen = remoteManifest;
if (localManifest && (!remoteManifest || compareVersions(localManifest.version, remoteManifest.version) >= 0)) {
  chosen = localManifest;
  console.log(`[release-info] Using local manifest (${localManifest.tag})`);
}

if (chosen) {
  writeFileSync(OUT, JSON.stringify(chosen, null, 2) + '\n');
  console.log(`[release-info] desktop: ${chosen.desktop.filename} — ${chosen.desktop.sizeFormatted} (${chosen.desktop.size} B)`);
  console.log(`[release-info] mobile:  ${chosen.mobile.filename} — ${chosen.mobile.sizeFormatted} (${chosen.mobile.size} B)`);
} else {
  console.warn('[release-info] No release manifest available at build time; the website will query GitHub at runtime.');
}
