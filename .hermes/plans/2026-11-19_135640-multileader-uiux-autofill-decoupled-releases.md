# Plan: NexVault Multi-Leader All-to-All Mesh, Luxury UI/UX Overhaul, Targeted Autofill, Custom Launcher Icon & Decoupled Platform Releases

**Date**: 2026-11-19  
**Target File**: `.hermes/plans/2026-11-19_135640-multileader-uiux-autofill-decoupled-releases.md`  
**Workspace**: `/home/youssef/projects/nextvault`

---

## 1. Goal
Transform NexVault into a true All-to-All multi-leader replica mesh where every device operates as an autonomous leader storing data locally, completely overhaul the Desktop and Mobile UI/UX to a unified luxury obsidian aesthetic, eliminate false-positive autofill triggers on search inputs while elevating suggestion presentation to Google/1Password luxury quality, install a custom brand launcher icon for Mobile, and decouple Desktop and Mobile release pipelines so versions and updates advance independently.

---

## 2. Current Context & Assumptions
- **Core Replication**: Current synchronization in `packages/core/grid.js`, `apps/desktop/src/main.js`, and `apps/mobile/src/mobileVault.ts` relies on ad-hoc `vault-sync` messages with basic LWW timestamps, but lacks a formal all-to-all multi-leader CRDT structure, unified vector clocks/digests, and full-mesh delta propagation.
- **UI/UX Disorganization**: Mobile has 6 disjointed tabs (`quick-fill`, `vault`, `otp`, `grid`, `security`, `settings`), and Desktop has separate `vault` and `otp` pages. Passwords and OTPs are segregated into disconnected silos; screens suffer from repetitive controls, terminal logs, and distracting CRT scanline/flicker effects.
- **Autofill / Accessibility Intrusion**: In `NexVaultAccessibilityService.java`, `isUsernameNode()` probes `node.getText()`, matching user query strings typed into search bars. Search widgets (`SearchView`, `search_box`, `filter_box`) trigger "Generate Strong Password" overlays or false-positive save popups in `NexVaultAutofillService.java`. Overlays are visually intrusive rather than sleek and discreet.
- **Mobile Launcher Icon**: Android launcher currently uses default white background (`#FFFFFF`) with Android robot vector in `drawable-v24/ic_launcher_foreground.xml` and stock placeholder PNGs.
- **Coupled Release Pipeline**: `scripts/release.mjs` bumps all packages simultaneously in lockstep. Updating Mobile bumps Desktop and vice versa, triggering update notifications on platforms whose binaries didn't change.

---

## 3. Architecture & Proposed Approach
1. **Multi-Leader All-to-All Replica Model**:
   - Every node (Desktop, Mobile, Tablet) is an autonomous Leader with a local encrypted store (SQLCipher on Desktop, TweetNaCl Secretbox on Mobile).
   - Data records are unified into a canonical item structure: `{ id, service, username, password, otpSecret, notes, logicalClock: { counter, peerId }, version, isDeleted, deletedAt }`.
   - All-to-All Full Mesh: Discovery via zero-knowledge relay brokers direct WebRTC data channels between all peer pairs with encrypted envelope fallback.
   - Anti-Entropy & CRDT Conflict Resolution: State-based LWW-Element-Set ordered by **Lamport Logical Clocks `(counter, peerId)`** instead of fragile physical timestamps:
     - Every local write increments the monotonic counter: `counter = Math.max(existingCounter, localClock) + 1`.
     - Upon receiving updates from peers, the node advances its local clock: `localClock = Math.max(localClock, remoteCounter)`.
     - Conflict resolution: Higher `counter` wins. If equal (concurrent writes), deterministic tie-break using lexicographical comparison of `peerId`.
     - Immunity to clock skew: Completely immune to system time changes, NTP adjustments, or backward clock jumps.
     - Local writes immediately fan out signed encrypted deltas to all peers in the mesh.
2. **Luxury Obsidian Design System**:
   - Unified Credential Architecture: One item holds credentials and TOTP authenticator with dynamic circular countdown ring and 1-click copy feedback.
   - Streamlined IA: Mobile condensed to 3 primary tabs (**Vault**, **Mesh & Devices**, **Security & Settings**). Desktop transformed into a polished Master-Detail interface with category filters (All, Logins, 2FA, Favorites) and zero cheesy CRT effects.
   - Visual Tokens: Obsidian graphite surface (`#07090E`, `#0F1420`), 1px frosted borders (`rgba(255,255,255,0.08)`), subtle emerald (`#00E599`) and cyan (`#00C8FF`) accents.
