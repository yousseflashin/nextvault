#!/usr/bin/env node
/**
 * scripts/release.mjs
 * 
 * Automates the complete NexVault release workflow:
 * 1. Bumps version across all workspace package.json files, Desktop, Mobile, Website, and Extension.
 * 2. Compiles Desktop AppImage and Android APK.
 * 3. Consolidates binaries into ./release/ directory.
 * 4. Git commits and tags the release.
 * 5. Pushes git tags to GitHub.
 * 6. Creates a GitHub Release via GitHub REST API and uploads the binaries.
 * 
 * Usage:
 *   node scripts/release.mjs [version | patch | minor | major] [options]
 * 
 * Options:
 *   --token <token>    GitHub Personal Access Token (or set GITHUB_TOKEN / GH_TOKEN)
 *   --skip-build       Skip compiling desktop and mobile binaries (use existing in dist/output)
 *   --skip-push        Skip git push
 *   --skip-upload      Skip uploading to GitHub Releases
 *   --dry-run          Preview version bumps without modifying files
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import readline from 'node:readline';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const GITHUB_REPO = 'yousseflashin/nextvault';

// Load .env files (.env, .env.local, .env.dev)
function loadDotenv() {
  const envFiles = ['.env', '.env.local', '.env.dev'];
  for (const file of envFiles) {
    const fullPath = join(ROOT, file);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath, 'utf8');
      for (const rawLine of content.split('\n')) {
        let line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('export ')) line = line.slice(7).trim();
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    } catch {}
  }
}
loadDotenv();

function log(msg) {
  console.log(`[NexVault Release] ${msg}`);
}

function runCmd(cmd, args, opts = {}) {
  const display = `${cmd} ${args.join(' ')}`;
  log(`> ${display}`);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...opts.env }
  });
  if (res.error) throw res.error;
  if (res.status !== 0 && !opts.allowFailure) {
    throw new Error(`Command failed with exit code ${res.status}: ${display}`);
  }
  return res;
}

// 1. Parse arguments & options
const args = process.argv.slice(2);
let targetArg = null;
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
let skipBuild = false;
let skipPush = false;
let skipUpload = false;
let dryRun = false;
let customNotes = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--token' && args[i + 1]) {
    token = args[++i];
  } else if (a.startsWith('--token=')) {
    token = a.split('=')[1];
  } else if (a === '--notes' && args[i + 1]) {
    customNotes = args[++i];
  } else if (a === '--skip-build') {
    skipBuild = true;
  } else if (a === '--skip-push') {
    skipPush = true;
  } else if (a === '--skip-upload') {
    skipUpload = true;
  } else if (a === '--dry-run') {
    dryRun = true;
  } else if (!a.startsWith('--') && !targetArg) {
    targetArg = a;
  }
}

// Check for .github_token file if token not in env
if (!token && existsSync(join(ROOT, '.github_token'))) {
  try {
    token = readFileSync(join(ROOT, '.github_token'), 'utf8').trim();
  } catch {}
}

// 2. Determine target version
const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version || '0.1.0';

let nextVersion = null;
if (!targetArg || targetArg === 'patch') {
  const parts = currentVersion.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  nextVersion = parts.join('.');
} else if (targetArg === 'minor') {
  const parts = currentVersion.split('.').map(Number);
  parts[1] = (parts[1] || 0) + 1;
  parts[2] = 0;
  nextVersion = parts.join('.');
} else if (targetArg === 'major') {
  const parts = currentVersion.split('.').map(Number);
  parts[0] = (parts[0] || 0) + 1;
  parts[1] = 0;
  parts[2] = 0;
  nextVersion = parts.join('.');
} else {
  nextVersion = targetArg.replace(/^v/, '');
}

console.log('====================================================');
console.log(`  NexVault Release Pipeline: v${currentVersion} -> v${nextVersion}`);
console.log('====================================================\n');

if (dryRun) {
  log(`[DRY RUN] Would update version to ${nextVersion}`);
  process.exit(0);
}

// 3. Update all files with new version
log(`[1/5] Updating version numbers across the repository to ${nextVersion}...`);

function updateJsonVersion(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return;
  const pkg = JSON.parse(readFileSync(abs, 'utf8'));
  pkg.version = nextVersion;
  writeFileSync(abs, JSON.stringify(pkg, null, 2) + '\n');
  log(`  ✓ Updated ${relPath}`);
}

function updateFileContent(relPath, replacer) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return;
  const original = readFileSync(abs, 'utf8');
  const updated = replacer(original);
  if (original !== updated) {
    writeFileSync(abs, updated);
    log(`  ✓ Updated ${relPath}`);
  }
}

// Update package.json files
updateJsonVersion('package.json');
updateJsonVersion('packages/core/package.json');
updateJsonVersion('apps/desktop/package.json');
updateJsonVersion('apps/mobile/package.json');
updateJsonVersion('apps/relay/package.json');
updateJsonVersion('apps/website/package.json');

// Update manifests
updateJsonVersion('apps/extension/src/manifest.json');
updateJsonVersion('apps/extension/src/manifest.chrome.json');
updateJsonVersion('apps/extension/src/manifest.firefox.json');

// Update desktop main.js and index.html
updateFileContent('apps/desktop/src/main.js', (content) => {
  return content.replace(/const CURRENT_VERSION = ['"][^'"]+['"];/, `const CURRENT_VERSION = '${nextVersion}';`);
});

updateFileContent('apps/desktop/src/index.html', (content) => {
  return content
    .replace(/title="NexVault Desktop v[^"]+"/, `title="NexVault Desktop v${nextVersion}"`)
    .replace(/<span class="nv-badge"([^>]*)>v[^<]+<\/span>/, `<span class="nv-badge"$1>v${nextVersion}</span>`)
    .replace(/NexVault is up to date \([^)]+\)/g, `NexVault is up to date (v${nextVersion})`);
});

// Update mobileVault.ts and index.tsx
updateFileContent('apps/mobile/src/mobileVault.ts', (content) => {
  return content.replace(/export const CURRENT_VERSION = ['"][^'"]+['"];/, `export const CURRENT_VERSION = '${nextVersion}';`);
});

// Update website downloads and metadata
const releaseMeta = {
  version: nextVersion,
  tag: `v${nextVersion}`,
  desktop: {
    filename: `NexVault-${nextVersion}.AppImage`,
    size: '124.5 MB',
    url: `https://github.com/${GITHUB_REPO}/releases/download/v${nextVersion}/NexVault-${nextVersion}.AppImage`
  },
  mobile: {
    filename: 'NexVault-mobile-app-debug.apk',
    size: '4.0 MB',
    url: `https://github.com/${GITHUB_REPO}/releases/download/v${nextVersion}/NexVault-mobile-app-debug.apk`
  },
  publishedAt: new Date().toISOString()
};

writeFileSync(join(ROOT, 'apps/website/src/release-info.json'), JSON.stringify(releaseMeta, null, 2) + '\n');
writeFileSync(join(ROOT, 'apps/website/public/release-info.json'), JSON.stringify(releaseMeta, null, 2) + '\n');
log('  ✓ Updated apps/website/src/release-info.json and public/release-info.json');

updateFileContent('apps/website/public/downloads.html', (content) => {
  return content
    .replace(/releases\/download\/v[^/]+\/NexVault-.*?\.AppImage/g, `releases/download/v${nextVersion}/NexVault-${nextVersion}.AppImage`)
    .replace(/releases\/download\/v[^/]+\/NexVault-mobile-app-debug\.apk/g, `releases/download/v${nextVersion}/NexVault-mobile-app-debug.apk`);
});

// 4. Build desktop, mobile, and website
if (skipBuild) {
  log('[2/5] Skipping compilation (--skip-build requested). Consolidating existing builds...');
  runCmd('node', ['scripts/publish-builds.mjs']);
} else {
  log('[2/5] Compiling and packaging Desktop AppImage, Android APK, and Website...');
  
  // Sync core packages first
  runCmd('node', ['scripts/sync-core.mjs']);

  // Desktop AppImage build (suppress GITHUB_TOKEN from electron-builder to avoid auto-publish crash)
  log('Building Desktop AppImage...');
  runCmd('npm', ['--prefix', 'apps/desktop', 'run', 'build'], {
    env: { GH_TOKEN: '', GITHUB_TOKEN: '' }
  });

  // Mobile Android APK build
  log('Building Mobile Android APK...');
  runCmd('node', ['scripts/build-mobile-android.mjs']);

  // Consolidate into release/ directory
  log('Consolidating release artifacts into ./release/...');
  runCmd('node', ['scripts/publish-builds.mjs']);

  // Website build with updated links
  log('Building Website distribution...');
  runCmd('npm', ['--prefix', 'apps/website', 'run', 'build']);
}

// 5. Git Commit and Tag
log(`[3/5] Git staging and tagging release v${nextVersion}...`);
try {
  runCmd('git', ['add', '-A']);

  // Security audit: ensure no staged files contain raw GitHub Personal Access Tokens
  const tokenAudit = spawnSync('git', ['diff', '--cached', '-G', 'ghp_[A-Za-z0-9]{20,}', '--name-only'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (tokenAudit.stdout && tokenAudit.stdout.trim()) {
    runCmd('git', ['reset']);
    throw new Error(`SECURITY ALERT: Aborting release! Staged file(s) contain a GitHub token:\n${tokenAudit.stdout.trim()}`);
  }

  const commitMsg = `chore(release): v${nextVersion}`;
  runCmd('git', ['commit', '-m', commitMsg], { allowFailure: true });
  
  // Delete existing local tag if re-tagging
  runCmd('git', ['tag', '-d', `v${nextVersion}`], { allowFailure: true, silent: true });
  runCmd('git', ['tag', '-a', `v${nextVersion}`, '-m', `Release v${nextVersion}`]);
  log(`  ✓ Created git tag v${nextVersion}`);

  if (!skipPush) {
    log('Pushing commits and tags to origin/master...');
    const pushRes = runCmd('git', ['push', 'origin', 'master', '--tags', '--force'], { allowFailure: true });
    if (pushRes.status === 0) {
      log('  ✓ Pushed commits and tags to GitHub successfully.');
    } else {
      log('  ⚠️ Git push failed or required credentials. You can push manually using: git push origin master --tags');
    }
  }
} catch (err) {
  log('  ⚠️ Git operation notice: ' + err.message);
}

// 6. GitHub Release & Asset Upload
log(`[4/5] Checking release artifacts in ./release/...`);
const releaseDir = join(ROOT, 'release');
const artifacts = existsSync(releaseDir) ? readdirSync(releaseDir).filter(f => {
  if (f.endsWith('.apk')) return true;
  if (f.endsWith('.AppImage') && (f === `NexVault-${nextVersion}.AppImage` || f.includes(nextVersion))) return true;
  return false;
}) : [];

if (artifacts.length === 0) {
  console.warn('⚠️ No files found in ./release/. Please check build logs.');
} else {
  log(`Found ${artifacts.length} artifact(s) to publish:`);
  for (const art of artifacts) {
    const size = (statSync(join(releaseDir, art)).size / 1024 / 1024).toFixed(1);
    console.log(`  - release/${art} (${size} MB)`);
  }
}

function uploadAssetStream({ uploadUrl, filePath, fileName, fileSize }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(uploadUrl);
    const reqOpts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
        'User-Agent': 'NexVault-Release-Bot',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    let uploaded = 0;
    const fileStream = createReadStream(filePath);
    let lastPercent = -1;

    fileStream.on('data', chunk => {
      uploaded += chunk.length;
      const pct = Math.floor((uploaded / fileSize) * 100);
      if (pct % 20 === 0 && pct !== lastPercent) {
        lastPercent = pct;
        process.stdout.write(`  ${fileName}: ${pct}% (${(uploaded / 1024 / 1024).toFixed(1)} / ${(fileSize / 1024 / 1024).toFixed(1)} MB)\r`);
      }
    });

    fileStream.on('end', () => {
      process.stdout.write(`  ${fileName}: 100% uploaded. Finalizing with GitHub...\n`);
    });

    fileStream.pipe(req);
  });
}

function promptQuestion(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function uploadToGitHub() {
  if (skipUpload) {
    log('Skipping GitHub upload (--skip-upload passed).');
    return;
  }

  if (!token) {
    console.log('\n------------------------------------------------------------');
    console.log('🔑 GitHub Token not found in environment, .env, or .env.dev.');
    console.log('Get a Personal Access Token here:');
    console.log('👉 https://github.com/settings/tokens/new?scopes=repo&description=NexVault+Releases\n');
    const inputToken = await promptQuestion('Enter GitHub Token to upload release (or press Enter to skip): ');
    if (inputToken) {
      token = inputToken;
      const envDevPath = join(ROOT, '.env.dev');
      if (existsSync(envDevPath)) {
        try {
          let devContent = readFileSync(envDevPath, 'utf8');
          if (devContent.includes('export GITHUB_TOKEN=')) {
            devContent = devContent.replace(/export GITHUB_TOKEN=.*$/, `export GITHUB_TOKEN=${token}`);
          } else {
            devContent += `\nexport GITHUB_TOKEN=${token}\n`;
          }
          writeFileSync(envDevPath, devContent);
          log('✓ Saved GITHUB_TOKEN to .env.dev for future runs.');
        } catch {}
      }
    } else {
      console.log('No token provided. Skipping GitHub API upload.');
      console.log(`Manual upload: https://github.com/${GITHUB_REPO}/releases/new?tag=v${nextVersion}`);
      console.log('------------------------------------------------------------\n');
      return;
    }
  }

  log(`[5/5] Connecting to GitHub API (repo: ${GITHUB_REPO})...`);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': `NexVault-Release-Bot/${nextVersion}`
  };

  // 1. Check if release tag already exists
  const checkUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${nextVersion}`;
  let release = null;
  try {
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      release = await checkRes.json();
      log(`Release v${nextVersion} already exists on GitHub (ID: ${release.id}). Updating assets...`);
    }
  } catch {}

  // 2. Create release if not existing
  if (!release) {
    log(`Creating new release v${nextVersion} on GitHub...`);
    const releaseBody = customNotes || [
      `## NexVault v${nextVersion}`,
      '',
      '- **Local-First Security**: Client-side encrypted passwords, TOTP tokens, and trusted-device network.',
      '- **In-App Auto-Updates**: Native update detection for Desktop (AppImage) and Mobile (Android).',
      '- **Zero Cloud Reliance**: E2E encrypted P2P synchronization with automatic reconnection.',
      '',
      '### Official Binaries',
      ...artifacts.map(a => `- \`${a}\``)
    ].join('\n');

    const createRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: `v${nextVersion}`,
        target_commitish: 'master',
        name: `NexVault v${nextVersion}`,
        body: releaseBody,
        draft: false,
        prerelease: false
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create GitHub release (HTTP ${createRes.status}): ${errText}`);
    }

    release = await createRes.json();
    log(`✓ Created GitHub Release: "${release.name}" (ID: ${release.id})`);
  }

  // 3. Upload assets
  const existingAssets = release.assets || [];
  for (const file of artifacts) {
    const filePath = join(releaseDir, file);
    const stats = statSync(filePath);
    const size = stats.size;
    const sizeMb = (size / 1024 / 1024).toFixed(1);

    // Delete existing asset with same name if present
    const existing = existingAssets.find(a => a.name === file);
    if (existing) {
      log(`Deleting previously uploaded asset "${file}" (ID: ${existing.id})...`);
      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers
      });
    }

    log(`Uploading ${file} (${sizeMb} MB) to GitHub Release...`);
    const uploadUrl = `https://uploads.github.com/repos/${GITHUB_REPO}/releases/${release.id}/assets?name=${encodeURIComponent(file)}`;
    await uploadAssetStream({
      uploadUrl,
      filePath,
      fileName: file,
      fileSize: size
    });
    log(`  ✓ Successfully uploaded ${file}`);
  }

  console.log('\n====================================================');
  console.log(`🎉 RELEASE v${nextVersion} PUBLISHED ON GITHUB!`);
  console.log(`URL: https://github.com/${GITHUB_REPO}/releases/tag/v${nextVersion}`);
  console.log('Now both Desktop and Mobile apps will detect this new version immediately!');
  console.log('====================================================\n');
}

await uploadToGitHub().catch(err => {
  console.error('\n❌ Error during release upload:', err.message);
  console.log(`\nYou can still publish manually at: https://github.com/${GITHUB_REPO}/releases/new?tag=v${nextVersion}`);
});

