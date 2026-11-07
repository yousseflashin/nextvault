import React, { useState } from 'react';

const PROTOCOLS = [
  {
    id: 'room',
    shortLabel: '01. Room Auth',
    name: '01. Ephemeral Room Discovery',
    tag: 'RELAY:46123 · ED25519',
    summary:
      'Devices verify mutual ownership of their account token through ed25519 digital signatures. The relay acts solely as a blind-matching router.',
    payload: {
      type: 'room-auth',
      tokenIdHash: 'sha256(bootstrapToken)',
      devicePublicKey: 'ed25519:7a9f...33c2',
      signature: 'sig_ed25519(challenge, privateKey)',
      relayVisibility: 'ZERO (Opaque room matching only, no secrets or passwords)'
    },
    guarantee:
      'The relay server never learns vault contents, master passwords, or encryption keys. It only matches devices that already hold the same token signature.'
  },
  {
    id: 'webrtc',
    shortLabel: '02. WebRTC P2P',
    name: '02. WebRTC P2P Direct Channel',
    tag: 'DIRECT ICE · SCTP OVER DTLS',
    summary:
      'Peers exchange SDP offers and ICE candidates through the signaling socket, then immediately cut off relay traffic and communicate peer-to-peer.',
    payload: {
      protocol: 'WebRTC DataChannel',
      encapsulation: 'DTLS 1.3 / SCTP',
      cipher: 'ChaCha20-Poly1305 / AES-256-GCM',
      relayStatus: 'BYPASSED (Traffic routes direct over LAN / WireGuard / NAT)'
    },
    guarantee:
      'Zero vault payload bandwidth passes through external servers once the peer channel opens.'
  },
  {
    id: 'ratchet',
    shortLabel: '03. X25519 Box',
    name: '03. X25519 Sealed Box Vault Sync',
    tag: 'E2EE · TWEETNACL BOX',
    summary:
      'Vault updates and tombstone deletions are encrypted using ephemeral session keys and X25519 Diffie-Hellman public-key cryptography before entering the P2P channel.',
    payload: {
      action: 'vault-sync',
      senderPeerId: 'peer_node_mesh_alpha',
      sessionNonce: '24-byte CSPRNG nonce',
      sealedEnvelope: 'x25519_box(encrypted_vault_delta, peerPublicKey, ephemeralSecret)',
      plaintextExposure: '0.00%'
    },
    guarantee:
      'End-to-end authenticated encryption per sync envelope. Conflict resolution uses per-record monotonic timestamps and tombstones.'
  },
  {
    id: 'extension',
    shortLabel: '04. IPC Bridge',
    name: '04. Localhost Extension & Native Autofill',
    tag: 'IPC:127.0.0.1:46124 · SHADOW DOM',
    summary:
      'On desktop, the browser extension communicates over a loopback socket secured with AES-256-GCM. On Android, AutofillService reads from an encrypted credential store.',
    payload: {
      desktopTransport: 'WebSocket ws://127.0.0.1:46124 (AES-256-GCM)',
      mobileTransport: 'Android AutofillService + Accessibility Overlay',
      originPolicy: 'Strict Localhost / Package Signature Validation',
      injectionTarget: 'Closed Shadow DOM (Invisible to host page scripts)'
    },
    guarantee:
      'Untrusted web scripts cannot intercept IPC messages, inspect Shadow DOM nodes, or harvest stored credentials.'
  }
];

