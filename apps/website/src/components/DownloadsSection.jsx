import React, { useState } from 'react';
import { useReleaseInfo } from '../useReleaseInfo.js';

const GITHUB_REPO = 'yousseflashin/nextvault';
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;

export default function DownloadsSection() {
  const releaseInfo = useReleaseInfo();
  const [copiedKey, setCopiedKey] = useState(null);

  const releaseTag = releaseInfo.tag || 'Release metadata unavailable';
  const desktopUrl = releaseInfo.desktop?.url || GITHUB_RELEASES_PAGE;
  const desktopSize = releaseInfo.desktop?.size ? `(${releaseInfo.desktop.size})` : '';
  const desktopFilename = releaseInfo.desktop?.filename || 'NexVault.AppImage';
  const mobileUrl = releaseInfo.mobile?.url || GITHUB_RELEASES_PAGE;
  const mobileSize = releaseInfo.mobile?.size ? `(${releaseInfo.mobile.size})` : '';
  const verifyCmd = `sha256sum ${desktopFilename}`;
  const installCommand = `chmod +x ${desktopFilename} && ./${desktopFilename}`;

  const handleCopy = (text, key) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  return (
    <section id="downloads" className="py-24 bg-dw-bg2/90 border-t border-dw-border relative z-10">
      <div className="max-w-5xl mx-auto px-6">
        
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest text-dw-green bg-dw-surface border border-dw-border mb-3">
            <span>OFFICIAL RELEASES · {releaseTag}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Equip Your Hardware Enclave</h2>
          <p className="text-dw-muted mt-3">Free, open-source, and air-gap capable. Distributed securely via GitHub Releases with verifiable binary checksums.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          
          {/* Desktop Linux Card */}
          <div className="p-8 rounded-2xl bg-dw-surface/90 border border-dw-border hover:border-dw-green/50 transition flex flex-col justify-between group shadow-deep">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono uppercase tracking-wider text-dw-green px-2.5 py-1 rounded bg-dw-green/10 border border-dw-green/20">
                  DESKTOP MESH NODE
                </span>
                <span className="text-xs text-dw-muted font-mono">Linux · x86_64 AppImage</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Desktop Node (Linux)</h3>
              <p className="text-sm text-dw-muted mb-6 leading-relaxed">
                Autonomous workstation mesh node: full encrypted vault, live TOTP authenticator, peer-to-peer WebRTC mesh sync, and local IPC bridge for browser autofill.
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-6 rounded-lg text-xs font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-dw-green to-dw-cyan hover:opacity-90 transition shadow-glow flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download Desktop Node {desktopSize}</span>
              </a>

              <div className="p-2.5 rounded bg-black/60 border border-dw-border font-mono text-[11px] flex items-center justify-between gap-2">
                <span className="text-dw-dim truncate">Run: <strong className="text-dw-text">chmod +x *.AppImage && ./*.AppImage</strong></span>
                <button
                  onClick={() => handleCopy(installCommand, 'desktop-cmd')}
                  className="text-dw-muted hover:text-dw-green text-[10px] shrink-0"
                >
                  {copiedKey === 'desktop-cmd' ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-dw-muted font-mono px-1">
                <span>Requires glibc 2.31+</span>
                <a
                  href={GITHUB_RELEASES_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dw-green hover:underline flex items-center gap-1"
                >
                  GitHub Releases ↗
                </a>
              </div>
            </div>
          </div>

          {/* Android Mobile Card */}
          <div className="p-8 rounded-2xl bg-dw-surface/90 border border-dw-border hover:border-dw-cyan/50 transition flex flex-col justify-between group shadow-deep">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono uppercase tracking-wider text-dw-cyan px-2.5 py-1 rounded bg-dw-cyan/10 border border-dw-cyan/20">
                  MOBILE MESH NODE
                </span>
                <span className="text-xs text-dw-muted font-mono">Android · APK</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Mobile Node (Android)</h3>
              <p className="text-sm text-dw-muted mb-6 leading-relaxed">
                Autonomous mobile mesh node: carry your encrypted keys anywhere. Directly syncs across your device mesh over encrypted peer-to-peer WebRTC channels without any centralized servers or desktop reliance.
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={mobileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-6 rounded-lg text-xs font-mono font-bold uppercase tracking-wider text-white bg-dw-surface2 border border-dw-border hover:border-dw-cyan hover:bg-dw-surface transition flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4 text-dw-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Download Mobile Node APK {mobileSize}</span>
              </a>

              <div className="p-2.5 rounded bg-black/60 border border-dw-border font-mono text-[11px] flex items-center justify-between gap-2">
                <span className="text-dw-dim truncate">ADB: <strong className="text-dw-text">adb install -r NexVault-mobile-app-debug.apk</strong></span>
                <button
                  onClick={() => handleCopy('adb install -r NexVault-mobile-app-debug.apk', 'mobile-cmd')}
                  className="text-dw-muted hover:text-dw-cyan text-[10px] shrink-0"
                >
                  {copiedKey === 'mobile-cmd' ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-dw-muted font-mono px-1">
                <span>Android 8.0+</span>
                <a
                  href={GITHUB_RELEASES_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dw-cyan hover:underline flex items-center gap-1"
                >
                  GitHub Releases ↗
                </a>
              </div>
            </div>
          </div>

        </div>

        {/* Cryptographic Verification Hub Bar */}
        <div className="p-6 rounded-xl bg-dw-surface/80 border border-dw-border font-mono text-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-dw-green animate-pulse"></span>
            <span className="text-dw-muted">
              Verify Integrity: <strong className="text-white select-all">{verifyCmd}</strong>
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleCopy(verifyCmd, 'verify')}
              className="px-3 py-1.5 rounded bg-white/5 hover:bg-dw-green/20 text-dw-muted hover:text-dw-green border border-white/10 hover:border-dw-green/40 transition text-[11px]"
            >
              {copiedKey === 'verify' ? '✓ Copied' : 'Copy Verify Command'}
            </button>
            <a
              href={GITHUB_RELEASES_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-1.5 rounded bg-dw-surface2 hover:bg-dw-surface text-white border border-dw-border hover:border-dw-green/40 transition flex items-center gap-1.5"
            >
              <span>View All Releases</span>
              <span>↗</span>
            </a>
          </div>
        </div>

      </div>
    </section>
  );
}