3. **Precision Autofill & Non-Intrusive Presentation**:
   - Hardened Detection: Strict exclusion of `SearchView`, `search_box`, `query`, `search_src_text`, `TYPE_TEXT_VARIATION_FILTER`, `TYPE_TEXT_VARIATION_WEB_SEARCH_RESULT`, and `IME_ACTION_SEARCH`.
   - Never probe `node.getText()` for credential classification. Only trigger on genuine password fields, explicit `autocomplete` hints, or authenticated form structures.
   - Luxury Dataset & Floating Pill: Minimalist dark glassmorphic pill, high-res shield badge, discrete subtitle, smooth fade, and zero UI interference.
4. **Custom Mobile Launcher Icon**:
   - Obsidian dark background (`#0A0E1A`), geometric faceted NexVault cyber shield in vector XML, and regenerated mipmap PNG assets.
5. **Decoupled Release & Update Pipeline**:
   - `scripts/release.mjs --target=[mobile|desktop|all]`: selective bumps for `apps/mobile` or `apps/desktop`.
   - `release-info.json` schema extended with `desktop.version` and `mobile.version`.
   - Updaters (`updater.ts` and `main.js`) check their specific platform version against the manifest.

---

## 4. Step-by-Step Implementation Tasks

### Phase A: Multi-Leader All-to-All Replica Engine

#### Task A.1: Create Core Multi-Leader CRDT Replication Module
- **File**: `packages/core/multiLeaderReplica.js`
- **Action**: Implement pure multi-leader LWW-Element-Set reconciliation engine with version vectors, tombstone handling, and delta computation.
- **Key Methods**:
  - `computeDigest(records, tombstones)`: Generates compact `{ [id]: { updatedAt, version, isDeleted } }` map.
  - `reconcile(localState, remoteState)`: Computes winning state using deterministic LWW (`remote.updatedAt > local.updatedAt` or tie-break `remote.originPeerId > local.originPeerId`).
  - `createDelta(localState, peerDigest)`: Computes missing or newer items to send to a specific peer.
- **Verification Command**:
  ```bash
  NODE_PATH=../../apps/desktop/node_modules npm exec --prefix ../.. -- jest packages/core/test/multiLeaderReplica.test.js
  ```
- **Expected Output**: `PASS test/multiLeaderReplica.test.js`

#### Task A.2: Write Unit Tests for Multi-Leader Replica Engine
- **File**: `packages/core/test/multiLeaderReplica.test.js`
- **Tests**:
  1. Local write is immediately applied and stamped with `originPeerId` and monotonic `updatedAt`.
  2. Concurrent edits on two independent leaders resolve deterministically using LWW and origin tie-breaking.
  3. Deletions create tombstones that replicate and suppress older writes across all peers.
  4. New peer receives complete delta from existing leaders upon initial connection.
- **Verification Command**:
  ```bash
  npm run test:core
  ```
- **Expected Output**: All tests pass including `multiLeaderReplica.test.js`.

#### Task A.3: Upgrade Desktop SQLite Schema for Multi-Leader Records
- **File**: `packages/core/database.js`
- **Changes**:
  - Add `id` (UUID text primary key), `updated_at` (INTEGER), `origin_peer_id` (TEXT), `version` (INTEGER), `is_deleted` (INTEGER), `deleted_at` (INTEGER), and `otp_secret` directly to credentials table.
  - Add migration path for existing database rows (`nexvault.db`).
  - Add `getSyncDigest(userId)` and `applyReconciledDelta(userId, delta)` methods.
- **Verification Command**:
  ```bash
  npm run test:core
  ```
- **Expected Output**: `PASS test/database.test.js`

#### Task A.4: Integrate All-to-All Mesh Sync in Desktop Main Process
- **File**: `apps/desktop/src/main.js`
- **Changes**:
  - Update `NexGrid` handlers to exchange `sync-digest` upon peer connection.
  - Reconcile incoming deltas through `multiLeaderReplica.reconcile`.
  - When a user adds/edits/deletes any credential on Desktop, immediately broadcast `vault-delta` to all active peers in `nexGrid.peers`.
- **Verification Command**:
  ```bash
  npm run test:core && npm run test:relay
  ```
- **Expected Output**: All test suites pass.

#### Task A.5: Upgrade Mobile Local Vault for Multi-Leader CRDT
- **File**: `apps/mobile/src/mobileVault.ts`
- **Changes**:
  - Add `originPeerId`, `version`, `isDeleted`, `deletedAt` to `StoredCredential`.
  - Integrate unified item storage (linking OTP secret directly inside credential).
  - Implement `syncDigest` exchange and delta broadcast over WebRTC / WebSocket relay.
