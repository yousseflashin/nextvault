// Rebuild the self-contained deploy-bundle/ from apps/relay.
// Inlines the @nexvault/core crypto so the bundle has no workspace deps
// and can run on MonsterASP.NET iisnode as-is.
//
// Usage: node scripts/build-relay-bundle.mjs
//
import { rm, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'apps', 'relay');
const BUNDLE = join(ROOT, 'deploy-bundle');

await rm(BUNDLE, { recursive: true, force: true });
await mkdir(BUNDLE, { recursive: true });

// Inlined NexVaultToken crypto (no workspace deps needed)
const inlinedCrypto = `
class NexVaultToken {
  verify(tokenId, signature, publicKeyBase64) {
    try {
      const nacl = require('tweetnacl');
      const naclUtil = require('tweetnacl-util');
      const publicKey = naclUtil.decodeBase64(publicKeyBase64);
      const sig = naclUtil.decodeBase64(signature);
      const message = naclUtil.decodeUTF8(tokenId);
      return nacl.sign.detached.verify(message, sig, publicKey);
    } catch { return false; }
  }
}`;

let index = await readFile(join(SRC, 'index.js'), 'utf8');
index = index.replace(
  "const { NexVaultToken } = require('@nexvault/core/crypto');",
  inlinedCrypto.trim()
);
await writeFile(join(BUNDLE, 'index.js'), index);

// web.config uses nodeProcessCommandLine="node.exe" (host-agnostic)
await copyFile(join(SRC, 'web.config'), join(BUNDLE, 'web.config'));

const pkg = {
  name: 'nexvault-relay-deploy',
  version: '0.1.0',
  private: true,
  main: 'index.js',
  scripts: { start: 'node index.js' },
  dependencies: { tweetnacl: '1.0.3', 'tweetnacl-util': '0.15.1', ws: '^8.18.0' },
};
await writeFile(join(BUNDLE, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Install production deps into the bundle so node_modules/ can be uploaded
// (MonsterASP has no shell access; npm install must happen locally)
import { execFileSync } from 'node:child_process';
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: BUNDLE,
  stdio: 'inherit',
});

console.log('deploy-bundle rebuilt (self-contained, node_modules included)');
console.log('next: upload deploy-bundle/* to wwwroot on relay.runasp.net');
console.log('next: enable HTTPS in MonsterASP control panel (WebSockets require it)');
console.log('next: curl -I https://relay.runasp.net/  # expect HTTP 200');