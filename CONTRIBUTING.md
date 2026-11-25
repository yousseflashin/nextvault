# Contributing to NextVault

Thank you for your interest in contributing to **NextVault**! NextVault is an open-source, local-first, zero-knowledge password manager and threat defense ecosystem built for Linux desktop, Android mobile, and web.

---

## 1. Monorepo Architecture

NextVault is structured as a modular npm workspace monorepo:

```text
nextvault/
├── apps/
│   ├── desktop/          # Electron desktop application (Linux x86_64, Windows, macOS)
│   ├── mobile/           # Capacitor + React Android application (Material Design 3)
│   ├── relay/            # Encrypted WebRTC discovery relay server
│   └── website/          # Static landing website & release download distribution
├── packages/
│   ├── core/             # Cryptography, SQLite cipher, sync, and trust ledger engine
│   └── threat-engine/    # Phishing detection, security event bus, and antivirus integrity auditor
└── scripts/              # Release orchestration, build pipelines, and manifest generators
```

---

## 2. Prerequisites

Ensure your environment satisfies the following requirements:

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Java**: JDK 17 or JDK 21 (for Android builds)
- **Android SDK**: Build-Tools `34.0.0+` or `36.0.0`, Platform `android-34`+
- **Native Tooling** (Linux): `build-essential`, `libsecret-1-dev`, `python3`

---

## 3. Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yousseflashin/nextvault.git
   cd nextvault
   ```

2. **Install all workspace dependencies**:
   ```bash
   npm install
   ```

3. **Run the unit test suite**:
   ```bash
   npm test
   ```
   All test suites (Core crypto, Mesh relay, and Threat defense engine) must pass.

---

## 4. Running Applications Locally

- **Mobile Web App (Dev Server)**:
  ```bash
  npm run start:mobile
  ```
- **Desktop Electron App**:
  ```bash
  npm run start:desktop
  ```
- **Discovery Relay Server**:
  ```bash
  npm run start:relay
  ```
- **Marketing / Download Website**:
  ```bash
  npm run start:website
  ```

---

## 5. Building & Packaging

- **Build Mobile Android APK**:
  ```bash
  npm run build:mobile
  ```
  Generates `release/NexVault-<version>.apk` signed with the canonical keystore.

- **Build Desktop AppImage (Linux)**:
  ```bash
  npm run build:desktop
  ```
  Generates `release/NexVault-<version>-x86_64.AppImage`.

---

## 6. Security & Cryptographic Guidelines

1. **Zero-Knowledge Guarantee**:
   The user's master password never leaves their device and is never stored on disk.
2. **Deterministic Encryption**:
   Vault items are encrypted using **XChaCha20-Poly1305** / NaCl secretbox with keys derived via PBKDF2 (SHA-256, 100,000+ iterations).
3. **Android Keystore & Sandboxing**:
   Mobile autofill credentials must use hardware-backed AES-GCM encryption or Linux UID-isolated `Context.MODE_PRIVATE` storage.
4. **Synchronous Writes**:
   All critical autofill storage writes must use `.commit()` rather than async `.apply()` to survive Android process teardown.

---

## 7. Submitting Pull Requests

1. **Create a topic branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Follow conventional commits**:
   - `feat:` for new capabilities or UI components
   - `fix:` for bug fixes
   - `test:` for test additions or improvements
   - `chore:` for dependencies, tooling, or documentation
3. **Ensure tests pass**:
   ```bash
   npm test
   ```
4. **Submit a Pull Request** against the `main` branch with a clear description of the problem solved and test evidence.
