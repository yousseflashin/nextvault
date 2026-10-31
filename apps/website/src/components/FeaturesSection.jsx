import React from 'react';

const features = [
  {
    title: '1Password-Style In-Field Autofill',
    desc: 'The browser extension places a sleek, glowing shield badge inside login and password inputs. Clicking it reveals an isolated glassmorphic dropdown with instant autofill and strong password generation.',
    tag: 'Extension',
    icon: (
      <svg className="w-6 h-6 text-nv-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    )
  },
  {
    title: 'Local-First SQLCipher Database',
    desc: 'Your credentials live only on your devices inside an encrypted SQLite database protected by SQLCipher with 256-bit AES-CBC encryption and OS keychain hardware keys.',
    tag: 'Storage',
    icon: (
      <svg className="w-6 h-6 text-nv-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    )
  },
  {
    title: 'Direct Peer-to-Peer WebRTC Mesh',
    desc: 'Devices discover one another through an authenticated signaling relay using ed25519 signatures, then immediately upgrade to direct, encrypted WebRTC data channels.',
    tag: 'Sync',
    icon: (
      <svg className="w-6 h-6 text-nv-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    )
  },
  {
    title: 'RFC 6238 TOTP 2FA Authenticator',
    desc: 'Built-in two-factor authenticator. Store base32 secrets and generate standard 6-digit codes with live countdown timers without relying on proprietary cloud authenticators.',
    tag: '2FA',
    icon: (
      <svg className="w-6 h-6 text-nv-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
  {
    title: '24h Dead Man’s Switch & Crypto-Nuke',
    desc: 'A security heartbeat requires device authorization every 24 hours. If an offline device lapses past authorization deadlines, an automatic cryptographic wipe overwrites all keys with random entropy.',
    tag: 'Defense',
    icon: (
      <svg className="w-6 h-6 text-nv-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  },
  {
    title: 'Storage Integrity & Trust Ledger',
    desc: 'Maintains SHA-256 manifests of local vault files. Any out-of-band tampering triggers instant alarms, logged into a cryptographic, append-only hash-chained ledger.',
    tag: 'Integrity',
    icon: (
      <svg className="w-6 h-6 text-nv-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )
  }
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 bg-nv-bg2/60 border-t border-b border-white/5 relative z-10">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-mono uppercase tracking-widest text-nv-primary mb-2 block">System Capabilities</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Engineered for absolute sovereignty.</h2>
          <p className="text-nv-muted mt-3">Every feature is designed from the ground up to protect your privacy and guarantee your vault remains accessible even in total offline isolation.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-6 rounded-xl bg-nv-surface/50 border border-white/5 hover:border-nv-primary/40 transition-all duration-300 hover:-translate-y-1 group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 group-hover:border-nv-primary/30 transition">
                  {f.icon}
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-nv-muted group-hover:text-nv-primary transition">
                  {f.tag}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-nv-primary transition">{f.title}</h3>
              <p className="text-sm text-nv-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

