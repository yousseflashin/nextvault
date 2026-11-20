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
function bumpFiles(next, target = 'all') {
  if (target === 'mobile') {
    // 1. apps/mobile/package.json
    const mobJson = readJson('apps/mobile/package.json');
    mobJson.version = next;
    writeJson('apps/mobile/package.json', mobJson);
    log('  ✓ apps/mobile/package.json');

    // 2. apps/mobile/package-lock.json
    if (existsSync(join(ROOT, 'apps/mobile/package-lock.json'))) {
      const lock = readJson('apps/mobile/package-lock.json');
      lock.version = next;
      if (lock.packages?.['']) lock.packages[''].version = next;
      writeJson('apps/mobile/package-lock.json', lock);
      log('  ✓ apps/mobile/package-lock.json');
    }

    // 3. update release-info.json mobile block
    if (existsSync(join(ROOT, 'apps/website/public/release-info.json'))) {
      const relInfo = readJson('apps/website/public/release-info.json');
      if (relInfo.mobile) {
        relInfo.mobile.version = next;
        relInfo.mobile.versionCode = 100000 + (parseVersion(next)[0] * 1000000) + (parseVersion(next)[1] * 1000) + parseVersion(next)[2];
        relInfo.mobile.filename = `NexVault-${next}.apk`;
        relInfo.mobile.tag = `v${next}-mobile`;
        relInfo.mobile.url = `https://github.com/${GITHUB_REPO}/releases/download/${relInfo.mobile.tag}/${relInfo.mobile.filename}`;
        writeJson('apps/website/public/release-info.json', relInfo);
        log('  ✓ apps/website/public/release-info.json (mobile block)');
      }
    }
    return;
  }

  if (target === 'desktop') {
    // 1. apps/desktop/package.json
    const dtJson = readJson('apps/desktop/package.json');
    dtJson.version = next;
    writeJson('apps/desktop/package.json', dtJson);
    log('  ✓ apps/desktop/package.json');

    // 2. apps/desktop/package-lock.json
    if (existsSync(join(ROOT, 'apps/desktop/package-lock.json'))) {
      const lock = readJson('apps/desktop/package-lock.json');
      lock.version = next;
      if (lock.packages?.['']) lock.packages[''].version = next;
      writeJson('apps/desktop/package-lock.json', lock);
      log('  ✓ apps/desktop/package-lock.json');
    }

    // 3. apps/desktop/src/index.html replacements
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

    // 4. update release-info.json desktop block
    if (existsSync(join(ROOT, 'apps/website/public/release-info.json'))) {
      const relInfo = readJson('apps/website/public/release-info.json');
      if (relInfo.desktop) {
        relInfo.desktop.version = next;
        relInfo.desktop.filename = `NexVault-${next}-x86_64.AppImage`;
        relInfo.desktop.tag = `v${next}-desktop`;
        relInfo.desktop.url = `https://github.com/${GITHUB_REPO}/releases/download/${relInfo.desktop.tag}/${relInfo.desktop.filename}`;
        writeJson('apps/website/public/release-info.json', relInfo);
        log('  ✓ apps/website/public/release-info.json (desktop block)');
      }
    }
    return;
  }

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
  if (existsSync(join(ROOT, 'apps/website/public/release-info.json'))) {
    const relInfo = readJson('apps/website/public/release-info.json');
    relInfo.version = next;
    relInfo.tag = `v${next}`;
    if (relInfo.desktop) {
      relInfo.desktop.version = next;
      relInfo.desktop.filename = `NexVault-${next}-x86_64.AppImage`;
      relInfo.desktop.tag = `v${next}`;
      relInfo.desktop.url = `https://github.com/${GITHUB_REPO}/releases/download/v${next}/${relInfo.desktop.filename}`;
    }
    if (relInfo.mobile) {
      relInfo.mobile.version = next;
      relInfo.mobile.versionCode = 100000 + (parseVersion(next)[0] * 1000000) + (parseVersion(next)[1] * 1000) + parseVersion(next)[2];
      relInfo.mobile.filename = `NexVault-${next}.apk`;
      relInfo.mobile.tag = `v${next}`;
      relInfo.mobile.url = `https://github.com/${GITHUB_REPO}/releases/download/v${next}/${relInfo.mobile.filename}`;
    }
    writeJson('apps/website/public/release-info.json', relInfo);
    log('  ✓ apps/website/public/release-info.json (all blocks)');
  }
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

let target = 'all';
for (const f of flags) {
  if (f.startsWith('--target=')) {
    target = f.slice(9).toLowerCase();
  }
}
if (!['all', 'mobile', 'desktop'].includes(target)) {
  fail(`Invalid target \"${target}\". Expected 'all', 'mobile', or 'desktop'.`);
}

if (flags.has('--verify')) {
  verify(positional[0] || process.env.GITHUB_REF_NAME);
  process.exit(0);
}

let current;
if (target === 'mobile') {
  current = readJson('apps/mobile/package.json').version;
} else if (target === 'desktop') {
  current = readJson('apps/desktop/package.json').version;
} else {
  current = readRootVersion();
}

const next = bumpVersion(current, positional[0] || 'patch');
if (compareVersions(next, current) <= 0) fail(`New version ${next} must be greater than ${current}`);
const tag = target === 'all' ? `v${next}` : `v${next}-${target}`;
const dryRun = flags.has('--dry-run');
const push = !flags.has('--no-push');

console.log('====================================================');
console.log(`  NexVault release [target=${target}]: v${current} → ${tag}${dryRun ? '  (dry run)' : ''}`);
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
  const targetFiles = target === 'mobile' 
    ? ['apps/mobile/package.json', 'apps/mobile/package-lock.json', 'apps/website/public/release-info.json (mobile block)']
    : target === 'desktop'
    ? ['apps/desktop/package.json', 'apps/desktop/package-lock.json', 'apps/website/public/release-info.json (desktop block)', ...TEXT_REPLACEMENTS.map((t) => t.file)]
    : [...JSON_VERSION_FILES, ...LOCKFILES, ...TEXT_REPLACEMENTS.map((t) => t.file), 'apps/website/public/release-info.json'];
  log(`Would update: ${targetFiles.join(', ')}`);
  log(`Would commit, tag ${tag}${push ? ` and push to origin/${branch}` : ''}.`);
  process.exit(0);
}

log(`Updating versions to ${next} (target: ${target})...`);
bumpFiles(next, target);

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
