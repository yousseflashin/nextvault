# NexVault — Comprehensive Feature Architecture & Inner Strategy Guide

NextVault is a decentralized, local-first, zero-knowledge credential vault, RFC 6238 TOTP authenticator, and peer-to-peer (P2P) mesh network. It operates under a strict defense-in-depth security model where master keys, passwords, and 2FA secrets never touch a remote storage server or vendor cloud.

This document details every feature across the NextVault ecosystem (Desktop, Mobile, Browser Extension, Relay, and Core Engine), explaining the underlying cryptographic mechanics, protocol handshakes, synchronization algorithms, and inner strategies.

---

## Table of Contents

1. [Executive Summary & Architectural Philosophy](#1-executive-summary--architectural-philosophy)
2. [Cryptographic Core & Key Derivation Strategy](#2-cryptographic-core--key-derivation-strategy)
3. [NexGrid Peer-to-Peer Mesh & Signaling Protocol](#3-nexgrid-peer-to-peer-mesh--signaling-protocol)
4. [TOTP Authenticator & Real-Time QR Scanner](#4-totp-authenticator--real-time-qr-scanner)
5. [Universal Migration & Bulk Ingestion Engine](#5-universal-migration--bulk-ingestion-engine)
6. [Desktop-to-Browser Extension Bridge](#6-desktop-to-browser-extension-bridge)
7. [Mobile Architecture & Native Android Integrations](#7-mobile-architecture--native-android-integrations)
8. [Advanced Security Safeguards & Integrity Monitoring](#8-advanced-security-safeguards--integrity-monitoring)
9. [Inner Strategy & Technical Threat Model](#9-inner-strategy--technical-threat-model)

---

## 1. Executive Summary & Architectural Philosophy

### The "Zero Cloud Storage" Doctrine
Conventional password managers (Bitwarden, 1Password, LastPass) rely on centralized multi-tenant cloud databases. Even with client-side encryption, centralized architectures introduce critical attack surfaces:
- Cloud database leaks exposing encrypted blobs to offline brute-force attacks (e.g. quantum or specialized GPU rigs).
- Cloud server infrastructure downtime preventing user access to credentials.
- Metadata leakage (access timestamps, IP logs, user vaults graph).

**NextVault reverses this paradigm**:
- **Data Residence**: The encrypted database exists **only** on user-authorized devices (Desktop SSD, Mobile device storage).
- **Network Role**: The signaling relay server is zero-knowledge; it acts as a blind mailbox for WebRTC SDP handshakes and peer-to-peer message routing. It cannot inspect, decrypt, or persist vault contents.
- **Mesh Topology**: Synchronization occurs device-to-device through direct encrypted channels negotiated dynamically.

```
+------------------+         Encrypted P2P (WebRTC/WS)        +------------------+
|  Desktop Vault   | <======================================> |   Mobile Vault   |
| (SQLCipher DB)   |                                          | (Encrypted Local)|
+------------------+                                          +------------------+
        ^                                                              ^
        |                  +-----------------------+                   |
        |                  |  Zero-Knowledge Relay |                   |
        +----------------> |    (Signaling Only)   | <-----------------+
                           +-----------------------+
```

---

## 2. Cryptographic Core & Key Derivation Strategy

### 2.1 Cryptographic Primitives Matrix

| Function | Algorithm / Primitive | Implementation | Purpose |
| :--- | :--- | :--- | :--- |
| **Device Identity & Signing** | Ed25519 | `tweetnacl.sign` | Cryptographic identity, token verification, ledger integrity |
| **P2P Channel Encryption** | X25519 (ECDH) + XSalsa20-Poly1305 | `tweetnacl.box` | End-to-end encrypted peer-to-peer messages |
| **Key Derivation (KDF)** | PBKDF2-HMAC-SHA256 (210,000 rounds) | WebCrypto / Node `crypto` | Master password to encryption key transformation |
| **Desktop Storage Engine** | SQLCipher (AES-256-CBC, PBKDF2) | `better-sqlite3-multiple-ciphers` | Page-level transparent database encryption |
| **Mobile Vault Storage** | PBKDF2-HMAC-SHA256 (600,000 rounds, random salt) + XSalsa20-Poly1305 | WebCrypto / TweetNaCl `secretbox` | Encrypted-at-rest vault envelope; key and plaintext exist only in memory while unlocked |
| **Android Autofill Store** | AES-256-GCM (Android Keystore) | `NativeCredentialStore.java` | Hardware-backed credential cache for the autofill service |
| **Hash Chaining & Ledger** | SHA-256 | Native Crypto | Append-only trust ledger & file integrity baselines |

### 2.2 Master Key Derivation Strategy

When a user initializes or unlocks their vault:
1. A cryptographically random salt (32 bytes) is generated on new vault creation or retrieved from the vault configuration.
2. The user's Master Password is fed into **PBKDF2-HMAC-SHA256** with **210,000 iterations** to derive a 256-bit symmetric Master Encryption Key ($K_{master}$).
3. $K_{master}$ is used directly as the decryption key for the local SQLCipher database on Desktop and the encrypted storage envelope on Mobile.
4. **Memory Zeroing Strategy**: When the vault is locked or the auto-lock timer fires:
   - All plaintext password variables and decrypted cache arrays are overwritten with zeroes or purged.
   - Database connections are closed.
   - Active decryption keys in memory are evicted.
   - Desktop: `lock-vault` clears the session so the extension bridge stops serving credentials. Mobile: the vault key is zeroed; auto-lock fires after 2 min in background or 5 min idle.
   - Clipboard is cleared 30 s after copying a password or OTP; Android screenshots are blocked (`FLAG_SECURE`).

### 2.3 Bootstrap Token Architecture

NextVault utilizes an Ed25519 cryptographically signed bootstrap token to anchor identity:
```json
{
  "tokenId": "nexvault-lxyz123-abc456",
  "publicKey": "base64-encoded-ed25519-public-key",
  "signature": "base64-encoded-signature-over-tokenId",
  "expiresAt": "2026-12-04T12:00:00.000Z"
}
```
- **Root Authority**: Each vault owner generates a master Ed25519 keypair upon creation.
- **Detached Signature**: The `signature` proves ownership of the private key corresponding to `publicKey`.
- **Peer Pairing**: When enrolling a secondary device (e.g. mobile app), the bootstrap token establishes cryptographic identity before peer-to-peer pairing is authorized.

---

## 3. NexGrid Peer-to-Peer Mesh & Signaling Protocol

NexGrid is the distributed synchronization subsystem of NextVault.

### 3.1 Signaling Relay Handshake

The signaling relay (default port `46123`) facilitates NAT traversal and peer discovery:
1. **Device Registration**:
   - Device connects via WebSocket (`wss://relay.yourdomain.com`).
   - Client sends `register` message with its public Device ID and cryptographic signature.
2. **Ephemeral Pairing Code Protocol**:
   - To pair a mobile device with a desktop, one device generates a high-entropy 6-character code (e.g. `839201`).
   - The pairing code is mapped in memory on the relay with a 3-minute strict TTL.
   - The secondary device enters or scans the pairing code.
   - The relay matches the two devices and brokers the exchange of public X25519 peer encryption keys without inspecting any vault data.
3. **Mutual Approval**:
   - The initiating device prompts the user: *"Incoming pairing request from Mobile (Pixel 8). Approve?"*
   - Once approved, both devices add each other's public keys to their local `trustedDevices` store.

```
Desktop                               Relay Server                            Mobile
   |                                       |                                    |
   | --- generate pairing code (839201) -> |                                    |
   |                                       | <--- submit pairing code (839201) -|
   | <------- incoming pair request ------ |                                    |
   | [User Approves Pairing]               |                                    |
   | -------- approve & send pubKey -----> |                                    |
   |                                       | -------- send desktop pubKey ----> |
   | <=================== Direct E2EE Encrypted P2P ==========================> |
```

### 3.2 Real-Time Bidirectional Synchronization

Once paired:
- **Event-Driven Sync**: Any credential creation, edit, or deletion triggers a `sync-push` payload.
- **Zero-Knowledge Payload**: The payload is encrypted using `tweetnacl.box` (authenticated public-key cryptography combining X25519, XSalsa20, and Poly1305).
- **Conflict Resolution**:
  - Each item carries an ISO-8601 UTC timestamp and a cryptographic modification version.
  - Conflicts are resolved using deterministic Last-Write-Wins (LWW) with tombstones for deletions.
  - Deletions propagate tombstones across the mesh to ensure deleted items are not resurrected by newly synced peers.
- **Bulk Sync**: When a device reconnects after being offline, a mutual state reconciliation checks ledger hashes and syncs missing deltas.

---

## 4. TOTP Authenticator & Real-Time QR Scanner

NextVault features a native RFC 6238 TOTP (Time-Based One-Time Password) engine.

### 4.1 TOTP Mathematical Execution

1. **Secret Key Normalization**:
   - Base32 secrets (e.g., `JBSWY3DPEHPK3PXP`) are cleaned of whitespace, converted to uppercase, and decoded to raw byte buffers.
2. **Time-Step Calculation**:
   $$\text{Counter } T = \left\lfloor \frac{\text{Current Unix Timestamp} - T_0}{T_X} \right\rfloor$$
   Where default $T_0 = 0$ and $T_X = 30\text{ seconds}$.
3. **HMAC Generation & Dynamic Truncation**:
   - Computes $\text{HMAC-SHA1}(\text{Secret}, T)$ (also supports SHA-256 and SHA-512).
   - Extracts the offset from the last 4 bits of the HMAC digest:
     $$\text{offset} = \text{digest}[19] \ \& \ \text{0x0F}$$
   - Takes 4 bytes starting at `offset`, masks the most significant bit, and performs modulo $10^6$ to produce the standard 6-digit authentication token.

### 4.2 Integrated Camera Viewfinder & Image Decoder

The Mobile app (`apps/mobile/src/qrScanner.ts`) provides dual scanning mechanisms:
1. **Live Camera Scanner**:
   - Interacts with HTML5 `navigator.mediaDevices.getUserMedia` or native Android camera permissions.
   - Renders a responsive viewfinder with glowing corner brackets and target guidelines.
   - Continuously samples video frames on a canvas, running barcode decoding algorithms in real time.
2. **Screenshot / Photo Barcode Fallback**:
   - If camera access is restricted or unavailable, users can select a QR code screenshot or image.
   - An off-screen canvas processes image source buffers, extracts barcode luminance, and parses the `otpauth://totp/...` URI.
3. **URI Parser (`parseOtpAuthUri`)**:
   - Parses label, secret, algorithm, digits, and issuer parameters directly into the authenticator store.

---

## 5. Universal Migration & Bulk Ingestion Engine

To allow friction-free onboarding from legacy password managers, NextVault includes an atomic bulk import engine (`packages/core/importParser.js` and `apps/mobile/src/mobileVault.ts`):

### 5.1 Supported Formats & Parsing Strategies

- **1Password 1PUX & CSV**:
  - Maps `Title` $\rightarrow$ Service, `Username` $\rightarrow$ Username, `Password` $\rightarrow$ Password, `one-time password` $\rightarrow$ TOTP.
- **Bitwarden JSON & CSV**:
  - Handles Bitwarden nested JSON structures (`login.uris`, `login.username`, `login.password`, `login.totp`).
- **LastPass & Dashlane CSV**:
  - Translates URL and service naming conventions, decoding URL-encoded characters.
- **Chrome / Firefox / Edge / Brave CSV**:
  - Parses browser credential dump files, extracting root domains as service identifiers.

### 5.2 Interactive Tag Preview & Atomic Commits

1. File or raw text is parsed into memory.
2. The user is presented with a preview modal displaying parsed credential counts and service tags.
3. Upon confirmation, credentials are batch-inserted in an atomic database transaction, preventing partial corruptions.
4. NexGrid triggers a single consolidated mesh sync event.

---

## 6. Desktop-to-Browser Extension Bridge

The Browser Extension (`apps/extension`) communicates directly with the Desktop app without touching the internet.

### 6.1 Native Bridge Protocol

- **Loopback WebSocket Server**: The desktop vault runs an authenticated local server on `127.0.0.1:46124`.
- **Origin Verification**: The server verifies that connections originate strictly from Chrome/Brave/Edge extension runtime IDs.
- **Pre-Shared Secret Authentication**:
  - During first setup, an ephemeral pairing token is exchanged between the extension and desktop.
  - All subsequent IPC requests carry an authentication header.

### 6.2 Contextual Autofill & In-Page Injection

1. **Domain Detection**: The extension content script detects active tab URL and extracts the effective Second-Level Domain (eSLD) (e.g. `github.com`).
2. **Query Desktop Vault**: The extension queries the local desktop bridge for credentials matching the domain.
3. **DOM Matching**:
   - Identifies `<input type="password">`, `<input type="text" autocomplete="username">`, and associated credential forms.
   - Injects a discrete NextVault shield badge inside the input field.
4. **User-Approved Filling**: Clicking the badge fills the credentials into the DOM with synthetic `input` and `change` events to ensure single-page application (React, Angular, Vue) state binding.

---

## 7. Mobile Architecture & Native Android Integrations

The Mobile application (`apps/mobile`) is built on Capacitor with custom native Android plugins.

### 7.1 Visual Theme & Image Cover

- **Hero Cover Banner**: The mobile authentication interface features an obsidian glassmorphic hero cover (`/cover.jpg`) with ambient emerald (`#10b981`) and cyan (`#0ea5e9`) lighting, communicating NextVault's cryptographic security posture upon first touch.
- **Adaptive Splash Screens**: Multi-resolution native Android splash assets (`drawable-port-*` and `drawable-land-*`) deliver an instantaneous, dark-mode native cold boot.

### 7.2 Native Android In-App APK Updater (`AppUpdaterPlugin.java`)

NextVault implements an in-app OTA update pipeline for Android that operates independently of the Google Play Store:
1. **Version Check**: The app queries the GitHub Releases API for new signed APK releases against `CURRENT_VERSION`.
2. **Native Download**: Downloads the APK to the app's external cache directory.
3. **Android FileProvider**:
   - Generates a secure `content://` URI via `FileProvider` (`com.nexvault.app.fileprovider`), complying with Android 7.0+ (API 24+) strict file exposure restrictions.
4. **PackageInstaller Intent**:
   - Fires an `ACTION_VIEW` intent with `FLAG_GRANT_READ_URI_PERMISSION` and `FLAG_ACTIVITY_NEW_TASK` targeting `application/vnd.android.package-archive`.
   - Opens the native Android package installer sheet seamlessly.

---

## 8. Advanced Security Safeguards & Integrity Monitoring

NextVault contains five defensive layers designed to thwart tampering, physical device seizure, and offline attacks:

### 8.1 Append-Only Hash-Chained Trust Ledger (`trustLedger.js`)

All critical security events are recorded in an append-only cryptographic ledger:
- **Structure**: Each entry contains `index`, `timestamp`, `eventType`, `payload`, `prevHash`, and `hash`.
$$\text{hash} = \text{SHA-256}(\text{index} + \text{timestamp} + \text{eventType} + \text{payload} + \text{prevHash})$$
- **Tamper Detection**: If any past log entry is altered or deleted, recalculating the hash chain immediately flags a ledger integrity violation.

### 8.2 Real-Time Storage Integrity Monitor (`integrity.js`)

- On initialization, NextVault computes SHA-256 baseline checksums of:
  - The database file.
  - Binary configurations.
  - Critical core modules.
- Periodic integrity sweeps re-verify hashes. If a hash changes unexpectedly outside authorized write operations, the vault enters an immediate security lockdown.

### 8.3 24-Hour Heartbeat & Dead Man's Switch

- Vaults require a periodic heartbeat confirmation every 24 hours.
- If a device is disconnected or offline beyond the security threshold:
  - The vault locks immediately.
  - Sensitive cached tokens are evicted from memory.
  - To re-activate, the user must enter their master password or obtain a quorum extension.

### 8.4 Quorum Peer Approvals for Offline Extensions

- If a user anticipates traveling offline for an extended period, they can request an offline window extension from the desktop.
- The request is broadcast across the NexGrid mesh.
- Any paired trusted peer (e.g., the user's mobile phone) can approve the extension cryptographically, signing the approval with their Ed25519 device key.

### 8.5 Emergency Cryptographic Nuke (Self-Destruct Protocol)

In high-risk scenarios (e.g., physical compromise), the user can trigger an emergency vault nuke:
1. **Multi-Pass Memory Overwrite**: All in-memory buffers containing credentials, TOTP secrets, and cryptographic keys are overwritten with pseudo-random noise, followed by zeroes.
2. **Database Shredding**: The SQLCipher database file is overwritten with random bytes in multiple passes before unlinking from the file system.
3. **Mesh Revocation Broadcast**: A signed revocation broadcast is sent across NexGrid to un-pair and blacklist the compromised device ID.

---

## 9. Inner Strategy & Technical Threat Model

```
+------------------------------------+---------------------------------------------------+
| Potential Threat Vector            | NextVault Defensive Countermeasure                |
+------------------------------------+---------------------------------------------------+
| Cloud Database Compromise          | Non-existent. Vault data is strictly local.      |
| Man-In-The-Middle (Relay Intercept)| Relay only sees encrypted blobs (TweetNaCl Box).  |
| Brute-Force Master Password        | PBKDF2-HMAC-SHA256 (210k desktop / 600k mobile).  |
| Malicious Extension Injection      | Origin verification + Pre-shared pairing tokens.  |
| Stolen Physical Device             | SQLCipher AES-256-CBC + Auto-lock timeout.        |
| File System Tampering              | Cryptographic SHA-256 Integrity Verification.     |
| Unauthorized Device Pairing        | Ephemeral pairing code + user manual confirmation.|
| Dormant Stolen Device              | 24-Hour Dead Man's switch & Heartbeat expiry.     |
+------------------------------------+---------------------------------------------------+

NextVault delivers institutional-grade cryptography combined with consumer-friendly peer-to-peer simplicity, proving that privacy and usability can coexist seamlessly.