- **Verification Command**:
  ```bash
  npm --prefix apps/mobile run build
  ```
- **Expected Output**: Clean Vite build with zero TypeScript errors.

---

### Phase B: Mobile & Desktop Luxury UI/UX Overhaul

#### Task B.1: Luxury Obsidian Cyber Theme Tokens & Base CSS
- **Files**: `packages/assets/cyber.css`, `apps/desktop/src/cyber/cyber.css`, `apps/mobile/src/cyber/cyber.css`
- **Changes**:
  - Replace harsh, blurry CRT scanlines (`.nv-scanlines`) and distracting flickers (`.nv-flicker`) with clean, high-end obsidian tokens.
  - Surface hierarchy: `--nv-bg: #07090E`, `--nv-surface: #0E131F`, `--nv-surface-hover: #161D2E`, `--nv-border: rgba(255,255,255,0.08)`, `--nv-border-focus: #00E599`.
  - Luxury button and card components: Subtle frosted glass (`backdrop-filter: blur(16px)`), micro-interactions, clean font weights, smooth cubic-bezier transitions.
- **Verification Command**:
  ```bash
  npm run sync:assets
  ```
- **Expected Output**: `synced -> apps/desktop/src/cyber`, `synced -> apps/mobile/src/cyber`

#### Task B.2: Overhaul Desktop App UI/UX to Unified Master-Detail View
- **Files**: `apps/desktop/src/index.html`, `apps/desktop/src/renderer.js`
- **Changes**:
  - Reorganize Information Architecture:
    - Eliminate separate "OTP" and "Vault" pages. Merge them into a single **Vault** workspace.
    - Category pills on top: `All Items`, `Logins`, `Authenticators (2FA)`, `Favorites`.
    - Split-pane Master-Detail layout:
      - Left pane: Instant search bar, filter tags, list of items with domain favicon/initials, service name, username, and active 2FA badge.
      - Right pane: Selected item detail view. Direct 1-click copy with animated checkmark feedback (`Copied!`), password reveal toggle, live circular TOTP countdown ring with dynamic 6-digit code, metadata (last synced, origin device), and edit/delete actions.
  - Simplify navigation sidebar to 3 core views: **Vault**, **Mesh Network** (Peers & Devices), **Security Settings** (Lockdown, Auto-lock, Updates).
  - Polish modals (Add Item, Pair Device) into clean, focused dark overlays.
- **Verification Command**:
  ```bash
  npm run build:desktop
  ```
- **Expected Output**: Desktop packages build without syntax or bundling errors.

#### Task B.3: Streamline Mobile UI/UX to 3 Luxury Tabs & Unified Credentials
- **File**: `apps/mobile/src/index.tsx`
- **Changes**:
  - Reduce bottom navigation from 6 confusing tabs down to 3 intuitive luxury tabs:
    1. **Vault**: Search bar, category filters (`All`, `Logins`, `2FA`), unified credential cards (showing username and live TOTP token in one card), floating `+` action button.
    2. **Mesh & Devices**: Visual topology of connected peer leaders, one-tap QR / 6-digit code pairing, sync status badge.
    3. **Security & Settings**: Biometrics toggle, auto-lock timeout selector (1m, 5m, 15m, Never), dead man's switch countdown, update checker, emergency nuke button.
  - Bottom sheet for item creation & inspection:
    - Fields: Service Name, Website URL, Username/Email, Password (with integrated generator slider), OTP Secret (with QR code scanner trigger).
  - Micro-animations: Smooth accordion or slide transitions, haptic feedback on copy.
- **Verification Command**:
  ```bash
  npm --prefix apps/mobile run build
  ```
- **Expected Output**: Vite build passes cleanly.

---

### Phase C: Precision Autofill & Elimination of Search Field Interference

#### Task C.1: Harden Android Accessibility Service Against Search Inputs
- **File**: `apps/mobile/android/app/src/main/java/com/nexvault/app/NexVaultAccessibilityService.java`
- **Changes**:
  - Create strict negative filter `isSearchOrNonCredentialNode(node)`:
    - Check node class: `android.widget.SearchView`, `androidx.appcompat.widget.SearchView`, `android.widget.AutoCompleteTextView` inside search containers.
    - Check view ID and resource name for: `search`, `search_src_text`, `search_bar`, `search_box`, `query`, `filter_box`, `find_in_page`, `omnibox`, `url_bar`.
    - Check `node.getInputType()`: reject `TYPE_TEXT_VARIATION_FILTER`, `TYPE_TEXT_VARIATION_WEB_SEARCH_RESULT`.
    - Check IME options: reject `EditorInfo.IME_ACTION_SEARCH`, `IME_ACTION_GO` where input is single-line search.
  - Remove `node.getText()` from `getNodeProbe(node)` when identifying usernames to ensure user queries never misclassify the field as a username.
  - Require credential coupling: Only show autofill overlay if the active window has a verified password field, OR if the input explicitly has `autocomplete="username"` / `type="email"` in an authentication form.
  - Prevent "⚡ Generate Strong Password" overlay from appearing unless the field is conclusively an editable password field on an account creation or registration screen.
