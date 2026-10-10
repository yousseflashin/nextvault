# NexVault

NexVault is a local-first desktop vault for passwords, TOTP secrets, trusted-device discovery, and browser-extension communication.

Sensitive vault data remains on the user's devices. The relay only authenticates devices and routes discovery/signaling messages; vault payloads are encrypted before they leave the application.

---

## Documentation: System Architecture

NexVault is built on the philosophy that **locality is the ultimate security boundary**.

### Core Flow
1.  **Bootstrap:** Applications generate Ed25519 identity keys. A token captures the public key and signature to facilitate discovery.
2.  **Trusted Network:** Applications discover peers via a lightweight signaling relay (using WebSockets). Once peers discover each other, they establish encrypted, peer-to-peer WebRTC data channels.
3.  **Encrypted Local Data:** Password manager and OTP databases reside in the local application storage. They use SQLCipher + AES-GCM and are protected by master passwords derived via PBKDF2.
4.  **Integrity Monitor:** The system maintains a cryptographic manifest of protected local database files to prevent tampering.
5.  **Offline Security:** The system enforces a 24-hour security heartbeat. If disconnected, it initiates a security countdown, eventually initiating a cryptographic "Nuke" if authorization is not restored.

---

## Getting Started

### Prerequisites
- Node.js 22+
- `npm`

NexVault is structured as a workspace monorepo.

### 1. Desktop App
The desktop vault acts as the primary vault and extension bridge.
```bash
npm install # Run once from the repository root
npm start   # launch the desktop app from the root
```
*To build the production desktop bundle:* `npm run build:desktop` (outputs to `apps/desktop/dist`).

### 2. Browser Extension
Connects to the local desktop app to provide autofill.
1. In Chrome/Edge/Brave, go to `chrome://extensions/`.
2. Toggle **Developer mode**.
3. Load unpacked: `apps/extension/src`.

### 3. Mobile App (Android/iOS)
Uses Capacitor to wrap a React frontend.
```bash
cd apps/mobile
npm install
npm run build
npx cap sync android
```
*Build a debug APK from the repository root:* `npm run build:mobile:android` (requires JDK 21 and the Android SDK).

### 4. Website
```bash
npm run build:website # Run from the repository root
```

---

## Project Structure
```
nexvault/
├── apps/
│   ├── desktop/      # Electron vault (primary app)
│   ├── mobile/       # Capacitor + React (Android/iOS)
│   ├── website/      # Static landing + downloads page
│   ├── extension/    # Browser extension (autofill)
│   └── relay/        # P2P signaling relay
├── packages/
│   └── core/         # Shared crypto, database, grid, OTP, security
└── scripts/          # Build + publish tooling
```

---

## Releases

`npm run release` builds the desktop AppImage and Android APK, then copies both into
`apps/website/public/downloads/` with a `manifest.json`. Deploy `apps/website/public`
to a static host (GitHub Pages, Vercel, Netlify) and the download links on
`/downloads.html` resolve automatically.

---

## Deployment

### Relay Server
The relay server manages WebRTC signaling. **Requires persistent WebSocket support.**
*   **Recommended Platforms:** Render, Railway, Fly.io, or an AWS/DigitalOcean VPS.
*   **Deployment:** Use a platform that supports persistent Node.js processes.
    ```bash
    npm run start:relay # Run from the repository root
    ```

### Website
Deploy `apps/website/public` to a static web host.
*   **Vercel:** `vercel apps/website/public`
*   **Netlify:** `netlify deploy --dir=apps/website/public`

---

## Development

- **Workspace Management:** Dependencies are managed via npm workspaces. Run `npm install` from the root.
- **Shared Logic:** All business logic lives in `packages/core`. When modifying `packages/core`, you may need to link it:
  ```bash
  # Inside an app
  npm install ../../packages/core
  ```
- **Tests:** Run all tests from the root: `npm test`.

*(...original implementation/security details preserved below...)*
[Original current status/requirements/security model details here...]
