# Flagship Material Design 3 UI, Unified Release CLI & Native Autofill Persistence Plan

**Date**: 2026-11-25  
**Project**: NextVault (NexVault)  
**Workspace**: `/home/youssef/projects/nextvault`  
**Plan ID**: `2026-11-25_095842-flagship-material-unified-release-autofill-fix`

---

## 1. Goal
Transform the NextVault mobile client into a flagship Google Material Design 3 (Material You / M3 Expressive) experience, provide a unified single-command release orchestrator with granular CLI flags (`--upload`, `--target`) and cleaned `package.json`, and eliminate the Android autofill credential wipe bug that locked saved credentials at 315.

---

## 2. Current Context & Root-Cause Analysis

### 2.1 The "Stuck at 315 Credentials" Autofill Bug
When an Android user logs into an external app or website, taps "Save" on the NextVault system autofill dialog, and reopens NextVault, the credential count remains stuck at 315.
Through code inspection, three distinct root causes were identified:
1. **Critical Overwrite on Unlock Race**: In `apps/mobile/src/mobileVault.ts` (lines 511–512) and `apps/mobile/src/index.tsx` (lines 2061–2062), `syncAutofillCredentials()` is executed *before* `mergeNativeAutofillCredentials()`. `syncAutofillCredentials()` overwrites Android's `NativeCredentialStore` with the stale decrypted vault from `localStorage` (which only has 315 items), permanently erasing the freshly captured credential before the app ever attempts to read it.
2. **Missing Dedicated Pending Store**: `NexVaultAutofillService.java` writes newly saved credentials into the same shared file/preference as the outbound autofill mirror (`NativeCredentialStore`). When the app unlocks, outbound sync clobbers inbound saves. Inbound saves must reside in an independent `NativePendingStore` that can only be cleared once the encrypted vault has confirmed ingestion.
3. **Severe Bitmask Logic Flaw in `NexVaultAutofillService.java`**:
   In lines 347 and 633:
   ```java
   if (variation == 0x80 || variation == 0x90 || variation == 0xe0 || variation == 0x10 || (inputType & 0x00000081) != 0) { ... }
   ```
   Bit 0 is `InputType.TYPE_CLASS_TEXT = 1`. The expression `(inputType & 0x00000081) != 0` evaluates to `true` for **every single normal text field** in Android! This causes usernames, emails, and plain inputs to be detected as password fields, clearing `values.username` and corrupting or dropping username data during `onSaveRequest`.
4. **Stem Collision in `onSaveRequest`**: `matches(cleanDomain, candidate.optString("service"))` uses loose substring/stem matching. If a service name matches any segment of an existing entry, it mutates that entry in place instead of creating the 316th item.

### 2.2 Bloated Release Pipeline & `package.json`
`package.json` currently contains redundant, overlapping scripts (`release:publish`, `release:upload`, `release:builds`, `publish:builds`, `cap:sync`, `mobile:sync`, `ext:chrome`, etc.). The release workflow requires memorizing multiple steps rather than relying on one deterministic command.

### 2.3 Material Design 3 Flagship Status
The app currently has a dark cyber glassmorphism foundation with partial M3 tokens, but lacks standard Google Material Design 3 Expressive components: adaptive Top App Bar, M3 Floating Search Bar, segmented filter chips, M3 Card tonal elevation layers, animated circular 2FA progress timers, full M3 Bottom Navigation pills, and Material You Bottom Sheet detail dialogs.

---

## 3. Architecture & Proposed Approach

1. **Autofill Native Pending Queue Architecture**:
   - Introduce `NativePendingCredentialStore` in Android (`apps/mobile/android/app/src/main/java/com/nexvault/app/NativeCredentialStore.java`).
   - When Android OS calls `onSaveRequest()`, write the captured credential into `NativePendingCredentialStore` AND update `NativeCredentialStore`.
   - Expose `readPendingCredentials` and `clearPendingCredentials` in `AutofillBridgePlugin.java`.
   - In `apps/mobile/src/mobileVault.ts` and `apps/mobile/src/index.tsx`, invert calling order: ALWAYS invoke `mergeNativeAutofillCredentials()` *before* syncing out, ingest from both pending and active stores, persist to encrypted `localStorage`, and acknowledge via `clearPendingCredentials()`.
   - Fix the bitmask bug in `NexVaultAutofillService.java` to evaluate only genuine password variations.

