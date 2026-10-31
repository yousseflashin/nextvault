import React, { useState } from 'react';

export default function ArchitectureSection() {
  const [activeTab, setActiveTab] = useState('mesh');

  return (
    <section id="architecture" className="py-24 relative z-10">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-mono uppercase tracking-widest text-nv-accent mb-2 block">Zero-Knowledge Protocols</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">How NexVault Operates</h2>
          <p className="text-nv-muted mt-3">Examine the cryptographic architecture that decouples device discovery from confidential vault payloads.</p>

          <div className="flex justify-center gap-2 mt-8">
            <button
              onClick={() => setActiveTab('mesh')}
              className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition ${
                activeTab === 'mesh'
                  ? 'bg-nv-primary/10 text-nv-primary border border-nv-primary/40'
                  : 'text-nv-muted hover:text-white border border-transparent'
              }`}
            >
              P2P WebRTC Mesh
            </button>
            <button
              onClick={() => setActiveTab('extension')}
              className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition ${
                activeTab === 'extension'
                  ? 'bg-nv-primary/10 text-nv-primary border border-nv-primary/40'
                  : 'text-nv-muted hover:text-white border border-transparent'
              }`}
            >
              1Password In-Field Bridge
            </button>
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition ${
                activeTab === 'crypto'
                  ? 'bg-nv-primary/10 text-nv-primary border border-nv-primary/40'
                  : 'text-nv-muted hover:text-white border border-transparent'
              }`}
            >
              Storage & Cryptography
            </button>
          </div>
        </div>

        <div className="p-8 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md">
          {activeTab === 'mesh' && (
            <div className="space-y-6 font-mono text-sm">
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-accent uppercase block mb-1">// 1. Device Authentication & Room Discovery</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Device transmits ed25519 signature of its bootstrapToken to signaling relay (port 46123).
                  The relay verifies signature and aggregates devices sharing the same tokenId into an isolated room without ever inspecting passwords or secrets.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-primary uppercase block mb-1">// 2. WebRTC P2P DataChannel Upgrade</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Peers exchange SDP offers and ICE candidates through relay, then immediately establish a direct, peer-to-peer WebRTC connection.
                  All signaling through relay ceases once the direct encrypted channel opens.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-accent uppercase block mb-1">// 3. End-to-End Vault Sync</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Vault changes are encrypted using X25519 sealed box primitives (tweetnacl.box) with ephemeral session keys and transmitted directly between your personal devices.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'extension' && (
            <div className="space-y-6 font-mono text-sm" id="extension">
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-primary uppercase block mb-1">// 1. Isolated Shadow DOM Injection</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  The extension detects username and password fields and injects a subtle NexVault shield badge into the right edge of the input.
                  All elements render inside an isolated Shadow DOM so the webpage's styles can never deform the UI.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-accent uppercase block mb-1">// 2. Localhost AES-256-GCM Bridge (Port 46124)</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  When you click the badge, the extension queries the local Desktop vault via 127.0.0.1:46124 using an AES-256-GCM encrypted session keyed by SHA256(tokenId).
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-primary uppercase block mb-1">// 3. In-Field Autofill & Password Generation</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  A floating glassmorphic card displays matching credentials for the domain. Clicking "Autofill" or "Generate Strong Password" fills the inputs and triggers framework-compatible input events.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'crypto' && (
            <div className="space-y-6 font-mono text-sm">
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-primary uppercase block mb-1">// 1. PBKDF2 Key Derivation</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Master password + device identity salt are transformed through 210,000 iterations of PBKDF2-HMAC-SHA256 to generate the 256-bit vault encryption key.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-accent uppercase block mb-1">// 2. SQLCipher Database</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Local SQLite database is transparently encrypted at page-level using SQLCipher (better-sqlite3-multiple-ciphers) with random keys secured in OS keychains.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-nv-surface/60 border border-white/5">
                <span className="text-xs text-nv-danger uppercase block mb-1">// 3. Integrity Manifest & Crypto-Nuke</span>
                <p className="text-nv-text text-xs leading-relaxed">
                  Periodic SHA-256 checksums verify that local database and key files have not been manipulated. Tampering or dead-man timer expiration triggers overwriting sensitive files with random bytes.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

