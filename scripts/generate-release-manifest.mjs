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
 * The directory must contain at least one *.AppImage and one *.apk.
 * Outputs (written into the same directory):
 *   - release-info.json   (schema v2, consumed by the website and in-app updaters)
 *   - SHA256SUMS.txt      (compatible with `sha256sum -c`)
 */
import { copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

const files = readdirSync(dir);
function pickArtifact(ext, versionHint) {
  const matches = files.filter((f) => f.toLowerCase().endsWith(ext));
  if (matches.length === 0) {
    throw new Error(`Expected a *${ext} binary in ${dir}, found none`);
  }
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

const desktopFile = pickArtifact('.appimage', version);
const mobileFile = pickArtifact('.apk', version);

const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  version,
  tag,
  publishedAt: new Date().toISOString(),
  releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
  desktop: {
    platform: 'linux-x86_64',
    arch: 'x86_64',
    format: 'AppImage',
    ...(await describe(desktopFile)),
    requirements: PLATFORM_REQUIREMENTS.desktop
  },
  mobile: {
    platform: 'android',
    arch: 'universal',
    format: 'APK',
    ...(await describe(mobileFile)),
    versionCode: androidVersionCode(version),
    requirements: PLATFORM_REQUIREMENTS.mobile
  }
};

const problems = validateManifest(manifest);
if (problems.length) {
  throw new Error(`Generated manifest is invalid:\n  - ${problems.join('\n  - ')}`);
}

const manifestPath = join(dir, MANIFEST_FILENAME);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(dir, 'SHA256SUMS.txt'),
  [manifest.desktop, manifest.mobile].map((a) => `${a.sha256}  ${a.filename}`).join('\n') + '\n'
);

console.log(`Release manifest for ${tag}:`);
console.log(`  desktop  ${manifest.desktop.filename}  ${manifest.desktop.sizeFormatted} (${manifest.desktop.size} B)  sha256:${manifest.desktop.sha256}`);
console.log(`  mobile   ${manifest.mobile.filename}  ${manifest.mobile.sizeFormatted} (${manifest.mobile.size} B)  sha256:${manifest.mobile.sha256}`);
console.log(`Wrote ${manifestPath} and SHA256SUMS.txt`);

if (hasFlag('sync-website')) {
  const websiteManifest = join(ROOT, 'apps', 'website', 'public', MANIFEST_FILENAME);
  copyFileSync(manifestPath, websiteManifest);
  console.log(`Synced manifest -> ${websiteManifest}`);
}