- **Verification Command**:
  ```bash
  node scripts/build-mobile-android.mjs
  ```
- **Expected Output**: Gradle assembleDebug succeeds.

#### Task C.2: Harden Android Autofill Service on Save & Fill Requests
- **File**: `apps/mobile/android/app/src/main/java/com/nexvault/app/NexVaultAutofillService.java`
- **Changes**:
  - In `collectSavedValues`: strictly ignore any node matching search patterns (`search_box`, `query`, `filter`, `search_src_text`).
  - In `onSaveRequest`: abort save prompt immediately if no actual non-empty password was submitted or if the form lacked a password field.
  - In `onFillRequest`: never attach `SaveInfo` or suggestion datasets to search inputs or isolated text boxes outside of login/signup forms.
- **Verification Command**:
  ```bash
  node scripts/build-mobile-android.mjs
  ```
- **Expected Output**: Gradle assembleDebug succeeds.

#### Task C.3: Luxury Redesign of Android Autofill UI & Floating Overlay
- **Files**:
  - `apps/mobile/android/app/src/main/res/layout/autofill_dataset.xml`
  - `apps/mobile/android/app/src/main/res/layout/autofill_overlay_pill.xml`
  - `apps/mobile/android/app/src/main/res/drawable/autofill_dataset_background.xml`
  - `apps/mobile/android/app/src/main/res/drawable/overlay_pill_background.xml`
- **Changes**:
  - Style dataset item like Google Password Manager:
    - Minimalist rounded card (`14dp` corner radius, background `#121826`, 1px border `#232D42`).
    - Crisp high-res shield emblem, service title in 14sp `#F8FAFC`, username in 12sp `#94A3B8`.
  - Redesign floating accessibility pill:
    - Compact, discreet luxury pill (`height: 38dp`, background `#0E1422` with 1px border `rgba(0, 229, 153, 0.4)`).
    - Smooth touch target, quick tap to fill, clean swipe-to-dismiss without blocking keyboard or search bars.
- **Verification Command**:
  ```bash
  node scripts/build-mobile-android.mjs
  ```
- **Expected Output**: Android build succeeds.

#### Task C.4: Elevate Browser Extension In-Field Autofill UX
- **File**: `apps/extension/src/content.js`
- **Changes**:
  - Strict search filter: Skip inputs where `type="search"` or where `name`/`id`/`placeholder`/`aria-label` contains `search|query|filter|find`.
  - Elevate floating dropdown styling: Replace neon green glow with refined luxury obsidian palette (`#0B0F19`), 1px frosted border (`rgba(255,255,255,0.12)`), subtle elevation shadow (`0 20px 40px rgba(0,0,0,0.6)`), and discreet shield icon.
- **Verification Command**:
  ```bash
  npm run build:website
  ```
- **Expected Output**: Build passes cleanly.

---

### Phase D: Custom Mobile Launcher Icon

#### Task D.1: Replace Android Adaptive Icon Background & Foreground Vector
- **Files**:
  - `apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml`
  - `apps/mobile/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml`
- **Changes**:
  - Set `ic_launcher_background` to `#0A0E1A` (deep luxury obsidian).
  - Replace the stock Android robot vector in `ic_launcher_foreground.xml` with the custom NexVault geometric cryptographic shield featuring emerald (`#00E599`) and sapphire (`#00C8FF`) gradient facets and a central vault lock keyhole.
- **Verification Command**:
  ```bash
  node scripts/build-mobile-android.mjs
  ```
- **Expected Output**: Gradle assembleDebug succeeds.

#### Task D.2: Regenerate Legacy Raster Mipmap PNGs
- **Files**:
  - `apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher*.png` (48x48)
  - `apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher*.png` (72x72)
  - `apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher*.png` (96x96)
  - `apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher*.png` (144x144)
  - `apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher*.png` (192x192)
- **Changes**:
  - Generate crisp PNG assets from the NexVault luxury shield vector for square and round launcher icons so all launchers show the custom icon.
