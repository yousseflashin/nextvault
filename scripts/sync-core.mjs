// Synchronizes packages/core into apps/desktop and apps/relay node_modules
// so local-file monorepo dependencies are always fresh and identical.
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'core');

const TARGETS = [
  join(ROOT, 'apps', 'desktop', 'node_modules', '@nexvault', 'core'),
  join(ROOT, 'apps', 'relay', 'node_modules', '@nexvault', 'core')
];

for (const target of TARGETS) {
  try {
    await mkdir(target, { recursive: true });
    // Copy all files from packages/core except node_modules
    await cp(SRC, target, {
      recursive: true,
      filter: (srcPath) => {
        // Exclude node_modules and .git
        if (srcPath.includes('node_modules') || srcPath.includes('.git')) {
          return false;
        }
        return true;
      }
    });
    console.log('synced core ->', target.replace(ROOT + '/', ''));
  } catch (err) {
    console.error(`Failed to sync core to ${target}:`, err.message);
  }
}

