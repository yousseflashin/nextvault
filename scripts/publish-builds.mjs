// Copies desktop (AppImage) and mobile (APK) build artifacts into
// apps/website/public/downloads/ and writes a manifest.json for the website.
import { cp, mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TARGET = join(ROOT, 'apps', 'website', 'public', 'downloads');
const DIST_TARGET = join(ROOT, 'apps', 'website', 'dist', 'downloads');

const SOURCES = [
  { glob: /^NexVault-.*\.AppImage$/, dir: join(ROOT, 'apps', 'desktop', 'dist'), kind: 'desktop', platform: 'linux' },
  { glob: /^app-debug\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug'), kind: 'mobile', platform: 'android' },
  { glob: /^app-release\.apk$/, dir: join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release'), kind: 'mobile', platform: 'android' },
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const manifest = [];

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });

for (const src of SOURCES) {
  if (!(await exists(src.dir))) continue;
  const files = (await readdir(src.dir)).filter(f => src.glob.test(f));
  for (const file of files) {
    const from = join(src.dir, file);
    const name = src.kind === 'desktop' ? file : `NexVault-${src.kind}-${file}`;
    await cp(from, join(TARGET, name));
    const { size } = await stat(from);
    manifest.push({ name, kind: src.kind, platform: src.platform, size, file: `downloads/${name}` });
    console.log(`published: ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(join(TARGET, 'manifest.json'), manifestJson);

if (await exists(join(ROOT, 'apps', 'website', 'dist'))) {
  await rm(DIST_TARGET, { recursive: true, force: true });
  await cp(TARGET, DIST_TARGET, { recursive: true });
}

console.log(manifest.length ? `${manifest.length} artifact(s) -> apps/website/public/downloads/` : 'No build artifacts found. Run npm run build:desktop / build:mobile:android first.');