2. **Unified Release Orchestrator CLI (`scripts/release.mjs`)**:
   - Single entry point: `npm run release [patch|minor|major|<version>] [flags]`.
   - Flags:
     - `--upload`: Build, package, commit, tag, push, and immediately upload binary assets (`.apk`, `.AppImage`, `release-info.json`) to GitHub Releases.
     - `--upload-only`: Skip compilation and git; upload existing `./release/` artifacts directly to the current release tag.
     - `--target=<all|mobile|desktop>`: Target specific platforms without recompiling unneeded targets.
     - `--dry-run`: Preview version bumps and steps without mutating git or files.
     - `--no-build`: Bump and push only for remote CI runners.
   - Clean `package.json` scripts down to essentials.

3. **Google Material Design 3 (M3 Expressive) Flagship UI**:
   - Implement M3 semantic tonal surfaces (`--nv-surface-container`, `--nv-surface-container-high`), Google Sans/Roboto typography hierarchy, and shape tokens.
   - Design and build:
     - M3 Top App Bar with title, connection status chip, search toggle, and sync action.
     - M3 Pill Search & Filter Bar with horizontal Category Chips (Logins, 2FA, Secure Notes, Favorites).
     - M3 Interactive Credential Cards with tactile ripple press feedback and monospaced previews.
     - M3 2FA Authenticator with grouped 6-digit typography (`123 456`) and dynamic SVG circular countdown timers (green/amber/red).
     - M3 Extended FAB / Speed Dial for adding credentials and scanning QR codes.
     - M3 Bottom Navigation Bar with active indicator pills.
     - M3 Bottom Sheet dialog for full credential detail view and edit actions.

---

## 4. Step-by-Step Implementation Tasks

### Task 1: Fix Android Bitmask Detection & Create Native Pending Credential Queue
**Estimated Time**: 5 minutes  
**Files**:
- `/home/youssef/projects/nextvault/apps/mobile/android/app/src/main/java/com/nexvault/app/NativeCredentialStore.java`
- `/home/youssef/projects/nextvault/apps/mobile/android/app/src/main/java/com/nexvault/app/AutofillBridgePlugin.java`
- `/home/youssef/projects/nextvault/apps/mobile/android/app/src/main/java/com/nexvault/app/NexVaultAutofillService.java`

#### Detailed Changes:
1. In `NativeCredentialStore.java`:
   Add encrypted storage methods for `pending_credentials`:
   ```java
   private static final String PENDING_DATA = "pending_credentials";

   static void writePending(Context context, String value) throws Exception {
       writeKeyed(context, PENDING_DATA, value);
   }

   static String readPending(Context context) {
       return readKeyed(context, PENDING_DATA);
   }

   static void clearPending(Context context) {
       context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
           .edit().remove(PENDING_DATA).apply();
   }
   ```
2. In `AutofillBridgePlugin.java`:
   Add `@PluginMethod public void readPendingCredentials(PluginCall call)` and `@PluginMethod public void clearPendingCredentials(PluginCall call)`.
3. In `NexVaultAutofillService.java`:
   - Replace flawed `(inputType & 0x00000081) != 0` with exact password check:
     ```java
     boolean isPasswordVariation = (variation == 0x80 || variation == 0x90 || variation == 0xe0 || variation == 0x10);
     if (isPasswordVariation) isPassword = true;
     ```
   - In `onSaveRequest`:
     Read pending queue:
     ```java
     JSONArray pending = new JSONArray(NativeCredentialStore.readPending(this));
     // append or update new credential in pending
     pending.put(entry);
     NativeCredentialStore.writePending(this, pending.toString());
     // Also update active cache for immediate filling
     NativeCredentialStore.write(this, credentials.toString());
     ```
     Ensure domain matching matches exact service or exact domain, not ambiguous partial substrings.

#### Verification:
```bash
cd /home/youssef/projects/nextvault/apps/mobile/android
./gradlew compileDebugJavaWithJavac
```
Expected output: `BUILD SUCCESSFUL`.

---

### Task 2: Fix TypeScript Credential Ingestion & Calling Order
**Estimated Time**: 4 minutes  
**Files**:
- `/home/youssef/projects/nextvault/apps/mobile/src/mobileVault.ts`
- `/home/youssef/projects/nextvault/apps/mobile/src/index.tsx`