export default function InteractiveArchitecture() {
  const [selectedProtocolIdx, setSelectedProtocolIdx] = useState(0);
  const [copiedEnvelope, setCopiedEnvelope] = useState(false);
  const currentProto = PROTOCOLS[selectedProtocolIdx];

  const handleCopyPayload = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(currentProto.payload, null, 2));
      setCopiedEnvelope(true);
      setTimeout(() => setCopiedEnvelope(false), 2000);
    }
  };

  return (
    <section id="architecture" className="py-16 sm:py-24 bg-dw-bg relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest text-dw-cyan bg-dw-surface border border-dw-border mb-3">
            <span>Cryptographic Wire Spec</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            How NexVault Operates
          </h2>
          <p className="text-sm sm:text-base text-dw-muted mt-3">
            Interactive packet inspector and protocol flow analysis for zero-knowledge device coordination.
          </p>
        </div>

        {/* Mobile Compact Step Switcher (Visible on < lg so mobile users don't have to scroll past 4 tall cards) */}
        <div className="lg:hidden grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 font-mono text-xs">
          {PROTOCOLS.map((proto, idx) => (
            <button
              key={proto.id}
              type="button"
              onClick={() => setSelectedProtocolIdx(idx)}
              className={`p-2.5 rounded-xl border text-left transition ${
                selectedProtocolIdx === idx
                  ? 'bg-dw-surface2 border-dw-green/60 text-white shadow-glow'
                  : 'bg-dw-surface/70 border-dw-border text-dw-muted hover:text-white'
              }`}
            >
              <span className={`block text-[10px] font-bold ${selectedProtocolIdx === idx ? 'text-dw-green' : 'text-dw-dim'}`}>
                STEP 0{idx + 1}
              </span>
              <span className="font-bold text-xs block truncate">{proto.shortLabel.slice(4)}</span>
            </button>
          ))}
        </div>

        {/* Side-by-Side Interactive Protocol Hub */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Full Protocol Selectors (Desktop lg+) */}
          <div className="hidden lg:flex lg:col-span-5 space-y-3 flex-col justify-between">
            {PROTOCOLS.map((proto, idx) => (
              <button
                key={proto.id}
                type="button"
                onClick={() => setSelectedProtocolIdx(idx)}
                className={`w-full text-left p-4 rounded-xl font-mono transition-all border ${
                  selectedProtocolIdx === idx
                    ? 'bg-dw-surface2 border-dw-green/50 text-white shadow-glow'
                    : 'bg-dw-surface/60 hover:bg-dw-surface border-dw-border text-dw-muted hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-bold ${selectedProtocolIdx === idx ? 'text-dw-green' : 'text-dw-dim'}`}>
                    {proto.tag}
                  </span>
                  {selectedProtocolIdx === idx && (
                    <span className="w-2 h-2 rounded-full bg-dw-green animate-pulse"></span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-white mb-1">{proto.name}</h4>
                <p className="text-[11px] text-dw-muted leading-relaxed line-clamp-2">
                  {proto.summary}
                </p>
              </button>
            ))}
          </div>

          {/* Right Column: Terminal Packet Inspector */}
          <div className="lg:col-span-7 rounded-2xl cyber-card border border-dw-border p-4 sm:p-6 font-mono text-xs flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-dw-border text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-dw-green font-bold">PACKET DISSECTOR</span>
                  <span className="text-dw-dim">·</span>
                  <span className="text-white truncate">{currentProto.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyPayload}
                    className="px-2.5 py-0.5 rounded bg-white/5 hover:bg-dw-cyan/20 text-dw-muted hover:text-dw-cyan border border-white/10 transition text-[10px] font-bold"
                  >
                    {copiedEnvelope ? '✓ Copied JSON' : 'Copy Envelope'}
                  </button>
                  <span className="px-2 py-0.5 rounded bg-dw-green/10 text-dw-green border border-dw-green/30 text-[10px] font-bold uppercase">
                    ZERO-KNOWLEDGE
                  </span>
                </div>
              </div>

              {/* Protocol Narrative */}
              <div className="mb-4 p-3.5 rounded-xl bg-black/50 border border-dw-border text-dw-text leading-relaxed">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-dw-cyan font-bold text-[11px]">Cryptographic Execution:</span>
                  <span className="text-[10px] text-dw-dim">{currentProto.tag}</span>
                </div>
                {currentProto.summary}
              </div>

              {/* JSON Packet Preview */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-black/80 border border-dw-border overflow-x-auto text-[11px] leading-relaxed">
                <div className="text-dw-dim mb-2">// Wire Transmission JSON Envelope</div>
                <pre className="text-dw-cyan whitespace-pre-wrap break-words sm:whitespace-pre">
                  {JSON.stringify(currentProto.payload, null, 2)}
                </pre>
              </div>
            </div>

            {/* Bottom Security Guarantee */}
            <div className="mt-4 pt-3 border-t border-dw-border flex items-start gap-2.5 text-[11px]">
              <span className="text-dw-green text-sm shrink-0">🛡️</span>
              <span className="text-dw-muted leading-normal">
                <strong className="text-white">Security Guarantee: </strong>
                {currentProto.guarantee}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
