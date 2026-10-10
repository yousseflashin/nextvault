// Copies shared cyber design assets from packages/assets into each app's
// static dir so every platform uses one source of truth.
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'assets');

const TARGETS = [
  join(ROOT, 'apps', 'website', 'public', 'cyber'),
  join(ROOT, 'apps', 'desktop', 'src', 'cyber'),
  join(ROOT, 'apps', 'mobile', 'src', 'cyber'),
  join(ROOT, 'apps', 'extension', 'src', 'cyber'),
];

for (const t of TARGETS) {
  await mkdir(t, { recursive: true });
  await cp(join(SRC, 'cyber.css'), join(t, 'cyber.css'));
  await cp(join(SRC, 'binary-shield.js'), join(t, 'binary-shield.js'));
  console.log('synced ->', t.replace(ROOT + '/', ''));
}
