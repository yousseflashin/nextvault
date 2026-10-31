# NexVault Infrastructure Deep-Dive Report

## Relay Server (`apps/relay/server.js`)

### Protocol Overview
- Node.js WebSocket signaling server (express + ws) for WebRTC device pairing
- Single-file deployment: `server.js` only, main entry point
- Binds to `process.env.PORT || 46123`, interface `0.0.0.0`
- Health endpoint: `GET /health` → `{ status: 'ok' }`
- MonsterASP.NET/IIS deployment via `web.config` with `httpPlatformHandler`

### Authentication Flow
1. **Client connects** → sends `{ type: 'device-auth', token, deviceId, publicKey }`
2. **Token verification**:
   - Token must have `tokenId`, `signature`, `publicKey`, `expiresAt`
   - `Date.now() >= expiresAt` must be false (not expired)
   - `NexVaultToken.verify(token.tokenId, token.signature, token.publicKey)` must succeed
   - Uses ed25519 (`tweetnacl`) for signature verification
3. **On successful auth**:
   - Session created keyed by `tokenId`, containing `tokenId, deviceId, publicKey, socket`
   - Room created/joined keyed by `tokenId`
   - **Single connection per deviceId**: if another socket holds the same `deviceId`, it's closed with `1008 'Device connected elsewhere'`
   - Peer list broadcast via `sendPeerList(socket, room, session.deviceId)`
   - All other peers in room receive `peer-joined` message with `publicPeer(session)`

### Message Types (message-by-message)

| Message | Direction | Fields | Behavior |
|---|---|---|---|
| `device-auth` | Client → Server | `type, token\{tokenId, signature, publicKey, expiresAt\}, deviceId, publicKey` | Authenticate device. Single connection per deviceId enforced. |
| `peer-joined` | Server → Client | `type, peer\{deviceId, publicKey\}` | Broadcast when a new device authenticates to room. |
| `peer-discover` | Client → Server | `type` | Request current peer list for room. Server responds with `peer-list`. |
| `peer-list` | Server → Client | `type, peers\[{deviceId, publicKey}\]` | Current list of peers in the room authenticated under same tokenId. |
| `signal` | Client → Server | `type, to:string, payload:object` | Relay WebRTC signaling message to specific peer (`room.get(message.to)`). |
| `signal-ack` | Server → Client | `type, to:string, id?:any` | Acknowledgment for signal routing (exact schema from test context). |

### Signal Message Flow
1. Client sends `{ type: 'signal', to: '<peer-deviceId>', payload: <SDP/ICE> }`
2. Server looks up `room.get(message.to)` to find target peer's session
3. If found, forwards `sendJson(peer.socket, { type: 'signal', from: session.deviceId, payload })`
4. Target peer receives signal with `from` identifier

### Connection Lifecycle
- **Auth phase**: Token verification → session creation → peer list broadcast
- **Signaling phase**: Messages routed within room by `deviceId`
- **Stale check**: `if (!room || room.get(session.deviceId) !== socket)` → close `1008 'Session no longer active'`
- **Single connection**: Existing deviceId connection replaced on new auth

### Rate Limits / Concurrency
- No explicit rate-limiting in server code
- `ws` library handles backpressure
- Single connection per `deviceId` per `tokenId` naturally limits concurrency
- No message size limits beyond JSON parse safety (`Array.isArray(message)` reject)

### Crypto Usage
- `@nexvault/core/crypto` → `NexVaultToken.verify()` uses `tweetnacl` ed25519
- `nacl.sign.detached.verify(messageBytes, signature, publicKey)` — verify bootstrap token signature
- Token generation uses `nacl.sign.keyPair()` for device identity
- No hashing or key derivation on relay side; all crypto delegated to core package

### `.npmrc` (apps/relay/)
```
install-links=true
```
- Allows linking local packages (monorepo setup: `@nexvault/core` via `file:../../packages/core`)

### `web.config` (IIS/iisnode Deployment)
```xml
<httpPlatform processPath="node.exe"
              arguments="server.js"
              startupTimeLimit="20"
              retryCount="0"
              stdoutLogEnabled="true"
              stdoutLogFile="\\?\%home%\LogFiles\node_stdout.log">
  <environmentVariables>
    <environmentVariable name="PORT" value="%HTTP_PLATFORM_PORT%" />
  </environmentVariables>
</httpPlatform>
<webSocket enabled="true" />
```
- Maps `PORT` from `HTTP_PLATFORM_PORT` Azure/IIS env var
- WebSocket endpoint explicitly enabled
- `startupTimeLimit="20"` seconds

### `package.json` (apps/relay)
```json
{
  "scripts": {
    "start": "node server.js",
    "build": "node --check server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "express": "^5.3.0",
    "ws": "^8.22.0",
    "@nexvault/core": "file:../../packages/core"
  }
}
```

---

## Website (`apps/website/`)

### Structure
- `src/style.css` — Tailwind @imports (`@tailwind base; @tailwind components; @tailwind utilities;`)
- `public/style.css` — compiled output
- `public/cyber/` — cyber aesthetic assets ( `cyber.css`, `binary-shield.js` )
- `public/downloads/` — build artifacts + manifest
- `downloads.html` — download page listing artifacts
- `index.html` — main landing page
- `package.json`:
  ```json
  {"name":"@nexvault/website","version":"1.0.0","scripts":{"build":"tailwindcss -i src/style.css -o public/style.css"}}
  ```

