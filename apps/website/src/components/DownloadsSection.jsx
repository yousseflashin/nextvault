import React, { useEffect, useState } from 'react';

export default function DownloadsSection() {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('downloads/manifest.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setArtifacts(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setArtifacts([]);
        setLoading(false);
      });
  }, []);

  const desktop = artifacts.find((a) => a.kind === 'desktop');
  const mobile = artifacts.find((a) => a.kind === 'mobile');

  return (
    <section id="downloads" className="py-24 bg-nv-bg2/80 border-t border-white/5 relative z-10">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-mono uppercase tracking-widest text-nv-primary mb-2 block">Download Binaries</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Equip Your Devices</h2>
          <p className="text-nv-muted mt-3">Free, open-source, and fully offline-capable. Audit the code before trusting a binary.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Desktop Card */}
          <div className="p-8 rounded-2xl bg-nv-surface/60 border border-white/10 hover:border-nv-primary/50 transition flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono uppercase tracking-wider text-nv-primary px-2.5 py-1 rounded bg-nv-primary/10 border border-nv-primary/20">
                  Primary Vault
                </span>
                <span className="text-xs text-nv-muted font-mono">Linux · AppImage</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Desktop Vault</h3>
              <p className="text-sm text-nv-muted mb-6 leading-relaxed">
                The central command center: full password management, live TOTP generator,
                WebRTC mesh coordinator, and encrypted bridge for the browser extension.
              </p>
            </div>

            <div>
              <a
                href={desktop ? desktop.file : 'downloads/'}
                className="w-full py-3.5 px-6 rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-nv-primary to-nv-accent hover:opacity-90 transition shadow-glow flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {desktop ? `Download Desktop (${(desktop.size / 1048576).toFixed(1)} MB)` : 'Download Desktop (Linux)'}
              </a>
              <span className="text-[11px] text-nv-muted font-mono block text-center mt-3">Requires glibc 2.31+ · No root required</span>
            </div>
          </div>

          {/* Mobile Card */}
          <div className="p-8 rounded-2xl bg-nv-surface/60 border border-white/10 hover:border-nv-accent/50 transition flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono uppercase tracking-wider text-nv-accent px-2.5 py-1 rounded bg-nv-accent/10 border border-nv-accent/20">
                  Companion Device
                </span>
                <span className="text-xs text-nv-muted font-mono">Android · APK</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Mobile App</h3>
              <p className="text-sm text-nv-muted mb-6 leading-relaxed">
                Carry your encrypted vault anywhere. Pairs with your primary desktop vault
                over peer-to-peer WebRTC channels without any intermediary cloud servers.
              </p>
            </div>

            <div>
              <a
                href={mobile ? mobile.file : 'downloads/'}
                className="w-full py-3.5 px-6 rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-white bg-nv-surface border border-white/20 hover:border-nv-accent hover:bg-nv-surface2 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 text-nv-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                {mobile ? `Download Android APK (${(mobile.size / 1048576).toFixed(1)} MB)` : 'Download Android APK'}
              </a>
              <span className="text-[11px] text-nv-muted font-mono block text-center mt-3">Android 8.0+ · Debug build</span>
            </div>
          </div>
        </div>

        <div className="mt-12 p-6 rounded-xl bg-black/40 border border-white/5 font-mono text-xs text-nv-muted flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-nv-primary"></span>
            <span>Cryptographic checksums verified in <code className="text-white">manifest.json</code></span>
          </div>
          <span>Run <code className="text-nv-primary">npm run release</code> to rebuild all binaries</span>
        </div>
      </div>
    </section>
  );
}

