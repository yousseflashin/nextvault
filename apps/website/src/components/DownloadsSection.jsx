import React, { useEffect, useState } from 'react';

const GITHUB_REPO = 'yousseflashin/nextvault';
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
const GITHUB_LATEST_RELEASE = `https://github.com/${GITHUB_REPO}/releases/latest`;

// Direct latest asset download endpoints on GitHub Releases
const DEFAULT_DESKTOP_DOWNLOAD = `https://github.com/${GITHUB_REPO}/releases/download/v0.1.0/NexVault-0.1.0.AppImage`;
const DEFAULT_MOBILE_DOWNLOAD = `https://github.com/${GITHUB_REPO}/releases/download/v0.1.1/NexVault-mobile-app-debug.apk`;

export default function DownloadsSection() {
  const [releaseTag, setReleaseTag] = useState('v0.1.1');
  const [desktopAsset, setDesktopAsset] = useState(null);
  const [mobileAsset, setMobileAsset] = useState(null);

  useEffect(() => {
    // Dynamically query latest release assets from GitHub Releases API
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.tag_name) setReleaseTag(data.tag_name);
        if (Array.isArray(data.assets)) {
          const dt = data.assets.find((a) => a.name.endsWith('.AppImage'));
          const mb = data.assets.find((a) => a.name.endsWith('.apk'));
          if (dt) setDesktopAsset(dt);
          if (mb) setMobileAsset(mb);
        }
      })
      .catch(() => {});
  }, []);

  const desktopUrl = desktopAsset?.browser_download_url || DEFAULT_DESKTOP_DOWNLOAD;
  const desktopSize = desktopAsset?.size
    ? `(${(desktopAsset.size / 1048576).toFixed(1)} MB)`
    : '(124.5 MB)';

  const mobileUrl = mobileAsset?.browser_download_url || DEFAULT_MOBILE_DOWNLOAD;
  const mobileSize = mobileAsset?.size
    ? `(${(mobileAsset.size / 1048576).toFixed(1)} MB)`
    : '(4.0 MB)';

  return (
    <section id="downloads" className="py-24 bg-nv-bg2/80 border-t border-white/5 relative z-10">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest text-nv-primary bg-nv-primary/10 border border-nv-primary/30 mb-3">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>GitHub Releases · {releaseTag}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Equip Your Devices</h2>
          <p className="text-nv-muted mt-3">Free, open-source, and offline-capable. Downloads are distributed securely via GitHub Releases.</p>
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
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-6 rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-nv-primary to-nv-accent hover:opacity-90 transition shadow-glow flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Desktop {desktopSize}
              </a>
              <div className="flex items-center justify-between text-[11px] text-nv-muted font-mono mt-3 px-1">
                <span>Requires glibc 2.31+</span>
                <a
                  href={GITHUB_RELEASES_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-nv-primary hover:underline flex items-center gap-1"
                >
                  GitHub Releases ↗
                </a>
              </div>
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
                href={mobileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-6 rounded-lg text-sm font-mono font-bold uppercase tracking-wider text-white bg-nv-surface border border-white/20 hover:border-nv-accent hover:bg-nv-surface2 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 text-nv-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Download Android APK {mobileSize}
              </a>
              <div className="flex items-center justify-between text-[11px] text-nv-muted font-mono mt-3 px-1">
                <span>Android 8.0+ · Debug build</span>
                <a
                  href={GITHUB_RELEASES_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-nv-accent hover:underline flex items-center gap-1"
                >
                  GitHub Releases ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* GitHub Releases Hub Bar */}
        <div className="mt-12 p-6 rounded-xl bg-black/40 border border-white/5 font-mono text-xs text-nv-muted flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-nv-primary animate-pulse"></span>
            <span>All official binaries hosted on <strong className="text-white">GitHub Releases</strong></span>
          </div>
          <a
            href={GITHUB_RELEASES_PAGE}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded bg-white/5 hover:bg-nv-primary/20 text-nv-text hover:text-white border border-white/10 hover:border-nv-primary/50 transition flex items-center gap-2"
          >
            <span>View All Releases on GitHub</span>
            <span>↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