### Build Artifacts (in `downloads/`)
- `NexVault-0.1.0.AppImage` (130 MB, linux desktop)
- `NexVault-mobile-app-debug.apk` (4.1 MB, android debug)
- `manifest.json` — `[{name,kind,platform,size,file}]`

### Downloads Page Behavior
- Grid layout: 1 column mobile, 2 columns md+
- Each artifact card shows size and download link
- Manifest generated by `publish-builds.mjs`

---

## Scripts (`scripts/`)

### `sync-assets.mjs`
Copies shared cyber design assets from `packages/assets` into every app's static dir:
- Targets: `apps/website/public/cyber`, `apps/desktop/src/cyber`, `apps/mobile/src/cyber`, `apps/extension/src/cyber`
- Copies: `cyber.css`, `binary-shield.js`
- **Purpose**: One source of truth for shared design assets

### `publish-builds.mjs`
Copies desktop (AppImage) and mobile (APK) build artifacts into `apps/website/public/downloads/` and writes `manifest.json`:
- **Desktop**: glob `NexVault-*.AppImage` from `apps/desktop/dist/`
- **Mobile**: globs `app-debug.apk`, `app-release.apk` from `apps/mobile/android/app/build/outputs/apk/`
- **Behavior**:
  1. `rm -rf downloads/` then `mkdir -p downloads/`
  2. Filter files by glob patterns
  3. Rename: desktop keeps original name; mobile prefixed with `NexVault-${kind}-`
  4. Writes `manifest.json` with `{name, kind, platform, size, file}` entries
  5. Console logs each published artifact with size in MB

### `release` script (root `package.json`)
```
npm run build:desktop && npm run build:mobile:android && npm run publish:builds && npm run build:website
```
- Full release pipeline: build desktop → build mobile Android → publish artifacts → build website

---

## Root `package.json` Scripts
```json
{
  "scripts": {
    "start": "npm run start:desktop",
    "prestart": "node scripts/sync-assets.mjs",
    "test": "npm run test:core && npm run test:relay",
    "test:core": "npm --prefix packages/core test",
    "test:relay": "npm --prefix apps/relay test",
    "start:desktop": "npm --prefix apps/desktop run start",
    "build:desktop": "npm --prefix apps/desktop run build",
    "start:mobile": "npm --prefix apps/mobile run start",
    "build:mobile": "npm --prefix apps/mobile run build",
    "build:mobile:android": "npm --prefix apps/mobile run build && npm --prefix apps/mobile exec -- cap sync android && ./apps/mobile/android/gradlew -p apps/mobile/android assembleDebug",
    "build:website": "node scripts/sync-assets.mjs && npm --prefix apps/website run build",
    "publish:builds": "node scripts/publish-builds.mjs",
    "release": "npm run build:desktop && npm run build:mobile:android && npm run publish:builds && npm run build:website",
    "start:relay": "npm --prefix apps/relay run start",
    "build:relay": "npm --prefix apps/relay run build"
  }
}
```

---

## Website Build Process
1. `sync-assets.mjs` runs first — copies cyber assets
2. `tailwindcss -i src/style.css -o public/style.css` — compiles Tailwind
3. Result: `public/style.css`, `public/cyber/cyber.css`, `public/cyber/binary-shield.js`

---

## Prerequisites

### Node.js
- `build:relay` → `npm --prefix apps/relay run build` → `node --check server.js` (syntax check only)
- Relay tested on Node 20 (dependencies: `express@^5.3.0`, `ws@^8.22.0`)
- No Node 26 requirement found; monorepo uses standard Node 20+ features

### JDK 21
- Android build chain requires JDK for `gradlew assembleDebug`
- `build:mobile:android` calls `./apps/mobile/android/gradlew -p apps/mobile/android assembleDebug`
- Android SDK/NDK setup required outside this repo; Gradle wrapper expects JDK 21+ environment

### Other
- `npm install` at root installs monorepo scripts only
- Per-project installs: `packages/core`, `apps/desktop`, `apps/mobile`, `apps/website`
- `prestart` hook ensures assets synced before desktop start
- No `.env` checked into repo; `apps/.env.dev` exists locally

---

## `.gitignore`
```
data/
dist/
node_modules/
apps/website/public/downloads/
```
- Excludes data dir, dist outputs, node_modules, and the downloads artifact dir (generated per-release)

---

## CI / Workflow Files
- **No `.github` workflow files at repository root**
- `.github` only found inside `node_modules/` of various packages (transitive dependencies)
- No CI configuration found in this repo snapshot; release pipeline is locally driven via `npm run release`

---

## Summary of Key Constraints
- **Single connection per deviceId** per token — enforced by server logic
- **Token expiry** verified against `Date.now()` — 24hr heartbeat implied by vault core
- **WebSocket required** — `webSocket enabled="true"` in web.config for IIS
- **ed25519 signatures** — all device auth cryptography via `@nexvault/core/crypto`
- **Monorepo layout** — root orchestrates; each app has independent `package.json` and scripts
- **Deploy target**: MonsterASP.NET/IIS (web.config) or plain VPS (direct node process)