# NexVault

NexVault is a local-first, end-to-end encrypted password manager, OTP authenticator, and trusted-device network that runs on desktop (Electron), mobile (Capacitor), and as a browser extension. Your data never leaves your devices: it stays encrypted locally and syncs peer-to-peer via an authenticated signaling relay (no cloud storage).

## Core Principles

- **Local-first**: Vault data lives only on your devices, encrypted with SQLCipher + AES-256-GCM.
- **Peer-to-peer**: Trusted devices discover each other over a lightweight signaling relay, then upgrade to encrypted WebRTC channels.
- **Zero knowledge**: The relay only sees routing metadata; it cannot read your passwords, TOTP secrets, or vault metadata.
- **Integrity protection**: A cryptographic manifest watches for unauthorized changes to local database files.
- **Offline security**: A 24‑hour heartbeat locks the vault and can trigger a crypto‑nuke if authorization is not restored.

---

## Getting Started

NexVault is a workspace monorepo. From the repository root you can:

### 1. Install dependencies (once)
```bash
npm install
```

### 2. Start any app
Each app can be started independently; the desktop app acts as the primary vault and extension bridge, but you can also use mobile or extension alone after pairing.

#### Desktop (Electron)
```bash
npm run start:desktop   # or: npm start --workspace=@nexvault/desktop
```
Build: `npm run build:desktop`

#### Mobile (Capacitor + React)
```bash
npm run start:mobile    # or: npm start --workspace=@nexvault/mobile
```
Build Android: `npm run build:mobile:android`  
Build iOS: `npm run build:mobile:ios` (requires Xcode)

#### Browser Extension
Load the unpacked extension from `apps/extension/src` in Chrome/Edge/Brave (developer mode).  
It will prompt to connect to a running desktop vault.

#### Website (landing page)
```bash
npm run build:website   # generates static files in apps/website/public
```
Then serve that folder with any static host (e.g., `npx serve apps/website/public`).

### 3. Pairing Devices
On each additional device (desktop, mobile, or extension):
1. Choose **Existing Network** and paste the bootstrap token JSON from your first device.
2. Enter the same master password.
The devices will discover each other via the relay and sync your vault end‑to‑end encrypted.

### 4. Signaling Relay (optional for testing)
The apps include a built‑in dev relay (ws://localhost:3456). For production you can self‑host or use a third‑party service; see **Deployment** below.

---

## Project Structure

```
nexvault/
├── apps/
│   ├── desktop/      # Electron vault (primary app)
│   ├── mobile/       # Capacitor + React (Android/iOS)
│   ├── website/      # Static landing + downloads page
│   ├── extension/    # Browser extension (autofill)
│   └── relay/        # P2P signaling relay (Node/WS)
├── packages/
│   └── core/         # Shared crypto, database, grid, OTP, security
└── scripts/          # Build + publish tooling
```

* `scripts/sync-assets.mjs` copies shared cyber‑theme assets (CSS + binary‑shield canvas) into each app on `prestart` and before website builds.

---

## Releases

`npm run release` builds:
- Desktop AppImage (Linux) from `@nexvault/desktop`
- Android APK (debug) from `@nexvault/mobile`

Both are copied into `apps/website/public/downloads/` with a `manifest.json`.  
Deploy `apps/website/public` to a static host (GitHub Pages, Vercel, Netlify) and the download links on `/downloads.html` resolve automatically.

---

## Deployment

### Relay Server
The relay server manages WebRTC signaling. **Requires persistent WebSocket support.**

- **Recommended Platforms:** Render, Railway, Fly.io, or an AWS/DigitalOcean VPS.
- **Deployment:** Use a platform that supports persistent Node.js processes.
    ```bash
    npm run start:relay   # or: npm start --workspace=@nexvault/relay
    ```
Set the relay URL in each app via `NEXVAULT_RELAY_URL` environment variable or the settings UI.

---

## Developer Notes

- Run the full test suite: `npm test`
- Lint: `npm run lint` (if configured)
- The cyber theme (binary rain + scanlines) lives in `packages/assets/` and is synced by `scripts/sync-assets.mjs`.