#### Detailed Changes:
1. In `apps/mobile/src/mobileVault.ts`:
   Update `AutofillBridgePlugin` interface with `readPendingCredentials` and `clearPendingCredentials`.
   In `mergeNativeAutofillCredentials()`:
   ```ts
   export async function mergeNativeAutofillCredentials() {
     if (typeof window === 'undefined' || (window as any).Capacitor?.getPlatform?.() !== 'android') return;
     let pendingResult: any;
     try {
       pendingResult = await AutofillBridge.readPendingCredentials?.();
     } catch {}
     let activeResult: any;
     try {
       activeResult = await AutofillBridge.readCredentials();
     } catch {}

     const pendingList = JSON.parse(pendingResult?.credentialsJson || '[]');
     const activeList = JSON.parse(activeResult?.credentialsJson || '[]');
     const incoming = [...pendingList, ...activeList];
     const state = loadVault();
     if (!state || !incoming.length) return;

     let changed = false;
     for (const item of incoming) {
       const service = String(item.service || item.rawService || '').trim();
       const password = String(item.password || item.credential || '');
       if (!service || !password) continue;
       const username = String(item.username || '');
       
       const existingIdx = state.passwords.findIndex(p => 
         normalizeDomain(p.service) === normalizeDomain(service) &&
         (!username || !p.username || p.username.toLowerCase() === username.toLowerCase())
       );

       if (existingIdx >= 0) {
         const existing = state.passwords[existingIdx];
         if (existing.credential !== password || (username && existing.username !== username)) {
           existing.credential = password;
           if (username) existing.username = username;
           existing.updatedAt = Date.now();
           existing.logicalCounter = (existing.logicalCounter || 0) + 1;
           changed = true;
         }
       } else {
         state.passwords.push({
           service,
           credential: password,
           username,
           createdAt: new Date().toISOString(),
           updatedAt: Date.now(),
           logicalCounter: 1,
           peerId: state.devicePublicKey
         });
         changed = true;
       }
     }

     if (changed) {
       saveVault(state);
       notifyVaultUpdated();
     }
     // Acknowledge pending store
     try {
       await AutofillBridge.clearPendingCredentials?.();
     } catch {}
   }
   ```
2. In `unlockEnvelope()`:
   **CRITICAL FIX**: Move `mergeNativeAutofillCredentials()` BEFORE `syncAutofillCredentials(cachedState)`:
   ```ts
   cachedState = JSON.parse(naclUtil.encodeUTF8(plain));
   touchOfflineHeartbeat();
   await mergeNativeAutofillCredentials();
   syncAutofillCredentials(cachedState);
   return cachedState as MobileVaultState;
   ```
3. In `apps/mobile/src/index.tsx`:
   In `onExistingUser()` and visibility handler:
   Run `await mergeNativeAutofillCredentials()` FIRST, then `syncAutofillCredentials()`.

#### Verification:
```bash
npm --prefix /home/youssef/projects/nextvault/apps/mobile run build
npm test
```
Expected output: Vite compile succeeded, all test suites passed.

---

### Task 3: Unit Test for Inbound Credential Merge & Anti-Regression
**Estimated Time**: 3 minutes  
**Files**:
- `/home/youssef/projects/nextvault/packages/core/test/credentialMerge.test.js`

#### Detailed Changes:
Write a unit test testing domain normalization, username disambiguation, and non-clobbering merge behavior when ingesting external native credentials into a 315-credential vault state. Verify count increases to 316 and duplicates with different usernames create separate accounts.

#### Verification:
```bash
npm run test:core
```
Expected output: All test suites passed including `credentialMerge.test.js`.

---

### Task 4: Unified Release Command with `--upload` & Flag Support
**Estimated Time**: 5 minutes  
**Files**:
- `/home/youssef/projects/nextvault/scripts/release.mjs`

#### Detailed Changes:
1. Update CLI flag parsing in `scripts/release.mjs`:
   - Support `npm run release` -> Default complete release (pre-flight tests, bump, desktop build, mobile build, publish manifest, website build, commit, tag, push, upload if token present).
   - Support `--upload` -> Enforce upload to GitHub Releases. If token is missing, exit with clear actionable instructions.
   - Support `--upload-only` -> Skip build and git; immediately upload pre-existing `./release/` binaries to the active tag.
   - Support `--target=<all|mobile|desktop>`.
   - Support `--dry-run`, `--no-build`, `--no-push`, `--verify <tag>`.
