#!/usr/bin/env node
/**
 * scripts/publish-builds.mjs
 *
 * Consolidates local desktop (AppImage) and mobile (APK) build artifacts into
 * ./release/, computes real byte sizes and SHA-256 checksums, writes
 * release/release-info.json + release/SHA256SUMS.txt, and syncs the manifest to
 * apps/website/public/release-info.json.
 *
 * Preserves existing artifacts so building one platform does not wipe out another.
 */
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, formatBytes, readRootVersion } from './lib/release-common.mjs';

const TARGET = join(ROOT, 'release');
const currentVersion = readRootVersion();

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await mkdir(TARGET, { recursive: true });

const published = [];

// 1. Copy Desktop AppImage
const desktopDist = join(ROOT, 'apps', 'desktop', 'dist');
let desktopCopied = false;

if (await exists(desktopDist)) {
  const allDesktopFiles = await readdir(desktopDist);
  let desktopFile =
    allDesktopFiles.find((f) => f === `NexVault-${currentVersion}-x86_64.AppImage`) ||
    allDesktopFiles.find((f) => f === `NexVault-${currentVersion}.AppImage`);
  if (!desktopFile) {
    const appImages = allDesktopFiles.filter((f) => f.endsWith('.AppImage') && f.includes(currentVersion)).sort();
    if (appImages.length > 0) desktopFile = appImages[appImages.length - 1];
  }

  if (desktopFile) {
    const from = join(desktopDist, desktopFile);
    const outName = `NexVault-${currentVersion}-x86_64.AppImage`;
    const to = join(TARGET, outName);
    await cp(from, to);
    const { size } = await stat(to);
    published.push({ name: outName, size, platform: 'desktop' });
    console.log(`[publish] Prepared desktop artifact: ${outName} (${formatBytes(size)})`);
    desktopCopied = true;
  }
}

if (!desktopCopied) {
  const existingDesktop = join(TARGET, `NexVault-${currentVersion}-x86_64.AppImage`);
  if (await exists(existingDesktop)) {
    const { size } = await stat(existingDesktop);
    published.push({ name: `NexVault-${currentVersion}-x86_64.AppImage`, size, platform: 'desktop' });
    console.log(`[publish] Preserved existing desktop artifact: NexVault-${currentVersion}-x86_64.AppImage (${formatBytes(size)})`);
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
        console.warn(`[publish] Skipping APK in ${src.dir}: built for ${builtVersion || 'unknown'}, expected ${currentVersion}`);
        continue;
      }
    }
    const to = join(TARGET, src.outName);
    await cp(from, to);
    const { size } = await stat(to);
    published.push({ name: src.outName, size, platform: 'mobile' });
    console.log(`[publish] Prepared mobile artifact:  ${src.outName} (${formatBytes(size)})`);
    copiedApk = true;
    break;
  }
}

if (!copiedApk) {
  const existingApk = join(TARGET, `NexVault-${currentVersion}.apk`);
  if (await exists(existingApk)) {
    const { size } = await stat(existingApk);
    published.push({ name: `NexVault-${currentVersion}.apk`, size, platform: 'mobile' });
    console.log(`[publish] Preserved existing mobile artifact: NexVault-${currentVersion}.apk (${formatBytes(size)})`);
  }
}

if (published.length > 0) {
  const res = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'generate-release-manifest.mjs'), '--dir', TARGET, '--version', currentVersion, '--sync-website'],
    { stdio: 'inherit' }
  );
  if (res.status !== 0) process.exit(res.status || 1);
  console.log(`[publish] Successfully published ${published.length} artifact(s) to ./release/`);
} else {
  console.warn(`[publish] ⚠️ No build artifacts found in ./release/. Run npm run build:desktop and/or npm run build:mobile:android first.`);
}
