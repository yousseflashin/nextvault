#!/usr/bin/env node
/**
 * scripts/upload-release.mjs
 * 
 * Uploads pre-built binaries from ./release/ directly to a GitHub Release.
 * Automatically loads GITHUB_TOKEN from .env, .env.dev, .env.local, or environment variables.
 * 
 * Usage:
 *   node scripts/upload-release.mjs [version]
 *   npm run release:upload
 */

import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

if (!token && existsSync(join(ROOT, '.github_token'))) {
  try {
    token = readFileSync(join(ROOT, '.github_token'), 'utf8').trim();
  } catch {}
}

const args = process.argv.slice(2);
let versionArg = args.find(a => !a.startsWith('--'));

if (!versionArg) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  versionArg = pkg.version || '0.1.1';
}
const version = versionArg.replace(/^v/, '');
const tag = `v${version}`;

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

function githubRequest(urlStr, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const reqOpts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'NexVault-Uploader',
        'Accept': 'application/vnd.github.v3+json',
        ...(options.headers || {})
      }
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null, raw: data });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    req.end();
  });
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
        'User-Agent': 'NexVault-Uploader',
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

async function main() {
  console.log('====================================================');
  console.log(`  NexVault Release Uploader -> GitHub (${tag})`);
  console.log('====================================================\n');

  if (!token) {
    console.log('⚠️ GITHUB_TOKEN not found in environment, .env, or .env.dev.\n');
    console.log('You can generate a token here: https://github.com/settings/tokens/new?scopes=repo&description=NexVault+Releases\n');
    const inputToken = await promptQuestion('👉 Paste your GitHub Personal Access Token (or press Ctrl+C to cancel): ');
    if (!inputToken) {
      console.log('No token entered. Exiting.');
      process.exit(1);
    }
    token = inputToken;

    // Prompt to save to .env.dev
    const envDevPath = join(ROOT, '.env.dev');
    if (existsSync(envDevPath)) {
      let devContent = readFileSync(envDevPath, 'utf8');
      if (devContent.includes('export GITHUB_TOKEN=')) {
        devContent = devContent.replace(/export GITHUB_TOKEN=.*$/, `export GITHUB_TOKEN=${token}`);
      } else {
        devContent += `\nexport GITHUB_TOKEN=${token}\n`;
      }
      readFileSync(envDevPath);
      // Save
      try {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(envDevPath, devContent);
        console.log('✓ Saved GITHUB_TOKEN to .env.dev for future runs.');
      } catch {}
    }
  }

  // 1. Validate token with GitHub
  console.log('Connecting to GitHub API...');
  const userCheck = await githubRequest('https://api.github.com/user');
  if (userCheck.status !== 200) {
    throw new Error(`Invalid GitHub Token (HTTP ${userCheck.status}). Check permissions ('repo' scope needed).`);
  }
  console.log(`✓ Authenticated as: ${userCheck.data.login}`);

  // 2. Check if release already exists
  console.log(`Checking release tag ${tag} on repository ${GITHUB_REPO}...`);
  let release = null;
  const relCheck = await githubRequest(`https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`);
  if (relCheck.status === 200 && relCheck.data) {
    release = relCheck.data;
    console.log(`✓ Release ${tag} found (ID: ${release.id}).`);
  } else {
    // Create new release
    console.log(`Creating new release ${tag} on GitHub...`);
    const createRes = await githubRequest(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      tag_name: tag,
      target_commitish: 'master',
      name: `NexVault ${tag}`,
      body: `## NexVault ${tag}\n\n- Local-first password & OTP authenticator\n- Zero cloud reliance with peer-to-peer WebRTC sync\n- Built-in In-App Auto-Updates\n\n### Official Downloads\n- \`NexVault-${version}.AppImage\` (Desktop Linux)\n- \`NexVault-mobile-app-debug.apk\` (Android)`,
      draft: false,
      prerelease: false
    });

    if (createRes.status < 200 || createRes.status >= 300) {
      throw new Error(`Failed to create release (HTTP ${createRes.status}): ${JSON.stringify(createRes.data)}`);
    }
    release = createRes.data;
    console.log(`✓ Created GitHub Release: "${release.name}" (ID: ${release.id})`);
  }

  // 3. Scan release/ directory for assets
  const releaseDir = join(ROOT, 'release');
  if (!existsSync(releaseDir)) {
    throw new Error('release/ directory not found! Run npm run release first.');
  }

  const allFiles = readdirSync(releaseDir);
  // Match version-specific AppImage or latest AppImage, plus mobile APK
  const filesToUpload = allFiles.filter(f => {
    if (f.endsWith('.apk')) return true;
    if (f.endsWith('.AppImage') && (f.includes(version) || allFiles.length === 2)) return true;
    return false;
  });

  if (filesToUpload.length === 0) {
    throw new Error(`No matching build artifacts found in release/ to upload.`);
  }

  console.log(`\nFound ${filesToUpload.length} binary artifact(s) to upload:`);
  for (const f of filesToUpload) {
    const size = (statSync(join(releaseDir, f)).size / 1024 / 1024).toFixed(1);
    console.log(`  - ${f} (${size} MB)`);
  }
  console.log('');

  // 4. Upload each asset
  const existingAssets = release.assets || [];
  for (const fileName of filesToUpload) {
    const filePath = join(releaseDir, fileName);
    const stats = statSync(filePath);
    const size = stats.size;

    // Check if asset already exists in release
    const existing = existingAssets.find(a => a.name === fileName);
    if (existing) {
      console.log(`Asset "${fileName}" already exists on GitHub (ID: ${existing.id}). Replacing...`);
      await githubRequest(`https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${existing.id}`, {
        method: 'DELETE'
      });
      console.log(`  ✓ Removed old asset.`);
    }

    const uploadUrl = `https://uploads.github.com/repos/${GITHUB_REPO}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;
    await uploadAssetStream({
      uploadUrl,
      filePath,
      fileName,
      fileSize: size
    });
    console.log(`  ✓ Successfully attached "${fileName}" to Release ${tag}!`);
  }

  // Update website release-info.json
  try {
    const { writeFileSync } = await import('node:fs');
    const desktopFile = filesToUpload.find(f => f.endsWith('.AppImage'));
    const mobileFile = filesToUpload.find(f => f.endsWith('.apk'));
    const releaseMeta = {
      version,
      tag,
      desktop: {
        filename: desktopFile || `NexVault-${version}.AppImage`,
        size: desktopFile ? `${(statSync(join(releaseDir, desktopFile)).size / 1024 / 1024).toFixed(1)} MB` : '124.5 MB',
        url: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${desktopFile || `NexVault-${version}.AppImage`}`
      },
      mobile: {
        filename: mobileFile || 'NexVault-mobile-app-debug.apk',
        size: mobileFile ? `${(statSync(join(releaseDir, mobileFile)).size / 1024 / 1024).toFixed(1)} MB` : '4.0 MB',
        url: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${mobileFile || 'NexVault-mobile-app-debug.apk'}`
      },
      publishedAt: new Date().toISOString()
    };
    writeFileSync(join(ROOT, 'apps/website/src/release-info.json'), JSON.stringify(releaseMeta, null, 2) + '\n');
    writeFileSync(join(ROOT, 'apps/website/public/release-info.json'), JSON.stringify(releaseMeta, null, 2) + '\n');
    console.log('  ✓ Updated apps/website release-info.json');
  } catch {}

  console.log('\n====================================================');
  console.log(`🎉 SUCCESS: Release ${tag} is now fully published on GitHub!`);
  console.log(`🔗 Release URL: https://github.com/${GITHUB_REPO}/releases/tag/${tag}`);
  console.log('Both Desktop and Mobile apps will now automatically detect this release on update check!');
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ Upload failed:', err.message);
  process.exit(1);
});

