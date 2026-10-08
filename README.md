# NexVault

NexVault is a local-first desktop vault for passwords, TOTP secrets, trusted-device discovery, and browser-extension communication.

Sensitive vault data is intended to remain on the user's devices. The relay only authenticates devices and routes discovery/signaling messages; vault payloads are encrypted before they leave the application.

## Current Status

Implemented:

- Electron desktop application using Electron 44.
- SQLCipher-compatible encrypted SQLite storage.
- Password storage and retrieval through the desktop IPC bridge.
- TOTP secret storage and current-code generation.
- Ed25519 device/bootstrap tokens using TweetNaCl.
- X25519-style peer key exchange and encrypted WebRTC data-channel messages.
- Token-scoped relay discovery and WebRTC signaling.
- Authenticated, AES-GCM encrypted browser-extension sessions.
- 24-hour offline security window.
- One-week and one-month offline extensions.
- Three-month absolute offline deadline.
- 30-minute nuke warning with token-based cancellation.
- Cryptographic destruction of local keys and protected files.
- Hash-chained trusted-device event history.
- Jest unit and integration tests.

Not yet a complete production product:

- The extension currently establishes its secure local session but does not yet inject autofill controls into webpages.
- The relay is a signaling service, not a hosted production service with authentication-rate limits, TLS termination, monitoring, or deployment configuration.
- Android/Capacitor packaging is not included in this repository.
- The default renderer is an implementation/demo surface rather than a finished vault UI.

## Requirements

- Node.js 22 or newer.
- npm.
- Linux, macOS, or Windows supported by Electron and the native SQLCipher driver.
- Build tools required by native Node modules when a prebuilt binary is unavailable.

Electron 44 and `better-sqlite3-multiple-ciphers` are native dependencies. Their install scripts must be allowed in environments that block npm lifecycle scripts.

## Install

```bash
cd /home/youssef/projects/nextvault
npm install
npm run rebuild:native
```

`postinstall` rebuilds `better-sqlite3-multiple-ciphers` for Electron automatically. Run `npm run rebuild:native` after changing Electron versions or native build environments.

## Run The Desktop App

```bash
npm start
```

The application entry point is `src/main/main.js`. The renderer is loaded from `src/main/index.html` and receives a restricted API through `src/main/preload.js` with context isolation enabled and Node integration disabled.

The current renderer supports:

1. Creating a new local user and bootstrap token.
2. Enrolling a fresh device with an existing bootstrap token.
3. Starting NexGrid discovery.
4. Saving and reading passwords.
5. Saving TOTP secrets and displaying the current TOTP code.

The renderer currently uses simple prompts and controls as a functional prototype.

## Run The Relay

The standalone relay listens on port `46123` by default:

```bash
npm run relay
```

Configure the bind address and port with environment variables:

```bash
HOST=0.0.0.0 PORT=46123 npm run relay
```

Point a NexVault device at a remote relay with:

```bash
NEXVAULT_RELAY_URL=wss://relay.example.com:46123 npm start
```

The current standalone relay supports:

- Token signature verification.
- Token-scoped device rooms.
- Peer-list responses.
- Peer join notifications.
- Routing of WebRTC offer, answer, and ICE signaling messages.

It does not store passwords, OTP secrets, master passwords, or decrypted vault messages.

The Electron application also starts a local WebSocket service on `127.0.0.1:46123` for extension and local-device communication.

## Browser Extension

The extension is in `src/extension` and is a Manifest V3 extension.

Load it as an unpacked extension from:

```text
/home/youssef/projects/nextvault/src/extension
```

Current extension files:

- `manifest.json`: Manifest V3 metadata and permissions.
- `background.js`: WebSocket connection, bootstrap-token authentication, and AES-GCM message encryption.
- `popup.html`: Connection and token controls.
- `popup.js`: Stores the bootstrap token and requests a connection.

The popup expects a bootstrap-token JSON object containing `tokenId`, `publicKey`, `signature`, and `expiresAt`. The desktop application must be running on `127.0.0.1:46123` for the default connection path.

## Architecture

```text
Desktop renderer
      |
      | contextBridge / IPC
      v
Electron main process
      |
      +-- NexVaultSecurity
      |     +-- token authorization
      |     +-- offline policy
      |     +-- countdown and nuke
      |     +-- trust ledger
      |
      +-- NexVaultDatabase
      |     +-- SQLCipher database
      |     +-- encrypted password fields
      |     +-- encrypted OTP fields
      |
      +-- NexGrid
      |     +-- WebRTC peer connections
      |     +-- encrypted data channels
      |     +-- relay discovery/signaling
      |
      +-- Local WebSocket relay
            +-- extension authentication
            +-- local device signaling
```

### Core modules

