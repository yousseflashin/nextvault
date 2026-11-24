#!/usr/bin/env node
/**
 * scripts/generate-release-manifest.mjs
 *
 * Builds the release manifest (release-info.json) and SHA256SUMS.txt from the
 * actual release binaries, so sizes and checksums are always measured from the
 * files that get uploaded — never hardcoded.
 *
 * Usage:
 *   node scripts/generate-release-manifest.mjs --dir <artifacts-dir> [--version 0.1.31] [--sync-website]
 *
 * Outputs (written into the target directory):
 *   - release-info.json   (schema v2, consumed by website and in-app updaters)
 *   - SHA256SUMS.txt      (compatible with `sha256sum -c`)
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GITHUB_REPO,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  PLATFORM_REQUIREMENTS,
  ROOT,
  androidVersionCode,
  formatBytes,
  parseVersion,
  readRootVersion,
  releaseDownloadUrl,
  sha256File,
  validateManifest
} from './lib/release-common.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const dir = resolve(arg('dir') || join(ROOT, 'release'));
const version = (arg('version') || readRootVersion()).replace(/^v/, '');
parseVersion(version);
const tag = `v${version}`;

if (!existsSync(dir)) {
  throw new Error(`Artifact directory does not exist: ${dir}`);
}

const files = readdirSync(dir);

function findArtifact(ext, versionHint) {
  const matches = files.filter((f) => f.toLowerCase().endsWith(ext));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const versionMatch = matches.find((f) => f.includes(versionHint));
  return versionMatch || matches.sort()[matches.length - 1];
}

async function describe(filename) {
  const full = join(dir, filename);
  const size = statSync(full).size;
  return {
    filename,
    url: releaseDownloadUrl(tag, filename),
    size,
    sizeFormatted: formatBytes(size),
    sha256: await sha256File(full)
  };
}

let existingManifest = null;
const manifestPath = join(dir, MANIFEST_FILENAME);
const websiteManifestPath = join(ROOT, 'apps', 'website', 'public', MANIFEST_FILENAME);

for (const p of [manifestPath, websiteManifestPath]) {
  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (data && data.schemaVersion === MANIFEST_SCHEMA_VERSION) {
        existingManifest = data;
        break;
      }
    } catch {}
  }
}

const desktopFile = findArtifact('.appimage', version);
const mobileFile = findArtifact('.apk', version);

if (!desktopFile && !mobileFile && !existingManifest) {
  throw new Error(`Expected at least one *.AppImage or *.apk binary in ${dir}, found none`);
}

let desktopData = null;
if (desktopFile) {
  desktopData = {
    platform: 'linux-x86_64',
    arch: 'x86_64',
    format: 'AppImage',
    ...(await describe(desktopFile)),
    requirements: PLATFORM_REQUIREMENTS.desktop
  };
} else if (existingManifest?.desktop) {
  desktopData = {
    ...existingManifest.desktop,
    url: releaseDownloadUrl(tag, existingManifest.desktop.filename)
  };
}

let mobileData = null;
if (mobileFile) {
  mobileData = {
    platform: 'android',
    arch: 'universal',
    format: 'APK',
    ...(await describe(mobileFile)),
    versionCode: androidVersionCode(version),
    requirements: PLATFORM_REQUIREMENTS.mobile
  };
} else if (existingManifest?.mobile) {
  mobileData = {
    ...existingManifest.mobile,
    versionCode: androidVersionCode(version),
    url: releaseDownloadUrl(tag, existingManifest.mobile.filename)
  };
}

if (!desktopData || !mobileData) {
  throw new Error(`Could not resolve complete release data: desktop=${Boolean(desktopData)}, mobile=${Boolean(mobileData)}`);
}

const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  version,
  tag,
  publishedAt: new Date().toISOString(),
  releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
  desktop: desktopData,
  mobile: mobileData
};

const problems = validateManifest(manifest);
if (problems.length) {
  throw new Error(`Generated manifest is invalid:\n  - ${problems.join('\n  - ')}`);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const checksumEntries = [];
if (desktopFile) checksumEntries.push(`${manifest.desktop.sha256}  ${manifest.desktop.filename}`);
else if (manifest.desktop.sha256) checksumEntries.push(`${manifest.desktop.sha256}  ${manifest.desktop.filename}`);

if (mobileFile) checksumEntries.push(`${manifest.mobile.sha256}  ${manifest.mobile.filename}`);
else if (manifest.mobile.sha256) checksumEntries.push(`${manifest.mobile.sha256}  ${manifest.mobile.filename}`);

writeFileSync(join(dir, 'SHA256SUMS.txt'), checksumEntries.join('\n') + '\n');

console.log(`[manifest] Release manifest generated for ${tag}:`);
console.log(`  desktop  ${manifest.desktop.filename}  ${manifest.desktop.sizeFormatted} (${manifest.desktop.size} B)  sha256:${manifest.desktop.sha256}`);
console.log(`  mobile   ${manifest.mobile.filename}  ${manifest.mobile.sizeFormatted} (${manifest.mobile.size} B)  sha256:${manifest.mobile.sha256}`);
console.log(`[manifest] Wrote ${manifestPath} and SHA256SUMS.txt`);

if (hasFlag('sync-website')) {
  copyFileSync(manifestPath, websiteManifestPath);
  console.log(`[manifest] Synced manifest -> ${websiteManifestPath}`);
}
