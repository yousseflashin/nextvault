// Consolidates desktop (AppImage) and mobile (APK) build artifacts into
// the release/ directory for uploading to GitHub Releases.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TARGET = join(ROOT, 'release');

const SOURCES = [
  { glob: /^NexVault-.*\.AppImage$/, dir: join(ROOT, 'apps', 'desktop', 'dist'), kind: 'desktop' },
  { glob: /^app-debug\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug'), kind: 'mobile' },
  { glob: /^app-release\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release'), kind: 'mobile' },
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });

const published = [];

for (const src of SOURCES) {
  if (!(await exists(src.dir))) continue;
  const files = (await readdir(src.dir)).filter(f => src.glob.test(f));
  for (const file of files) {
    const from = join(src.dir, file);
    const name = src.kind === 'desktop' ? file : `NexVault-${src.kind}-${file}`;
    await cp(from, join(TARGET, name));
    const { size } = await stat(from);
    published.push({ name, size });
    console.log(`prepared for release: ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

console.log('\n--- GitHub Releases ---');
if (published.length) {
  console.log(`✓ ${published.length} artifact(s) prepared in ./release/`);
  console.log('Upload these files to your GitHub Release:');
  published.forEach(p => console.log(`  - release/${p.name}`));
  console.log('\nCreate release on GitHub:');
  console.log('  https://github.com/yousseflashin/nextvault/releases/new?tag=v0.1.0\n');
} else {
  console.log('No build artifacts found. Run npm run build:desktop and npm run build:mobile:android first.\n');
}