- `src/core/crypto.js`: Ed25519 token identities, signatures, asymmetric encryption, secretbox encryption, and key generation.
- `src/core/database.js`: SQLCipher-compatible database creation, keying, schema, CRUD, and application-layer field encryption.
- `src/core/grid.js`: WebRTC connections, peer key exchange, relay discovery, signaling, and encrypted messages.
- `src/core/otp.js`: Base32 decoding and TOTP generation.
- `src/core/security.js`: User initialization, authentication, token authorization, offline windows, extensions, nuke scheduling, and security status.
- `src/core/storeKey.js`: Persistent OS-protected key used by Electron Store.
- `src/core/trustLedger.js`: Hash-chained trusted-device/security event history.
- `src/relay/server.js`: Standalone token-scoped discovery and signaling relay.

### Electron modules

- `src/main/main.js`: Main process, IPC handlers, database/security/grid initialization, and local relay.
- `src/main/preload.js`: Restricted renderer API.
- `src/main/index.html`: Current functional renderer surface.
- `src/main/renderer.js`: Renderer event handlers and vault controls.

## Security Model

### Device and bootstrap tokens

A new device generates an Ed25519 identity. The bootstrap token contains:

- `tokenId`: Environment identifier.
- `publicKey`: Device verification key.
- `signature`: Signature over `tokenId`.
- `expiresAt`: Token expiration timestamp.

Token signatures are verified before device enrollment, token re-entry, relay authentication, or extension authentication.

### Database encryption

The database uses `better-sqlite3-multiple-ciphers` with SQLCipher-compatible pragmas:

```sql
PRAGMA cipher='sqlcipher';
PRAGMA legacy=4;
PRAGMA key='...';
```

The database key is randomly generated and stored separately from the database. Electron `safeStorage` protects the persistent store key on supported desktop systems. Password and OTP values are also encrypted at the application layer with TweetNaCl secretbox before insertion.

A database created by the earlier unencrypted prototype is not opened with the new SQLCipher key. It is renamed with a `.legacy-<timestamp>` suffix and a new encrypted database is created.

### Extension security

The extension must first authenticate with a valid, unexpired bootstrap token. After authentication, messages use AES-256-GCM with a session key derived from the token identifier. The extension does not receive direct database access.

### Offline security

- Default offline window: 24 hours.
- Normal extension options: one week or one month.
- Three months is an absolute offline deadline and is not granted by the normal extension API.
- Expiration schedules a 30-minute nuke warning.
- Valid token authorization cancels the warning and resets the security window.

The nuke removes protected keys, destroys the database and key files where the operating system permits, clears the Electron Store, and exits the application.

### Trust history

Important events are appended to a hash chain. Each event contains its index, type, payload, device public key, timestamp, previous hash, and current hash. `get-trust-history` returns both the events and the current integrity result.

## IPC API

The preload API is exposed as `window.nexVault`.

Authentication and initialization:

- `initializeNewUser(username, password)`
- `initializeExistingUser(tokenId, publicKey, signature, password, expiresAt)`
- `authenticate(username, password)`
- `getToken()`
- `authorizeToken(token)`

Vault operations:

- `addPassword(serviceName, password)`
- `getPassword(serviceName)`
- `addOtpSecret(otpType, secret)`
- `getOtpSecret(otpType)`
- `getOtpCode(otpType)`

Device network:

- `startNexGrid()`
- `connectPeer(peerId)`
- `acceptConnection(peerId)`
- `setPeerPublicKey(peerId, publicKey)`
- `sendSecureMessage(peerId, message)`

Security:

- `getSecurityStatus()`
- `extendSecurityWindow(duration)`
- `startSecurityCountdown()`
- `stopSecurityCountdown()`
- `getTrustHistory()`
- `nuke()`

## Tests

Run all tests:

```bash
npm test -- --runInBand
```

The suite covers:

- Token generation, signatures, asymmetric encryption, and secretbox encryption.
- Database schema and CRUD behavior.
- OTP generation.
- Security initialization, authentication, countdown, and extensions.
- WebRTC grid behavior with mocked browser APIs.
- Relay device discovery.
- Trust-ledger integrity and tamper detection.

## Build

Build the unpacked Electron application:

```bash
npx electron-builder --dir
```

Build configured Linux artifacts:

```bash
npm run build
```

The unpacked output is written to `dist/linux-unpacked`. The AppImage target may depend on the host's electron-builder AppImage helper and executable permissions.

## Data Locations

- Encrypted database: `data/nexvault.db`.
- Legacy database backups: `data/nexvault.db.legacy-*`.
- Electron Store key envelope: `data/.nexvault-store-key`.
- Electron security store: managed by `electron-store` under the platform's Electron user-data directory.

The local `data` directory is sensitive. Do not commit it or include it in public issue reports.

## Operational Notes

- Use `NEXVAULT_RELAY_URL` to select a remote signaling relay.
- Use `npm run rebuild:native` after upgrading Electron or changing Node/Electron ABI versions.
- The relay can see token identifiers, public keys, device identifiers, and signaling metadata. It must not be treated as a vault-data store.
- WebRTC requires suitable STUN/TURN infrastructure for reliable cross-network connectivity. The built-in configuration currently includes public Google STUN endpoints.
- Production deployment still needs TLS for the remote relay, certificate management, rate limiting, device revocation, monitoring, backups, and a finished autofill/content-script workflow.
