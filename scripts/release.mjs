#!/usr/bin/env node
/**
 * scripts/release.mjs
 *
 * Professional-grade release orchestrator for NexVault:
 *
 *   1. Pre-flight verification (git status, valid semver bump, tag uniqueness).
 *   2. Pre-release tests (runs full unit test suite before touching any files).
 *   3. Synchronized version stamping across all workspaces, lockfiles, and manifests.
 *   4. Deterministic builds & artifact measurement (AppImage + Android APK).
 *   5. Real hash & size measurement into release-info.json schema-v2 + SHA256SUMS.txt.
 *   6. Website build with fresh release metadata.
 *   7. Clean atomic git commit + annotated tag.
 *   8. Push to remote and upload to GitHub Releases.
 *
 * Usage:
 *   npm run release                  # Standard patch bump (e.g. 0.1.44 -> 0.1.45)
 *   npm run release -- minor         # Minor bump
 *   npm run release -- 0.2.0         # Explicit semver
 *   npm run release -- --dry-run     # Preview without modifying files or git
 *   npm run release -- --no-build    # Fast CI mode: bumps versions, commits, tags, pushes (CI builds)
 *   npm run release -- --no-push     # Local release only without pushing to remote
 *   npm run release -- --target=mobile   # Mobile-only decoupled release
 *   npm run release -- --target=desktop  # Desktop-only decoupled release
 *   npm run release -- --verify v0.1.45  # Verification gate for CI runners
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  GITHUB_REPO,
  androidVersionCode,
  bumpVersion,
  compareVersions,
  parseVersion,
  readRootVersion
} from './lib/release-common.mjs';

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

/** Static text templates that show the version in desktop. */
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

function run(cmd, args, { cwd = ROOT } = {}) {
  log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    fail(`Step failed: ${cmd} ${args.join(' ')} (exit code ${res.status})`);
  }
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
    const mobJson = readJson('apps/mobile/package.json');
    mobJson.version = next;
    writeJson('apps/mobile/package.json', mobJson);
    log('  ✓ apps/mobile/package.json');

    if (existsSync(join(ROOT, 'apps/mobile/package-lock.json'))) {
      const lock = readJson('apps/mobile/package-lock.json');
      lock.version = next;
      if (lock.packages?.['']) lock.packages[''].version = next;
      writeJson('apps/mobile/package-lock.json', lock);
      log('  ✓ apps/mobile/package-lock.json');
    }

    if (existsSync(join(ROOT, 'apps/website/public/release-info.json'))) {
      const relInfo = readJson('apps/website/public/release-info.json');
      if (relInfo.mobile) {
        relInfo.mobile.version = next;
        relInfo.mobile.versionCode = androidVersionCode(next);
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
    const dtJson = readJson('apps/desktop/package.json');
    dtJson.version = next;
    writeJson('apps/desktop/package.json', dtJson);
    log('  ✓ apps/desktop/package.json');

    if (existsSync(join(ROOT, 'apps/desktop/package-lock.json'))) {
      const lock = readJson('apps/desktop/package-lock.json');
      lock.version = next;
      if (lock.packages?.['']) lock.packages[''].version = next;
      writeJson('apps/desktop/package-lock.json', lock);
      log('  ✓ apps/desktop/package-lock.json');
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

  // Target 'all': bump all packages and manifests
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
      relInfo.mobile.versionCode = androidVersionCode(next);
      relInfo.mobile.filename = `NexVault-${next}.apk`;
      relInfo.mobile.tag = `v${next}`;
      relInfo.mobile.url = `https://github.com/${GITHUB_REPO}/releases/download/v${next}/${relInfo.mobile.filename}`;
    }
    writeJson('apps/website/public/release-info.json', relInfo);
    log('  ✓ apps/website/public/release-info.json');
  }
}

// ---------------------------------------------------------------- main logic
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

if (flags.has('--help') || flags.has('-h')) {
  console.log(`
====================================================
  NexVault Unified Release CLI
====================================================

  Usage:
    npm run release                       Complete patch release (test, build, manifest, commit, tag, push, upload)
    npm run release -- minor              Minor version bump
    npm run release -- 0.2.0              Explicit semver
    npm run release -- --upload           Enforce upload to GitHub Releases
    npm run release -- --upload-only      Upload existing ./release/ binaries without rebuild
    npm run release -- --target=mobile    Mobile-only release (Android APK)
    npm run release -- --target=desktop   Desktop-only release (AppImage)
    npm run release -- --dry-run          Preview release without changing files or git
    npm run release -- --no-build         Bump and push only (delegate build to CI)
    npm run release -- --no-push          Build and measure locally without git push
    npm run release -- --verify vX.Y.Z    Verify workspace manifests match tag
`);
  process.exit(0);
}

if (flags.has('--upload-only')) {
  const ver = positional[0] || readRootVersion();
  log(`Uploading existing release artifacts for v${ver}...`);
  run('node', ['scripts/upload-release.mjs', ver]);
  process.exit(0);
}

