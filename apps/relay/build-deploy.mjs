import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(relayDir, '..', '..');
const outputDir = join(relayDir, 'dist');
const vendoredCoreDir = join(outputDir, 'node_modules', '@nexvault', 'core');

await rm(outputDir, { recursive: true, force: true });
await mkdir(vendoredCoreDir, { recursive: true });
await cp(join(relayDir, 'server.js'), join(outputDir, 'server.js'));
await cp(join(rootDir, 'packages', 'core', 'crypto.js'), join(vendoredCoreDir, 'crypto.js'));

await writeFile(
  join(vendoredCoreDir, 'package.json'),
  JSON.stringify({
    name: '@nexvault/core',
    version: '0.1.0-relay',
    main: 'crypto.js'
  }, null, 2) + '\n'
);

await writeFile(
  join(outputDir, 'package.json'),
  JSON.stringify({
    name: '@nexvault/relay-deployment',
    version: '0.1.0',
    private: true,
    main: 'server.js',
    scripts: {
      start: 'node server.js'
    },
    dependencies: {
      express: '^5.3.0',
      ws: '^8.22.0',
      tweetnacl: '1.0.3',
      'tweetnacl-util': '0.15.1'
    }
  }, null, 2) + '\n'
);

console.log('Relay deployment artifact written to apps/relay/dist');
console.log('Install it with: cd apps/relay/dist && npm install --omit=dev');
