import React, { useState } from 'react';
import {
  useReleaseInfo,
  useClientPlatform,
  GITHUB_RELEASES_URL,
  GITHUB_ACTIONS_URL
} from '../useReleaseInfo.js';

export default function DownloadsSection() {
  const releaseInfo = useReleaseInfo();
  const { recommended, osLabel } = useClientPlatform();
  const [copiedKey, setCopiedKey] = useState(null);
  const [mobileFilter, setMobileFilter] = useState('all'); // 'all' | 'desktop' | 'mobile'

  const releaseTag = releaseInfo.tag || 'v0.1.30';
  const releaseUrl = releaseInfo.releaseUrl || GITHUB_RELEASES_URL;
  const publishedDate = releaseInfo.publishedAt
    ? new Date(releaseInfo.publishedAt).toISOString().slice(0, 10)
    : null;

  const desktop = releaseInfo.desktop || {};
  const desktopUrl = desktop.url || GITHUB_RELEASES_URL;
  const desktopSize = desktop.size || 'Unavailable';
  const desktopSizeExact = desktop.sizeExact || 'Unavailable';
  const desktopFilename = desktop.filename || `NexVault-${releaseInfo.version}.AppImage`;
  const desktopSha = desktop.sha256 || '';
  const desktopReqs = desktop.requirements || 'Linux x86_64 · glibc 2.35+';
  const desktopInstallCmd = `chmod +x ${desktopFilename} && ./${desktopFilename}`;

  const mobile = releaseInfo.mobile || {};
  const mobileUrl = mobile.url || GITHUB_RELEASES_URL;
  const mobileSize = mobile.size || 'Unavailable';
  const mobileSizeExact = mobile.sizeExact || 'Unavailable';
  const mobileFilename = mobile.filename || `NexVault-${releaseInfo.version}.apk`;
  const mobileSha = mobile.sha256 || '';
  const mobileReqs = mobile.requirements || 'Android 7.0+ (API 24+)';
  const mobileInstallCmd = `adb install -r ${mobileFilename}`;

  const verifyBothCmd = `sha256sum ${desktopFilename} ${mobileFilename}`;

  const handleCopy = (text, key) => {
    if (navigator?.clipboard && text) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  return (
    <section id="downloads" className="py-16 sm:py-24 bg-dw-bg2/90 border-t border-dw-border relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
          <div className="inline-flex flex-wrap items-center justify-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-widest text-dw-green bg-dw-surface border border-dw-border mb-4">
            <span className="w-2 h-2 rounded-full bg-dw-green animate-pulse"></span>
            <span>OFFICIAL RELEASE MANIFEST · {releaseTag}</span>
            {publishedDate && <span className="text-dw-dim">({publishedDate})</span>}
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Equip Your Hardware Enclave
          </h2>
          <p className="text-sm sm:text-base text-dw-muted mt-3 leading-relaxed">
            Free, open-source (GPL-3.0), and air-gap capable. Every binary size and SHA-256 digest below is measured directly from the release build artifacts.
          </p>

          {/* Mobile Viewport Platform Filter Pills */}
          <div className="md:hidden mt-6 inline-flex p-1 rounded-xl bg-dw-surface border border-dw-border font-mono text-xs">
            <button
              type="button"
              onClick={() => setMobileFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                mobileFilter === 'all' ? 'bg-dw-surface2 text-white border border-dw-borderHover' : 'text-dw-muted'
              }`}
            >
              Both ({desktopSize} / {mobileSize})
            </button>
            <button
              type="button"
              onClick={() => setMobileFilter('mobile')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                mobileFilter === 'mobile' ? 'bg-dw-cyan/20 text-dw-cyan border border-dw-cyan/40' : 'text-dw-muted'
              }`}
            >
              Android APK
            </button>
            <button
              type="button"
              onClick={() => setMobileFilter('desktop')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                mobileFilter === 'desktop' ? 'bg-dw-green/20 text-dw-green border border-dw-green/40' : 'text-dw-muted'
              }`}
            >
              Linux Desktop
            </button>
          </div>
        </div>

        {/* Binary Release Cards (Responsive Order: Mobile-first when on Android, Side-by-Side on Desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 mb-10">
          {/* Desktop Linux Card */}
          <div
            className={`${
              mobileFilter === 'mobile' ? 'hidden md:flex' : 'flex'
            } ${
              recommended === 'mobile' ? 'order-2 md:order-1' : 'order-1'
            } p-5 sm:p-8 rounded-2xl cyber-card border transition flex-col justify-between group ${
              recommended === 'desktop'
                ? 'border-dw-green/50 shadow-glow'
                : 'border-dw-border hover:border-dw-green/50'
            }`}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-dw-green px-2.5 py-1 rounded bg-dw-green/10 border border-dw-green/25 font-bold">
                    DESKTOP MESH NODE
                  </span>
                  {recommended === 'desktop' && (
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-dw-green text-black font-extrabold">
                      Detected ({osLabel})
                    </span>
                  )}
                </div>
                <span className="text-xs text-dw-muted font-mono">Linux · x86_64 AppImage</span>
              </div>

              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h3 className="text-xl sm:text-2xl font-bold text-white">Desktop Node (Linux)</h3>
                <span className="font-mono text-sm font-extrabold text-dw-green shrink-0">
                  {desktopSize}
                </span>
              </div>

              <p className="text-sm text-dw-muted mb-5 leading-relaxed">
                Autonomous workstation mesh node: SQLCipher AES-256 vault, RFC 6238 TOTP authenticator, WebRTC P2P mesh sync, localhost browser extension bridge, and SHA-256 verified in-place AppImage auto-updates.
              </p>

              {/* Metadata Specification Table */}
              <div className="mb-6 p-3.5 rounded-xl bg-black/55 border border-dw-border font-mono text-[11px] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Artifact File:</span>
                  <span className="text-white font-bold truncate">{desktopFilename}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Measured Size:</span>
                  <span className="text-dw-green font-bold">
                    {desktopSize} <span className="text-dw-muted font-normal">({desktopSizeExact})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Requirements:</span>
                  <span className="text-dw-text text-right">{desktopReqs}</span>
                </div>
                {desktopSha && (
                  <div className="pt-2 border-t border-dw-border/70 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-dw-dim block text-[10px]">SHA-256 Checksum:</span>
                      <span className="text-dw-text truncate block select-all text-[10px]">
                        {desktopSha}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(desktopSha, 'desktop-sha')}
                      className="px-2.5 py-1 rounded bg-dw-green/10 hover:bg-dw-green/20 text-dw-green border border-dw-green/30 text-[10px] font-bold shrink-0"
                    >
                      {copiedKey === 'desktop-sha' ? '✓ Copied' : 'Copy SHA-256'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <a
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-dw-green to-dw-cyan hover:opacity-90 transition shadow-glow flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download Desktop AppImage ({desktopSize})</span>
              </a>

              <div className="p-2.5 rounded-lg bg-black/65 border border-dw-border font-mono text-[11px] flex items-center justify-between gap-2">
                <span className="text-dw-dim truncate">
                  Run: <strong className="text-dw-text select-all">{desktopInstallCmd}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(desktopInstallCmd, 'desktop-cmd')}
                  className="text-dw-muted hover:text-dw-green text-[10px] font-bold shrink-0 px-2 py-0.5 rounded bg-white/5 border border-white/10"
                >
                  {copiedKey === 'desktop-cmd' ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-dw-muted font-mono px-1">
                <span>In-place ELF + SHA-256 auto-updater</span>
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dw-green hover:underline flex items-center gap-1"
                >
                  Release Notes ↗
                </a>
              </div>
            </div>
          </div>

          {/* Android Mobile Card */}
          <div
            className={`${
              mobileFilter === 'desktop' ? 'hidden md:flex' : 'flex'
            } ${
              recommended === 'mobile' ? 'order-1 md:order-2' : 'order-2'
            } p-5 sm:p-8 rounded-2xl cyber-card border transition flex-col justify-between group ${
              recommended === 'mobile'
                ? 'border-dw-cyan/60 shadow-glowCyan'
                : 'border-dw-border hover:border-dw-cyan/50'
            }`}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-dw-cyan px-2.5 py-1 rounded bg-dw-cyan/10 border border-dw-cyan/25 font-bold">
                    MOBILE MESH NODE
                  </span>
                  {recommended === 'mobile' && (
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-dw-cyan text-black font-extrabold">
                      Detected ({osLabel})
                    </span>
                  )}
                </div>
                <span className="text-xs text-dw-muted font-mono">Android · Universal APK</span>
              </div>

              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h3 className="text-xl sm:text-2xl font-bold text-white">Mobile Node (Android)</h3>
                <span className="font-mono text-sm font-extrabold text-dw-cyan shrink-0">
                  {mobileSize}
                </span>
              </div>

              <p className="text-sm text-dw-muted mb-5 leading-relaxed">
                Autonomous mobile mesh node: carry your encrypted vault and TOTP 2FA anywhere. Features native Android AutofillService, QR pairing, X25519 WebRTC sync, and SHA-256 + certificate-verified APK updates.
              </p>

              {/* Metadata Specification Table */}
              <div className="mb-6 p-3.5 rounded-xl bg-black/55 border border-dw-border font-mono text-[11px] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Artifact File:</span>
                  <span className="text-white font-bold truncate">{mobileFilename}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Measured Size:</span>
                  <span className="text-dw-cyan font-bold">
                    {mobileSize} <span className="text-dw-muted font-normal">({mobileSizeExact})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dw-dim">Requirements:</span>
                  <span className="text-dw-text text-right">{mobileReqs}</span>
                </div>
                {mobileSha && (
                  <div className="pt-2 border-t border-dw-border/70 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-dw-dim block text-[10px]">SHA-256 Checksum:</span>
                      <span className="text-dw-text truncate block select-all text-[10px]">
                        {mobileSha}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(mobileSha, 'mobile-sha')}
                      className="px-2.5 py-1 rounded bg-dw-cyan/10 hover:bg-dw-cyan/20 text-dw-cyan border border-dw-cyan/30 text-[10px] font-bold shrink-0"
                    >
                      {copiedKey === 'mobile-sha' ? '✓ Copied' : 'Copy SHA-256'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <a
                href={mobileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full py-3.5 px-5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 ${
                  recommended === 'mobile'
                    ? 'text-black bg-gradient-to-r from-dw-cyan to-dw-green shadow-glowCyan'
                    : 'text-white bg-dw-surface2 border border-dw-border hover:border-dw-cyan hover:bg-dw-surface'
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Download Android APK ({mobileSize})</span>
              </a>

              <div className="p-2.5 rounded-lg bg-black/65 border border-dw-border font-mono text-[11px] flex items-center justify-between gap-2">
                <span className="text-dw-dim truncate">
                  ADB: <strong className="text-dw-text select-all">{mobileInstallCmd}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(mobileInstallCmd, 'mobile-cmd')}
                  className="text-dw-muted hover:text-dw-cyan text-[10px] font-bold shrink-0 px-2 py-0.5 rounded bg-white/5 border border-white/10"
                >
                  {copiedKey === 'mobile-cmd' ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-dw-muted font-mono px-1">
                <span>Certificate + SHA-256 APK verifier</span>
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dw-cyan hover:underline flex items-center gap-1"
                >
                  Release Notes ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Cryptographic Verification Hub Bar */}
        <div className="p-4 sm:p-6 rounded-2xl cyber-card border border-dw-border font-mono text-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 mb-12">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-dw-green animate-pulse shrink-0"></span>
            <div className="min-w-0">
              <span className="text-dw-muted block text-[11px]">
                Verify Downloaded Artifacts Against <code className="text-dw-cyan">SHA256SUMS.txt</code>:
              </span>
              <strong className="text-white select-all truncate block mt-0.5">{verifyBothCmd}</strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleCopy(verifyBothCmd, 'verify')}
              className="px-3.5 py-2 rounded-lg bg-white/5 hover:bg-dw-green/20 text-dw-muted hover:text-dw-green border border-white/10 hover:border-dw-green/40 transition text-[11px] font-bold"
            >
              {copiedKey === 'verify' ? '✓ Copied Command' : 'Copy Verify Command'}
            </button>
            <a
              href="/release-info.json"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-lg bg-dw-surface2 hover:bg-dw-surface text-dw-cyan border border-dw-border hover:border-dw-cyan/40 transition text-[11px] font-bold"
            >
              release-info.json ↗
            </a>
            <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-dw-surface2 hover:bg-dw-surface text-white border border-dw-border hover:border-dw-green/40 transition flex items-center gap-1.5 text-[11px] font-bold"
            >
              <span>All GitHub Releases</span>
              <span>↗</span>
            </a>
          </div>
        </div>

        {/* Section 04: Release & Auto-Update Architecture */}
        <div id="release-strategy" className="p-5 sm:p-8 rounded-2xl cyber-card border border-dw-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-6 mb-6 border-b border-dw-border">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-dw-cyan block mb-1">
                DETERMINISTIC RELEASE &amp; UPDATE PIPELINE
              </span>
              <h3 className="text-xl sm:text-2xl font-extrabold text-white">
                End-to-End Cryptographic Release Strategy
              </h3>
            </div>
            <a
              href={GITHUB_ACTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-dw-surface2 border border-dw-border hover:border-dw-green/40 font-mono text-xs text-dw-green transition self-start sm:self-auto"
            >
              <span>Inspect GitHub Actions Pipeline</span>
              <span>↗</span>
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
            <div className="p-4 rounded-xl bg-black/50 border border-dw-border">
              <div className="flex items-center justify-between text-dw-green font-bold mb-2">
                <span>01 // UNIFIED VERSION</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-dw-green/10">GIT TAG</span>
              </div>
              <p className="text-dw-muted text-[11px] leading-relaxed font-sans">
                A single <code className="font-mono text-white">npm run release</code> synchronizes semver across Desktop, Mobile Gradle, Extension manifests, and Website, then pushes an annotated <code className="font-mono text-dw-green">{releaseTag}</code> tag.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-dw-border">
              <div className="flex items-center justify-between text-dw-cyan font-bold mb-2">
                <span>02 // CI BUILD &amp; SIGN</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-dw-cyan/10">ISOLATED</span>
              </div>
              <p className="text-dw-muted text-[11px] leading-relaxed font-sans">
                GitHub Actions compiles the Linux x86_64 AppImage and signs the Android release APK (<code className="font-mono text-white">apksigner verify</code>) inside clean ephemeral runners.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-dw-border">
              <div className="flex items-center justify-between text-dw-green font-bold mb-2">
                <span>03 // REAL MANIFEST</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-dw-green/10">SCHEMA V2</span>
              </div>
              <p className="text-dw-muted text-[11px] leading-relaxed font-sans">
                Actual byte sizes ({desktopSize} &amp; {mobileSize}) and SHA-256 digests are measured from the compiled artifacts into <code className="font-mono text-white">release-info.json</code> and <code className="font-mono text-white">SHA256SUMS.txt</code>.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-dw-border">
              <div className="flex items-center justify-between text-dw-cyan font-bold mb-2">
                <span>04 // VERIFIED UPDATE</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-dw-cyan/10">SHA-256</span>
              </div>
              <p className="text-dw-muted text-[11px] leading-relaxed font-sans">
                Desktop and Android updaters enforce an HTTPS GitHub host allowlist, verify exact byte length + SHA-256 hash, and check ELF/APK signing certificates before applying updates.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