let target = 'all';
for (const f of flags) {
  if (f.startsWith('--target=')) {
    target = f.slice(9).toLowerCase();
  }
}
if (!['all', 'mobile', 'desktop'].includes(target)) {
  fail(`Invalid target "${target}". Expected 'all', 'mobile', or 'desktop'.`);
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
const noBuild = flags.has('--no-build');
const skipTests = flags.has('--no-test');
const forceUpload = flags.has('--upload');
const noUpload = flags.has('--no-upload') && !forceUpload;

console.log('====================================================');
console.log(`  NexVault Professional Release Pipeline`);
console.log(`  Target:  ${target}`);
console.log(`  Version: v${current} → ${tag}${dryRun ? '  (DRY RUN)' : ''}`);
console.log(`  Build:   ${noBuild ? 'Skipped (--no-build)' : 'Full Build & Measure'}`);
console.log(`  Upload:  ${forceUpload ? 'Enforced (--upload)' : (noUpload ? 'Disabled' : 'Auto if GITHUB_TOKEN present')}`);
console.log('====================================================\n');

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
  log(`[dry-run] Would bump versions from ${current} to ${next} (target: ${target}).`);
  if (!noBuild) log('[dry-run] Would build desktop, mobile, and website artifacts.');
  log(`[dry-run] Would commit, tag ${tag}${push ? ` and push to origin/${branch}` : ''}.`);
  process.exit(0);
}

// 1. Pre-flight tests
if (!skipTests) {
  log('[1/6] Running pre-release verification tests...');
  run('npm', ['run', 'test:core']);
  run('npm', ['run', 'test:relay']);
  log('✓ Pre-release tests passed.');
} else {
  log('[1/6] Skipping pre-release tests (--no-test).');
}

// 2. Bump versions
log(`[2/6] Stamping version ${next} across workspaces (target: ${target})...`);
bumpFiles(next, target);

// 3. Build & Measure Artifacts (if not --no-build)
if (!noBuild) {
  log('[3/6] Building production artifacts...');
  run('npm', ['run', 'sync:assets']);
  run('npm', ['run', 'sync:core']);

  if (target === 'all' || target === 'desktop') {
    log('Building Desktop AppImage...');
    run('npm', ['--prefix', 'apps/desktop', 'run', 'build']);
  }

  if (target === 'all' || target === 'mobile') {
    log('Building Mobile Android APK...');
    run('node', ['scripts/build-mobile-android.mjs']);
  }

  log('Consolidating artifacts and measuring real SHA-256 hashes & sizes...');
  run('node', ['scripts/publish-builds.mjs']);

  log('Building landing website with fresh manifest...');
  run('npm', ['--prefix', 'apps/website', 'run', 'build']);
} else {
  log('[3/6] Skipping artifact compilation (--no-build).');
}

// 4. Git Stage & Commit
log('[4/6] Staging files and creating atomic release commit...');
git(['add', '-A']);

// Check for accidental token leaks
const leaked = git(['diff', '--cached', '--name-only', '-G', '(ghp_|github_pat_)[A-Za-z0-9_]{20,}'], { capture: true }).stdout.trim();
if (leaked) {
  git(['reset', '-q']);
  fail(`Aborting: staged files contain what looks like a GitHub token:\n${leaked}`);
}

git(['commit', '-m', `chore(release): ${tag}`]);
git(['tag', '-a', tag, '-m', `NexVault ${tag}`]);
log(`✓ Created release commit and tag ${tag}`);

// 5. Push to Git remote
if (push) {
  log(`[5/6] Pushing ${branch} and ${tag} to remote...`);
  git(['push', 'origin', branch]);
  git(['push', 'origin', tag]);
  log(`✓ Successfully pushed ${branch} and ${tag}.`);
} else {
  log(`[5/6] Skipping git push (--no-push). Run when ready: git push origin ${branch} && git push origin ${tag}`);
}

// 6. Upload to GitHub Releases (if token present and not disabled)
if (!noUpload && !noBuild) {
  log('[6/6] Checking for GitHub Release upload capability...');
  const envDevPath = join(ROOT, '.env.dev');
  let hasToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (!hasToken && existsSync(envDevPath)) {
    const devContent = readFileSync(envDevPath, 'utf8');
    if (/GITHUB_TOKEN=[\w-]{20,}/.test(devContent)) hasToken = true;
  }

  if (hasToken) {
    log('GitHub token found — uploading release artifacts...');
    run('node', ['scripts/upload-release.mjs', next]);
  } else if (forceUpload) {
    fail('Upload requested (--upload) but no GITHUB_TOKEN or GH_TOKEN found in environment or .env.dev!');
  } else {
    log('Note: GITHUB_TOKEN not set. Artifacts are ready in ./release/. GitHub Actions will publish, or run npm run release -- --upload.');
  }
} else {
  log('[6/6] Skipping GitHub Release upload.');
}

console.log('\n====================================================');
console.log(`🎉 NexVault Release ${tag} complete!`);
console.log('====================================================\n');