2. Enhance token resolution: check `process.env.GITHUB_TOKEN`, `process.env.GH_TOKEN`, and `.env.dev` / `.env` safely.
3. Provide crystal-clear console progress summary with emojis and elapsed time.

#### Verification:
```bash
node /home/youssef/projects/nextvault/scripts/release.mjs --dry-run --allow-dirty
node /home/youssef/projects/nextvault/scripts/release.mjs --verify v0.1.48
```
Expected output: Dry run succeeds cleanly; verification confirms all manifests match `v0.1.48`.

---

### Task 5: Clean `package.json` Scripts
**Estimated Time**: 2 minutes  
**Files**:
- `/home/youssef/projects/nextvault/package.json`

#### Detailed Changes:
Remove duplicated, confusing scripts:
- Delete: `release:fetch`, `release:manifest`, `release:publish`, `release:upload`, `release:builds`, `release:ci`, `publish:builds`, `build:all`, `cap:sync`, `cap:open`, `cap:run`, `ext:chrome`, `ext:firefox`, `pack:ext:firefox`.
- Standardize minimal root scripts:
  ```json
  "scripts": {
    "start": "npm run start:website",
    "build": "npm run sync:assets && npm run sync:core && npm --prefix apps/website run build",
    "test": "npm run test:core && npm run test:relay",
    "test:core": "npm --prefix packages/core test",
    "test:relay": "npm --prefix apps/relay test",
    "dev:desktop": "npm --prefix apps/desktop run start",
    "build:desktop": "npm run sync:assets && npm run sync:core && npm --prefix apps/desktop run build",
    "dev:mobile": "npm --prefix apps/mobile run start",
    "build:mobile": "node scripts/build-mobile-android.mjs",
    "dev:relay": "npm --prefix apps/relay run start",
    "build:relay": "npm --prefix apps/relay run build",
    "dev:website": "npm --prefix apps/website run dev",
    "sync:assets": "node scripts/sync-assets.mjs",
    "sync:core": "node scripts/sync-core.mjs",
    "extension:chrome": "cp apps/extension/src/manifest.chrome.json apps/extension/src/manifest.json",
    "extension:firefox": "cp apps/extension/src/manifest.firefox.json apps/extension/src/manifest.json",
    "release": "node scripts/release.mjs"
  }
  ```

#### Verification:
```bash
npm run test
npm run build
```
Expected output: Scripts execute cleanly without missing dependency warnings.

---

### Task 6: Google Material Design 3 (M3 Expressive) Flagship UI Overhaul
**Estimated Time**: 7 minutes  
**Files**:
- `/home/youssef/projects/nextvault/apps/mobile/src/cyber/cyber.css`
- `/home/youssef/projects/nextvault/apps/mobile/src/main.css`
- `/home/youssef/projects/nextvault/apps/mobile/src/index.tsx`

#### Detailed Changes:
1. **Design Tokens (`cyber.css`)**:
   - Establish complete M3 tonal elevation containers:
     `--nv-surface-dim: #070a12`, `--nv-surface: #0c1220`, `--nv-surface-container-low: #101828`, `--nv-surface-container: #141f34`, `--nv-surface-container-high: #1a2742`, `--nv-surface-container-highest: #223254`.
   - M3 Expressive emerald mint primary (`#00E599`) and electric cyan secondary (`#00D4FF`).
   - M3 standard shape radii: pill (`9999px`), extra-large (`28px`), large (`20px`), medium (`16px`), small (`10px`).
2. **Flagship M3 App Bar & Search Experience**:
   - M3 Large/Medium Top App Bar with glassmorphism blur (`backdrop-filter: blur(20px)`), brand mark, status indicator badge, search toggle button, and fast mesh sync icon.
   - M3 Pill Search Bar: Elevated container, search icon, instant clear button, credential filter count.
   - M3 Filter Chips: Segmented category chips (All, Logins, 2FA, Secure Notes, Favorites) with smooth horizontal scrolling and selected pill styling.
3. **M3 Interactive Credential Cards**:
   - High-contrast typography with monospaced username and hidden password preview.
   - Quick 1-tap copy buttons with animated haptic micro-state (`Copied!`).
   - Double-bezel rounded service badge with domain-derived favicon / monogram.
