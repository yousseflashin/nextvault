#!/usr/bin/env node
/**
 * scripts/release.mjs
 *
 * Cuts a NexVault release. This script ONLY versions and tags; GitHub Actions
 * (.github/workflows/release.yml) builds, signs, checksums and publishes.
 *
 *   1. Bumps the version in every package/manifest (root package.json is the source of truth).
 *   2. Commits "chore(release): vX.Y.Z" and creates an annotated tag vX.Y.Z.
 *   3. Pushes the branch and the tag → CI release pipeline starts.
 *
 * Usage:
 *   npm run release                  # patch bump
 *   npm run release -- minor         # minor bump
 *   npm run release -- 1.2.3         # explicit version
 *   npm run release -- patch --dry-run
 *   npm run release -- patch --no-push
 *
 * CI usage (verifies a tag matches every versioned file):
 *   node scripts/release.mjs --verify v1.2.3
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, bumpVersion, compareVersions, parseVersion, readRootVersion } from './lib/release-common.mjs';

/** Every JSON file carrying the product version. */
const JSON_VERSION_FILES = [
  'package.json',
  'packages/core/package.json',
  'apps/desktop/package.json',
  'apps/mobile/package.json',
  'apps/relay/package.json',
  'apps/website/package.json',
  'apps/extension/src/manifest.json',
  'apps/extension/src/manifest.chrome.json',
  'apps/extension/src/manifest.firefox.json'
];

/** Lockfiles whose root entry mirrors the package version. */
const LOCKFILES = [
  'package-lock.json',
  'packages/core/package-lock.json',
  'apps/desktop/package-lock.json',
  'apps/mobile/package-lock.json',
  'apps/relay/package-lock.json',
  'apps/website/package-lock.json'
];

/** Static text that shows the version before the runtime value loads. */
const TEXT_REPLACEMENTS = [
  {
    file: 'apps/desktop/src/index.html',
    apply: (s, v) => s
      .replace(/title="NexVault Desktop v[^"]+"/g, `title="NexVault Desktop v${v}"`)
      .replace(/(<span class="nv-badge"[^>]*>)v\d+\.\d+\.\d+(<\/span>)/g, `$1v${v}$2`)
      .replace(/NexVault is up to date \(v[^)]+\)/g, `NexVault is up to date (v${v})`)
  }
];

const log = (msg) => console.log(`[release] ${msg}`);
const fail = (msg) => { console.error(`[release] ✖ ${msg}`); process.exit(1); };

function git(args, { allowFailure = false, capture = false } = {}) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (res.status !== 0 && !allowFailure) fail(`git ${args.join(' ')} failed${res.stderr ? `: ${res.stderr.trim()}` : ''}`);
  return res;
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function writeJson(rel, data) {
  writeFileSync(join(ROOT, rel), JSON.stringify(data, null, 2) + '\n');
}

// ---------------------------------------------------------------- verify mode
function verify(tag) {
  const expected = String(tag || '').replace(/^refs\/tags\//, '').replace(/^v/, '');
  parseVersion(expected);
  const mismatches = [];
  for (const rel of JSON_VERSION_FILES) {
    if (!existsSync(join(ROOT, rel))) continue;
    const actual = readJson(rel).version;
    if (actual !== expected) mismatches.push(`${rel}: ${actual}`);
  }
  if (mismatches.length) {
    fail(`Tag v${expected} does not match versioned files:\n  - ${mismatches.join('\n  - ')}`);
  }
  log(`✓ All versioned files match v${expected}`);
}

// ---------------------------------------------------------------- bump mode
function bumpFiles(next) {
  for (const rel of JSON_VERSION_FILES) {
    if (!existsSync(join(ROOT, rel))) continue;
    const data = readJson(rel);
    data.version = next;
    writeJson(rel, data);
    log(`  ✓ ${rel}`);
  }
  for (const rel of LOCKFILES) {
    if (!existsSync(join(ROOT, rel))) continue;
    const lock = readJson(rel);
    lock.version = next;
    if (lock.packages?.['']) lock.packages[''].version = next;
    writeJson(rel, lock);
    log(`  ✓ ${rel}`);
  }
  for (const { file, apply } of TEXT_REPLACEMENTS) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    const before = readFileSync(abs, 'utf8');
    const after = apply(before, next);
    if (after !== before) {
      writeFileSync(abs, after);
      log(`  ✓ ${file}`);
    }
  }
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

if (flags.has('--verify')) {
  verify(positional[0] || process.env.GITHUB_REF_NAME);
  process.exit(0);
}

const current = readRootVersion();
const next = bumpVersion(current, positional[0] || 'patch');
if (compareVersions(next, current) <= 0) fail(`New version ${next} must be greater than ${current}`);
const tag = `v${next}`;
const dryRun = flags.has('--dry-run');
const push = !flags.has('--no-push');

console.log('====================================================');
console.log(`  NexVault release: v${current} → ${tag}${dryRun ? '  (dry run)' : ''}`);
console.log('====================================================');

// Guard rails
const dirty = git(['status', '--porcelain'], { capture: true }).stdout.trim();
if (dirty && !flags.has('--allow-dirty')) {
  fail(`Working tree is not clean. Commit or stash first (or pass --allow-dirty):\n${dirty}`);
}
if (git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { capture: true, allowFailure: true }).status === 0) {
  fail(`Tag ${tag} already exists. Releases are immutable — bump to a new version instead.`);
}
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).stdout.trim();
if (branch !== 'main') log(`⚠ Releasing from branch "${branch}" (not main).`);

if (dryRun) {
  log(`Would update: ${[...JSON_VERSION_FILES, ...LOCKFILES, ...TEXT_REPLACEMENTS.map((t) => t.file)].join(', ')}`);
  log(`Would commit, tag ${tag}${push ? ` and push to origin/${branch}` : ''}.`);
  process.exit(0);
}

log(`Updating versions to ${next}...`);
bumpFiles(next);

git(['add', '-A']);
// Never ship a token by accident.
const leaked = git(['diff', '--cached', '--name-only', '-G', '(ghp_|github_pat_)[A-Za-z0-9_]{20,}'], { capture: true }).stdout.trim();
if (leaked) {
  git(['reset', '-q']);
  fail(`Aborting: staged files contain what looks like a GitHub token:\n${leaked}`);
}
git(['commit', '-m', `chore(release): ${tag}`]);
git(['tag', '-a', tag, '-m', `NexVault ${tag}`]);
log(`✓ Created commit and tag ${tag}`);

if (push) {
  git(['push', 'origin', branch]);
  git(['push', 'origin', tag]);
  log(`✓ Pushed ${branch} and ${tag}. GitHub Actions is now building the release:`);
  log('  https://github.com/yousseflashin/nextvault/actions/workflows/release.yml');
} else {
  log(`Not pushed. When ready: git push origin ${branch} && git push origin ${tag}`);
}
