// Consolidates desktop (AppImage) and mobile (APK) build artifacts into
// the release/ directory for uploading to GitHub Releases.
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TARGET = join(ROOT, 'release');

const rootPkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const currentVersion = rootPkg.version || '0.1.4';

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });

const published = [];

// 1. Copy Desktop AppImage - strictly matching current release version
const desktopDist = join(ROOT, 'apps', 'desktop', 'dist');
if (await exists(desktopDist)) {
  const allDesktopFiles = await readdir(desktopDist);
  // Look for exact version match first, e.g. NexVault-0.1.4.AppImage
  let desktopFile = allDesktopFiles.find(f => f === `NexVault-${currentVersion}.AppImage`);
  if (!desktopFile) {
    // Fallback to latest AppImage if exact version not named
    const appImages = allDesktopFiles.filter(f => f.endsWith('.AppImage'));
    if (appImages.length > 0) {
      desktopFile = appImages[appImages.length - 1];
    }
  }

  if (desktopFile) {
    const from = join(desktopDist, desktopFile);
    const to = join(TARGET, desktopFile);
    await cp(from, to);
    const { size } = await stat(from);
    published.push({ name: desktopFile, size });
    console.log(`prepared for release: ${desktopFile} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

// 2. Copy Mobile APK
const apkSources = [
  { glob: /^app-debug\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug') },
  { glob: /^app-release\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release') },
];

for (const src of apkSources) {
  if (!(await exists(src.dir))) continue;
  const files = (await readdir(src.dir)).filter(f => src.glob.test(f));
  for (const file of files) {
    const from = join(src.dir, file);
    const name = `NexVault-mobile-${file}`;
    await cp(from, join(TARGET, name));
    const { size } = await stat(from);
    published.push({ name, size });
    console.log(`prepared for release: ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    break; // only need one primary APK
  }
}

console.log('\n--- GitHub Releases ---');
if (published.length) {
  console.log(`✓ ${published.length} artifact(s) prepared in ./release/`);
  console.log('Upload these files to your GitHub Release:');
  published.forEach(p => console.log(`  - release/${p.name}`));
  console.log('\nCreate release on GitHub:');
  console.log(`  https://github.com/yousseflashin/nextvault/releases/new?tag=v${currentVersion}\n`);
} else {
  console.log('No build artifacts found. Run npm run build:desktop and npm run build:mobile:android first.\n');
}