4. **M3 2FA Authenticator Screen**:
   - Google Authenticator flagship styling: high-contrast grouped digits (`123 456`) in clean tabular font.
   - Dynamic SVG countdown progress ring (green >10s, orange 5-10s, red <5s).
   - 1-tap copy action on the entire card.
5. **M3 Bottom Navigation Bar**:
   - 3 destinations: Vault (Logins), 2FA Authenticator, P2P Mesh Network.
   - Active indicator pill container (`width: 64px`, `height: 32px`, rounded pill background with icon and label below).
6. **M3 Extended FAB & Speed Dial**:
   - Prominent pill Floating Action Button with spring physics.
   - Expands into Speed Dial: "+ New Password", "+ New 2FA Key", "Scan QR Code".
7. **M3 Bottom Sheet Detail Modal**:
   - Draggable handle, large title, view/reveal password toggle, copy actions, audit metadata (creation time, logical counter), edit and delete options.

#### Verification:
```bash
npm --prefix /home/youssef/projects/nextvault/apps/mobile run build
node /home/youssef/projects/nextvault/scripts/sync-assets.mjs
```
Expected output: Vite compilation succeeded without CSS/JSX errors.

---

### Task 7: End-to-End Build & Android APK Assembly
**Estimated Time**: 4 minutes  
**Files**:
- Executed on whole monorepo

#### Verification:
```bash
npm test
node /home/youssef/projects/nextvault/scripts/build-mobile-android.mjs
node /home/youssef/projects/nextvault/scripts/release.mjs --dry-run --allow-dirty
```
Expected output:
- Core and Relay tests: 100% passed.
- Android APK compiled and assembled into `/home/youssef/projects/nextvault/release/NexVault-v0.1.48-android.apk`.
- Release script dry-run succeeds with zero errors.

---

### Task 8: Update Obsidian Canonical Project Documentation
**Estimated Time**: 2 minutes  
**Files**:
- `/home/youssef/Documents/DEV Assistance Memory/Projects/NextVault/04_Append_Log.md`

#### Detailed Changes:
Append structured entry documenting:
- Root cause and resolution of 315 credential autofill persistence defect.
- Unified release orchestrator CLI flags and package.json cleanup.
- Material Design 3 Expressive flagship UI implementation.

---

## 5. Tests & Validation Plan (TDD & Verification)

1. **Unit Tests**:
   - Run `npm run test:core` to verify all cryptographic and replica logic passes.
   - Run `packages/core/test/credentialMerge.test.js` to verify inbound autofill credential deduplication and preservation.
2. **Android Native Build Test**:
   - Run `./gradlew compileDebugJavaWithJavac` in `apps/mobile/android`.
   - Run `node scripts/build-mobile-android.mjs` to ensure the final signed APK packages successfully.
3. **Web & UI Build Test**:
   - Run `npm --prefix apps/mobile run build` (Vite).
   - Run `npm --prefix apps/website run build` (Vite).
4. **Release Orchestrator Verification**:
   - Run `node scripts/release.mjs --dry-run --allow-dirty` to verify all 6 release stages simulate cleanly.
   - Run `node scripts/release.mjs --verify v0.1.48` to verify JSON version integrity.

---

## 6. Risks, Tradeoffs & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Android IPC latency**: Bridge call to read pending credentials takes >50ms | Screen render delay on app open | Execute `mergeNativeAutofillCredentials()` asynchronously in the background on app start and focus, then seamlessly refresh UI state via `notifyVaultUpdated()`. |
| **Release upload without token**: Running `npm run release -- --upload` in an environment without `GITHUB_TOKEN` | Release stalls or fails at step 6 | Provide clear warning before push: read token from `.env.dev` if present; if absent, print explicit instructions on how to run `node scripts/upload-release.mjs` with a token. |
| **Custom CSS collisions with desktop**: Mobile cyber styling bleeding into desktop Electron view | Broken desktop styling | Keep mobile-specific classes isolated under `.nv-mobile-*` or within `apps/mobile/src/main.css`, while shared tokens remain semantic in `cyber.css`. |

---
*Plan authored under `.hermes/plans/2026-11-25_095842-flagship-material-unified-release-autofill-fix.md`.*
