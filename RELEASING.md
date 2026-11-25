# NexVault Release & Auto-Update Guide

## 1. Quick Start: The One-Command Release

NexVault has a single, unified release orchestrator (`npm run release`) that runs tests, bumps versions, builds Desktop & Android binaries, computes real byte sizes and SHA-256 checksums, updates the website, commits, tags, pushes, and uploads everything to GitHub Releases in one command.

### Standard Full Release (Build + Commit + Tag + Push + Upload)
```bash
# 1. Provide your GitHub token once in .env.dev (or export GITHUB_TOKEN=ghp_...):
echo 'export GITHUB_TOKEN=ghp_your_personal_access_token' >> .env.dev

# 2. Run the release command (defaults to patch bump, e.g. 0.1.49 -> 0.1.50):
npm run release -- --upload
```

### Granular Release Commands
```bash
# Explicit semver bump (minor, major, or exact version):
npm run release -- minor --upload
npm run release -- 0.2.0 --upload

# Fast upload of pre-existing ./release/ binaries without rebuilding:
npm run release -- --upload-only 0.1.49

# Decoupled platform release (e.g. mobile APK only):
npm run release -- --target=mobile --upload

# Decoupled platform release (e.g. desktop AppImage only):
npm run release -- --target=desktop --upload

# Dry-run preview (simulates all steps without touching files or git):
npm run release -- --dry-run

# Delegate builds to GitHub Actions (bump manifests, tag, and push only):
npm run release -- --no-build

# Local build only without pushing to remote:
npm run release -- --no-push
```

---

## 2. Step-by-Step Release Pipeline Stages

When you run `npm run release`, the orchestrator executes these 6 steps in deterministic order:

1. **Pre-flight verification**:
   - Ensures git working tree is clean (`nothing to commit`).
   - Ensures version bump is strictly greater than current version.
   - Ensures git tag does not already exist on remote.
2. **Pre-release test gate**:
   - Runs `npm test` (all core cryptographic suites, replica engine, and relay routing tests).
   - If any test fails, halts immediately before mutating any workspace or version file.
3. **Synchronized version stamping**:
   - Updates `package.json` across all workspaces (`packages/core`, `apps/desktop`, `apps/mobile`, `apps/relay`, `apps/website`, `apps/extension`).
   - Syncs extension manifests (`manifest.json`, `manifest.chrome.json`, `manifest.firefox.json`).
   - Computes deterministic monotonic Android `versionCode` (`100000 + major*1000000 + minor*1000 + patch`).
4. **Deterministic binary compilation & measurement**:
   - Compiles Linux x86_64 AppImage via `apps/desktop`.
   - Compiles Android APK via `scripts/build-mobile-android.mjs`.
   - Reads compiled binaries directly from disk to compute exact byte counts and SHA-256 digests.
   - Writes `release/release-info.json` (Schema v2) and `release/SHA256SUMS.txt`.
   - Rebuilds marketing website (`apps/website`) with freshly measured manifest.
5. **Atomic Git Commit & Tag**:
   - Stages all changes (`git add -A`).
   - Scans staged files for accidental credential or token leaks.
   - Commits `chore(release): vX.Y.Z`.
   - Creates annotated tag `vX.Y.Z`.
   - Pushes branch and tag to remote (`origin/main`).
6. **GitHub Release Publication & Asset Upload**:
   - Resolves `GITHUB_TOKEN` from environment, `--token=...`, or `.env.dev`.
   - Creates the GitHub Release object with tag `vX.Y.Z`.
   - Uploads binary artifacts (`.AppImage`, `.apk`), `release-info.json`, and `SHA256SUMS.txt`.
   - In-app updaters immediately detect the new release on their next poll.

---

## 3. Canonical Workspace Scripts

All redundant scripts in `package.json` have been consolidated into these canonical commands:

| Command | Purpose |
| :--- | :--- |
| `npm run release` | Unified release orchestrator (supports `--upload`, `--target`, `--dry-run`, `--no-build`) |
| `npm test` | Runs complete monorepo test suite (`test:core` + `test:relay`) |
| `npm run build` | Builds production landing website with verified release metadata |
| `npm run start` | Runs landing website in local development mode |
| `npm run start:desktop` | Launches Electron desktop app in local dev mode |
| `npm run build:desktop` | Compiles Linux x86_64 AppImage for desktop |
| `npm run start:mobile` | Runs mobile client in Vite dev mode |
| `npm run build:mobile` | Assembles Android APK via Gradle |
| `npm run start:relay` | Starts P2P WebRTC signaling relay locally |
| `npm run build:relay` | Compiles relay server for deployment |
| `npm run sync:assets` | Synchronizes shared CSS and cyber theme across all packages |
| `npm run sync:core` | Synchronizes shared cryptography core across apps |
| `npm run extension:chrome` | Sets up Chrome manifest for extension |
| `npm run extension:firefox` | Sets up Firefox manifest for extension |
| `npm run extension:pack:firefox` | Packages signed XPI/ZIP for Firefox extension |

---

## 4. In-App Auto-Update Architecture

NexVault client applications verify updates cryptographically before applying them:

1. **Manifest Polling**:
   Both Desktop (`apps/desktop/src/main.js`) and Mobile (`apps/mobile/src/updater.ts`) poll `https://github.com/yousseflashin/nextvault/releases/latest/download/release-info.json`.
2. **Strict Verification**:
   - Validates that target version is strictly newer than current version.
   - Compares the downloaded file's SHA-256 digest against the manifest checksum.
   - Compares byte length against manifest `size`.
   - Verifies file signatures (ELF binary headers on Linux; Android package name, `versionCode`, and signing certificates on Android).
3. **Fail-Safe Fallback**:
   If an update is interrupted, corrupted, or tampered with, the file is deleted immediately and the application continues on the current stable version without disruption.

---

## 5. Android Signing Keystore Setup (One-Time)

### Local Debug Builds (Default)
Local builds (`npm run build:mobile`) assemble `app-debug.apk` without requiring extra keystore configuration.

### Local Production Signed Builds
Create `apps/mobile/android/keystore.properties` (git-ignored):
```properties
storeFile=/absolute/path/to/nexvault-release.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=nexvault
keyPassword=YOUR_KEY_PASSWORD
```

### GitHub Actions CI Secrets
For cloud releases triggered via GitHub Actions, add these secrets under **GitHub Repository → Settings → Secrets and variables → Actions**:
* `ANDROID_KEYSTORE_BASE64`: Output of `base64 -w0 nexvault-release.keystore`
* `ANDROID_KEYSTORE_PASSWORD`: Keystore password
* `ANDROID_KEY_ALIAS`: `nexvault`
* `ANDROID_KEY_PASSWORD`: Key password
