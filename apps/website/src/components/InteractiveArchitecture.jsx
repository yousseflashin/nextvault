import React, { useState } from 'react';

const PROTOCOLS = [
  {
    id: 'room',
    name: '01. Ephemeral Room Discovery',
    tag: 'RELAY:46123 · ED25519',
    summary: 'Devices verify mutual ownership of their account token through ed25519 digital signatures. The relay acts solely as a dumb blind-matching router.',
    payload: {
      type: 'room-auth',
      tokenIdHash: 'sha256(bootstrapToken)',
      devicePublicKey: 'ed25519:7a9f...33c2',
      signature: 'sig_ed25519(challenge, privateKey)',
      relayVisibility: 'ZERO (Opaque room matching only, no secrets or passwords)'
    },
    guarantee: 'The relay server never learns vault contents, master passwords, or encryption keys. It only matches devices that already hold the same token signature.'
  },
  {
    id: 'webrtc',
    name: '02. WebRTC P2P Direct Channel',
    tag: 'DIRECT ICE · SCTP OVER DTLS',
    summary: 'Peers exchange SDP offers and ICE candidates through the signaling socket, then immediately cut off relay traffic and communicate peer-to-peer.',
    payload: {
      protocol: 'WebRTC DataChannel',
      encapsulation: 'DTLS 1.3 / SRTP',
      cipher: 'ChaCha20-Poly1305 / AES-128-GCM',
      relayStatus: 'DISCONNECTED (Traffic routes direct over local Wi-Fi / WireGuard)'
    },
    guarantee: 'Zero bandwidth passes through external relay once the peer channel opens. Even if the relay server goes offline, existing device sync continues unaffected.'
  },
  {
    id: 'ratchet',
    name: '03. X25519 Sealed Box Vault Sync',
    tag: 'E2EE · TWEETNACL BOX',
    summary: 'Vault updates are encrypted using ephemeral session keys and X25519 Diffie-Hellman public key cryptography before entering the P2P channel.',
    payload: {
      action: 'vault-sync',
      senderPeerId: 'peer_node_linux_desktop',
      sessionNonce: '24-byte CSPRNG nonce',
      sealedEnvelope: 'x25519_box(encrypted_sqlite_dump, peerPublicKey, ephemeralSecret)',
      plaintextExposure: '0.00%'
    },
    guarantee: 'Perfect forward secrecy per session. A compromised session key cannot decrypt past synchronization packets.'
  },
  {
    id: 'extension',
    name: '04. Localhost Extension Bridge',
    tag: 'IPC:127.0.0.1:46124 · SHADOW DOM',
    summary: 'The browser extension communicates exclusively with the local desktop daemon over a dedicated loopback socket secured with AES-256-GCM.',
    payload: {
      transport: 'WebSocket ws://127.0.0.1:46124',
      originPolicy: 'Strict Localhost / Extension ID validation',
      encryption: 'AES-256-GCM keyed by sha256(pairingToken)',
      injectionTarget: 'Isolated Shadow DOM (Invisible to host webpage DOM)'
    },
    guarantee: 'Webpage JavaScript cannot intercept IPC messages, inspect shadow DOM elements, or sniff credentials stored in memory.'
  }
];

export default function InteractiveArchitecture() {
  const [selectedProtocolIdx, setSelectedProtocolIdx] = useState(0);
  const currentProto = PROTOCOLS[selectedProtocolIdx];

  return (
    <section id="architecture" className="py-24 bg-dw-bg relative z-10">
      <div className="max-w-6xl mx-auto px-6">
        
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest text-dw-cyan bg-dw-surface border border-dw-border mb-3">
            <span>Cryptographic Wire Spec</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">How NexVault Operates</h2>
          <p className="text-dw-muted mt-3">Interactive packet inspector and protocol flow analysis for zero-knowledge device coordination.</p>
        </div>

        {/* Side-by-Side Interactive Protocol Hub */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* Left Column: Protocol Selectors */}
          <div className="lg:col-span-5 space-y-3 flex flex-col justify-between">
            {PROTOCOLS.map((proto, idx) => (
              <button
                key={proto.id}
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
          <div className="lg:col-span-7 rounded-2xl bg-dw-surface/90 border border-dw-border p-6 font-mono text-xs flex flex-col justify-between shadow-deep">
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-dw-border text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-dw-green font-bold">WIRESHARK // PACKET DISSECTOR</span>
                  <span className="text-dw-dim">·</span>
                  <span className="text-white">{currentProto.id.toUpperCase()}_ENVELOPE</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-dw-green/10 text-dw-green border border-dw-green/30 text-[10px] font-bold uppercase">
                  ZERO-KNOWLEDGE VERIFIED
                </span>
              </div>

              {/* Protocol Narrative */}
              <div className="mb-4 p-3 rounded-lg bg-black/50 border border-dw-border text-dw-text leading-relaxed">
                <span className="text-dw-cyan block mb-1 font-bold text-[11px]">Cryptographic Execution:</span>
                {currentProto.summary}
              </div>

              {/* JSON Packet Preview */}
              <div className="p-4 rounded-xl bg-black/80 border border-dw-border overflow-x-auto text-[11px] leading-relaxed">
                <div className="text-dw-dim mb-2">// Wire Transmission JSON Envelope</div>
                <pre className="text-dw-cyan">
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