- **Verification Command**:
  ```bash
  node scripts/build-mobile-android.mjs
  ```
- **Expected Output**: APK builds and packages the new mipmaps without error.

---

### Phase E: Decouple Desktop & Mobile Releases

#### Task E.1: Enhance Release Common Library for Selective Targets
- **File**: `scripts/lib/release-common.mjs`
- **Changes**:
  - Add schema v3 support for `release-info.json`:
    ```json
    {
      "schemaVersion": 3,
      "version": "0.1.44",
      "desktop": { "version": "0.1.44", "tag": "v0.1.44-desktop", ... },
      "mobile": { "version": "0.1.45", "tag": "v0.1.45-mobile", "versionCode": 101045, ... }
    }
    ```
  - Define file sets per target:
    - `TARGET_FILES.desktop`: `apps/desktop/package.json`, `apps/desktop/package-lock.json`
    - `TARGET_FILES.mobile`: `apps/mobile/package.json`, `apps/mobile/package-lock.json`, Android gradle `versionCode`
    - `TARGET_FILES.core`: `packages/core/package.json`, `packages/core/package-lock.json`
    - `TARGET_FILES.all`: all files
- **Verification Command**:
  ```bash
  node -e "import('./scripts/lib/release-common.mjs').then(m => console.log('Parsed successfully'))"
  ```
- **Expected Output**: `Parsed successfully`

#### Task E.2: Update Release Script for Independent Target Bumping
- **File**: `scripts/release.mjs`
- **Changes**:
  - Parse `--target=mobile`, `--target=desktop`, `--target=all` (default: all).
  - When `--target=mobile`: only bump mobile version files, create tag `vX.Y.Z-mobile`, and skip desktop rebuilds.
  - When `--target=desktop`: only bump desktop version files, create tag `vX.Y.Z-desktop`, and skip mobile rebuilds.
  - Support dry-run verification for selective targets: `npm run release -- patch --target=mobile --dry-run`.
- **Verification Command**:
  ```bash
  node scripts/release.mjs --patch --target=mobile --dry-run
  ```
- **Expected Output**: Reports selective file bump for `apps/mobile` only.

#### Task E.3: Decouple In-App Updaters on Mobile and Desktop
- **Files**:
  - `apps/mobile/src/updater.ts`
  - `apps/desktop/src/main.js`
- **Changes**:
  - In `updater.ts`: Read `manifest.mobile?.version || manifest.version`. If only Desktop bumped (e.g. `desktop: 0.1.45`, `mobile: 0.1.44`), Mobile does NOT trigger an update alert.
  - In `main.js`: Read `manifest.desktop?.version || manifest.version`. If only Mobile bumped, Desktop does NOT trigger an update alert.
- **Verification Command**:
  ```bash
  npm run test:core && npm run test:relay
  ```
- **Expected Output**: All unit tests pass.

---

## 5. Verification & Acceptance Criteria
1. **Multi-Leader Replication**:
   - `npm run test:core` passes with 100% green status including new `multiLeaderReplica.test.js`.
   - Creating/updating/deleting a credential on one device produces a deterministic delta that reconciles on another device without data loss.
2. **UI & UX Quality**:
   - Desktop and Mobile both present a unified credential view with integrated 2FA circular timers and 1-click copy.
   - Mobile navigation is streamlined to 3 tabs; Desktop master-detail layout is clean and responsive.
   - Cheesy CRT scanlines and screen flickers are replaced with obsidian luxury styling.
3. **Autofill Precision**:
   - Search fields across Android apps and browser extensions do NOT trigger autofill pills or save-password dialogs.
   - Real login forms display a luxury Google-style suggestion dropdown/pill.
4. **Custom Launcher Icon**:
   - Android APK inspection reveals custom obsidian/emerald shield icon on device home screens.
5. **Decoupled Releases**:
   - `node scripts/release.mjs --target=mobile --dry-run` demonstrates selective bumping without altering desktop version.

---

## 6. Risks, Tradeoffs & Mitigations
- **CRDT Clock Skew**: Devices with drifted system clocks could cause Last-Write-Wins anomalies.
  - *Mitigation*: Monotonic hybrid logical clock (HLC) combining physical clock with an incremental local counter.
- **Tombstone Bloat**: Deleted records accumulating indefinitely in local SQLite.
  - *Mitigation*: 90-day tombstone garbage collection sweep for items deleted across all known peers.
- **Android WebView Variations**: Different Android versions may render custom drawables slightly differently.
  - *Mitigation*: Use standard vector XML format (`vector` with `pathData`) supported natively from API 21+ and provide pre-rendered raster PNG fallback mipmaps.
