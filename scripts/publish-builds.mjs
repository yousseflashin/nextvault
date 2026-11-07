#!/usr/bin/env node
/**
 * scripts/publish-builds.mjs
 *
 * Consolidates local desktop (AppImage) and mobile (APK) build artifacts into
 * ./release/, computes real byte sizes and SHA-256 checksums, writes
 * release/release-info.json + release/SHA256SUMS.txt, and syncs the manifest to
 * apps/website/public/release-info.json.
 */
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, formatBytes, readRootVersion } from './lib/release-common.mjs';

const TARGET = join(ROOT, 'release');
const currentVersion = readRootVersion();

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });

const published = [];

// 1. Copy Desktop AppImage
const desktopDist = join(ROOT, 'apps', 'desktop', 'dist');
if (await exists(desktopDist)) {
  const allDesktopFiles = await readdir(desktopDist);
  let desktopFile =
    allDesktopFiles.find((f) => f === `NexVault-${currentVersion}-x86_64.AppImage`) ||
    allDesktopFiles.find((f) => f === `NexVault-${currentVersion}.AppImage`);
  if (!desktopFile) {
    const appImages = allDesktopFiles.filter((f) => f.endsWith('.AppImage')).sort();
    if (appImages.length > 0) desktopFile = appImages[appImages.length - 1];
  }

  if (desktopFile) {
    const from = join(desktopDist, desktopFile);
    const outName = `NexVault-${currentVersion}-x86_64.AppImage`;
    const to = join(TARGET, outName);
    await cp(from, to);
    const { size } = await stat(from);
    published.push({ name: outName, size });
    console.log(`prepared desktop artifact: ${outName} (${formatBytes(size)})`);
  }
}

// 2. Copy Mobile APK (prefer signed release APK over debug APK)
const apkSources = [
  {
    glob: /^app-release\.apk$/,
    outName: `NexVault-${currentVersion}.apk`,
    dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release')
  },
  {
    glob: /^app-debug\.apk$/,
    outName: `NexVault-${currentVersion}.apk`,
    dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug')
  }
];

let copiedApk = false;
for (const src of apkSources) {
  if (copiedApk || !(await exists(src.dir))) continue;
  const files = (await readdir(src.dir)).filter((f) => src.glob.test(f));
  for (const file of files) {
    const from = join(src.dir, file);
    const metadataPath = join(src.dir, 'output-metadata.json');
    if (await exists(metadataPath)) {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      const builtVersion = metadata.elements?.[0]?.versionName;
      if (builtVersion !== currentVersion) {
        throw new Error(`Refusing to publish stale mobile APK: ${builtVersion || 'unknown'} (expected ${currentVersion})`);
      }
    }
    await cp(from, join(TARGET, src.outName));
    const { size } = await stat(from);
    published.push({ name: src.outName, size });
    console.log(`prepared mobile artifact:  ${src.outName} (${formatBytes(size)})`);
    copiedApk = true;
    break;
  }
}

if (published.length === 2) {
  const res = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'generate-release-manifest.mjs'), '--dir', TARGET, '--version', currentVersion, '--sync-website'],
    { stdio: 'inherit' }
  );
  if (res.status !== 0) process.exit(res.status || 1);
} else {
  console.warn(`⚠️ Found ${published.length}/2 build artifacts in ./release/. Build both desktop and mobile to generate release-info.json.`);
}
