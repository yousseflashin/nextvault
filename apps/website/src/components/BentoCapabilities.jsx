import React, { useState } from 'react';

export default function BentoCapabilities() {
  const [cipherDemoEncrypted, setCipherDemoEncrypted] = useState(true);
  const [autofillClicked, setAutofillClicked] = useState(false);

  return (
    <section id="features" className="py-24 bg-dw-bg2/90 border-t border-b border-dw-border relative z-10">
      <div className="max-w-6xl mx-auto px-6">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest text-dw-green bg-dw-surface border border-dw-border mb-3">
            <span>Core Sovereignty Stack</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Engineered for total offline isolation.</h2>
          <p className="text-dw-muted mt-3">Every component is mathematically decoupled from third-party cloud infrastructure. Your vault functions seamlessly even in an air-gapped bunker.</p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Tile 1: Wide Card (2 cols) - WebRTC P2P Mesh */}
          <div className="md:col-span-2 p-6 sm:p-8 rounded-2xl bg-dw-surface/80 border border-dw-border hover:border-dw-green/40 transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4 font-mono text-xs">
                <span className="text-dw-green font-bold px-2.5 py-1 rounded bg-dw-green/10 border border-dw-green/30">
                  PROTOCOL // WEBRTC DATACHANNEL
                </span>
                <span className="text-dw-muted">ZERO-KNOWLEDGE RELAY</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-dw-green transition">
                Direct Peer-to-Peer WebRTC Ratchet
              </h3>
              <p className="text-sm text-dw-muted leading-relaxed mb-6">
                No intermediate database stores your entries. Devices verify their identity via ed25519 signatures, discover peer IP sockets through an ephemeral relay, and immediately upgrade to an encrypted X25519 WebRTC DataChannel. Once connected, the relay is bypassed completely.
              </p>
            </div>

            {/* Interactive Visual Element */}
            <div className="p-4 rounded-xl bg-black/50 border border-dw-border font-mono text-xs flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="w-8 h-8 rounded-lg bg-dw-surface flex items-center justify-center text-dw-green font-bold border border-dw-border">
                  D
                </div>
                <div>
                  <span className="text-white font-bold block">Mesh Node Alpha</span>
                  <span className="text-[10px] text-dw-dim">192.168.1.14:46123</span>
                </div>
              </div>

              <div className="flex-1 flex items-center justify-center gap-2 w-full text-center">
                <div className="h-[1px] flex-1 bg-gradient-to-r from-dw-green to-dw-cyan"></div>
                <span className="text-[10px] text-dw-cyan font-bold px-2 py-0.5 rounded bg-dw-cyan/10 border border-dw-cyan/30 whitespace-nowrap">
                  P2P Ratchet (0.6ms)
                </span>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-dw-cyan to-dw-green"></div>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <div className="text-right">
                  <span className="text-white font-bold block">Mesh Node Beta</span>
                  <span className="text-[10px] text-dw-dim">X25519 Sealed Box</span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-dw-surface flex items-center justify-center text-dw-cyan font-bold border border-dw-border">
                  M
                </div>
              </div>
            </div>
          </div>

          {/* Tile 2: Compact Card (1 col) - SQLCipher Hardware Enclave */}
          <div className="p-6 rounded-2xl bg-dw-surface/80 border border-dw-border hover:border-dw-cyan/40 transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4 font-mono text-xs">
                <span className="text-dw-cyan font-bold px-2.5 py-1 rounded bg-dw-cyan/10 border border-dw-cyan/30">
                  SQLCIPHER // AES-256
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2 group-hover:text-dw-cyan transition">
                Page-Level Enclave Storage
              </h3>
              <p className="text-sm text-dw-muted leading-relaxed mb-4">
                Encrypted with 256-bit AES-CBC and 210,000 PBKDF2 iterations. Even raw memory or disk forensic dumps reveal zero readable plaintext.
              </p>
            </div>

            {/* Interactive Plaintext vs Ciphertext demo */}
            <div className="mt-4 p-3 rounded-lg bg-black/60 border border-dw-border font-mono text-[11px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-dw-muted">Disk inspection:</span>
                <button
                  onClick={() => setCipherDemoEncrypted(!cipherDemoEncrypted)}
                  className="text-[10px] text-dw-cyan hover:underline font-bold"
                >
                  {cipherDemoEncrypted ? 'Decrypt (Enclave Key)' : 'Encrypt (Disk View)'}
                </button>
              </div>
              <div className="p-2 rounded bg-dw-surface text-xs font-bold truncate">
                {cipherDemoEncrypted ? (
                  <span className="text-dw-dim">0x8a7f1c99b240182ecfa091...</span>
                ) : (
                  <span className="text-dw-green">hunter2_ultra_secret_pass</span>
                )}
              </div>
            </div>
          </div>

          {/* Tile 3: Compact Card (1 col) - In-Field Shadow DOM Autofill */}
          <div className="p-6 rounded-2xl bg-dw-surface/80 border border-dw-border hover:border-dw-green/40 transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4 font-mono text-xs">
                <span className="text-dw-green font-bold px-2.5 py-1 rounded bg-dw-green/10 border border-dw-green/30">
                  SHADOW DOM // FIELD HOOK
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2 group-hover:text-dw-green transition">
                In-Field Autofill Bridge
              </h3>
              <p className="text-sm text-dw-muted leading-relaxed mb-4">
                The browser extension renders inside an isolated Shadow DOM container. Third-party web scripts cannot inspect credentials or intercept key events.
              </p>
            </div>

            {/* Interactive Input Simulation */}
            <div className="mt-4 p-3 rounded-lg bg-black/60 border border-dw-border font-mono text-[11px]">
              <span className="text-dw-muted block mb-1">Simulated Login Field:</span>
              <div className="relative">
                <input
                  type="password"
                  readOnly
                  value={autofillClicked ? '••••••••••••••••' : ''}
                  placeholder="Password..."
                  className="w-full bg-dw-surface text-white text-xs px-3 py-2 pr-16 rounded border border-dw-border focus:outline-none"
                />
                <button
                  onClick={() => setAutofillClicked(!autofillClicked)}
                  className="absolute right-1 top-1 bottom-1 px-2 rounded bg-dw-green/20 hover:bg-dw-green/30 text-dw-green text-[10px] font-bold transition flex items-center gap-1"
                >
                  <span>🛡️</span>
                  <span>{autofillClicked ? 'Filled' : 'Fill'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Tile 4: Compact Card (1 col) - RFC 6238 TOTP */}
          <div className="p-6 rounded-2xl bg-dw-surface/80 border border-dw-border hover:border-dw-cyan/40 transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4 font-mono text-xs">
                <span className="text-dw-cyan font-bold px-2.5 py-1 rounded bg-dw-cyan/10 border border-dw-cyan/30">
                  2FA // RFC 6238
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2 group-hover:text-dw-cyan transition">
                Built-in TOTP Engine
              </h3>
              <p className="text-sm text-dw-muted leading-relaxed mb-4">
                Full two-factor authenticator engine directly in your vault. No reliance on cloud-tethered authenticator apps or SMS interception vulnerabilities.
              </p>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-black/60 border border-dw-border font-mono text-[11px] flex items-center justify-between">
              <div>
                <span className="text-dw-muted block text-[10px]">Active Seed HMAC:</span>
                <span className="text-white font-bold">SHA-1 / 30s period</span>
              </div>
              <span className="text-dw-cyan font-bold text-sm tracking-wider">651 902</span>
            </div>
          </div>

          {/* Tile 5: Wide Card (2 cols) - 24h Crypto-Nuke & Trust Ledger */}
          <div className="md:col-span-2 p-6 sm:p-8 rounded-2xl bg-dw-surface/80 border border-dw-border hover:border-dw-red/40 transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4 font-mono text-xs">
                <span className="text-dw-red font-bold px-2.5 py-1 rounded bg-dw-red/10 border border-dw-red/30">
                  DEFENSE PROTOCOL // ZERO ENTROPY NUKE
                </span>
                <span className="text-dw-muted">TAMPER INTEGRITY AUDIT</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-dw-red transition">
                24h Dead-Man Switch & Cryptographic Wipe
              </h3>
              <p className="text-sm text-dw-muted leading-relaxed mb-6">
                If an authorized device is confiscated, stolen, or kept offline past its 24-hour heartbeat window, NexVault initiates an automated cryptographic wipe. Key material and SQLite cipher pages are securely overwritten with random entropy before shutdown.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-dw-border font-mono text-xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-center sm:text-left">
              <div className="p-2.5 rounded bg-dw-surface border border-dw-border">
                <span className="text-dw-muted block text-[10px] uppercase">Heartbeat Interval</span>
                <span className="text-dw-green font-bold">24 Hours Strict</span>
              </div>
              <div className="p-2.5 rounded bg-dw-surface border border-dw-border">
                <span className="text-dw-muted block text-[10px] uppercase">Tamper Ledger</span>
                <span className="text-dw-cyan font-bold">SHA-256 Hash Chain</span>
              </div>
              <div className="p-2.5 rounded bg-dw-surface border border-dw-border">
                <span className="text-dw-muted block text-[10px] uppercase">Wipe Mechanism</span>
                <span className="text-dw-red font-bold">Random Byte Fill (3x)</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}

