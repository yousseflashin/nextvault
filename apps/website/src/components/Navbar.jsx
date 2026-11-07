import React, { useState } from 'react';
import { useReleaseInfo, useClientPlatform, GITHUB_REPO } from '../useReleaseInfo.js';

export default function Navbar() {
  const releaseInfo = useReleaseInfo();
  const clientPlatform = useClientPlatform();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentTag = releaseInfo.tag;
  const desktopSize = releaseInfo.desktop?.size || 'Unavailable';
  const mobileSize = releaseInfo.mobile?.size || 'Unavailable';
  const desktopUrl = releaseInfo.desktop?.url || '#downloads';
  const mobileUrl = releaseInfo.mobile?.url || '#downloads';

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-dw-bg/85 border-b border-dw-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <a href="#" className="flex items-center gap-2.5 group shrink-0" onClick={closeMenu}>
          <div className="w-8 h-8 rounded-lg bg-dw-surface2 border border-dw-border group-hover:border-dw-green/60 transition flex items-center justify-center p-1 shadow-glow">
            <img src="/icon.png" alt="NexVault" className="w-full h-full rounded object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="font-sans font-extrabold text-base tracking-tight text-white leading-none">
              Nex<span className="text-dw-green">Vault</span>
              <span className="hidden sm:inline text-dw-dim ml-1.5 text-[11px] font-mono font-normal">
                // ZERO-CLOUD
              </span>
            </span>
            <span className="text-[10px] font-mono text-dw-muted mt-0.5">
              {currentTag} · {desktopSize} / {mobileSize}
            </span>
          </div>
        </a>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-mono text-dw-muted">
          <a href="#features" className="hover:text-dw-green transition py-1">
            [ 01. Capabilities ]
          </a>
          <a href="#architecture" className="hover:text-dw-cyan transition py-1">
            [ 02. Protocol ]
          </a>
          <a href="#downloads" className="hover:text-white transition py-1">
            [ 03. Releases ]
          </a>
          <a href="#release-strategy" className="hover:text-dw-green transition py-1">
            [ 04. Update Pipeline ]
          </a>
        </nav>

        {/* Status Pill, Action & Mobile Menu Button */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <span className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-mono text-dw-green bg-dw-surface border border-dw-border">
            <span className="w-1.5 h-1.5 rounded-full bg-dw-green animate-pulse"></span>
            <span>SHA-256 VERIFIED</span>
          </span>

          <a
            href="#downloads"
            onClick={closeMenu}
            className="px-3.5 sm:px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-dw-green to-dw-cyan hover:opacity-90 transition shadow-glow flex items-center gap-1.5"
          >
            <span>Get {currentTag}</span>
            <span className="hidden sm:inline text-[10px] opacity-80">
              ({clientPlatform.recommended === 'mobile' ? mobileSize : desktopSize})
            </span>
          </a>

          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-2 rounded-lg bg-dw-surface border border-dw-border hover:border-dw-green/50 text-dw-text transition"
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5 text-dw-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-dw-border bg-dw-bg2/95 backdrop-blur-xl px-4 pt-3 pb-5 space-y-4">
          {/* Detected Platform Telemetry Pill */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-dw-surface border border-dw-border font-mono text-[11px]">
            <span className="text-dw-muted">Detected Environment:</span>
            <span className="text-dw-cyan font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-dw-cyan"></span>
              {clientPlatform.osLabel}
            </span>
          </div>

          {/* Mobile Nav Links */}
          <nav className="grid grid-cols-2 gap-2 font-mono text-xs">
            <a
              href="#features"
              onClick={closeMenu}
              className="p-2.5 rounded-lg bg-dw-surface/80 border border-dw-border hover:border-dw-green/40 text-dw-text hover:text-dw-green transition"
            >
              <span className="text-dw-dim block text-[10px]">SECTION 01</span>
              <span className="font-bold">Capabilities</span>
            </a>
            <a
              href="#architecture"
              onClick={closeMenu}
              className="p-2.5 rounded-lg bg-dw-surface/80 border border-dw-border hover:border-dw-cyan/40 text-dw-text hover:text-dw-cyan transition"
            >
              <span className="text-dw-dim block text-[10px]">SECTION 02</span>
              <span className="font-bold">Wire Protocol</span>
            </a>
            <a
              href="#downloads"
              onClick={closeMenu}
              className="p-2.5 rounded-lg bg-dw-surface/80 border border-dw-border hover:border-dw-green/40 text-dw-text hover:text-white transition"
            >
              <span className="text-dw-dim block text-[10px]">SECTION 03</span>
              <span className="font-bold">Downloads ({currentTag})</span>
            </a>
            <a
              href="#release-strategy"
              onClick={closeMenu}
              className="p-2.5 rounded-lg bg-dw-surface/80 border border-dw-border hover:border-dw-cyan/40 text-dw-text hover:text-dw-cyan transition"
            >
              <span className="text-dw-dim block text-[10px]">SECTION 04</span>
              <span className="font-bold">Update Pipeline</span>
            </a>
          </nav>

          {/* Direct Binary Download Shortcuts for Mobile & Desktop */}
          <div className="pt-2 border-t border-dw-border space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-dw-muted px-1">
              Direct Verified Binaries · {currentTag}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
              <a
                href={mobileUrl}
                onClick={closeMenu}
                className={`p-3 rounded-lg border flex items-center justify-between transition ${
                  clientPlatform.recommended === 'mobile'
                    ? 'bg-dw-cyan/15 border-dw-cyan/50 text-white'
                    : 'bg-dw-surface border-dw-border text-dw-text'
                }`}
              >
                <span className="font-bold">Android Node (.APK)</span>
                <span className="text-dw-cyan text-[11px]">{mobileSize}</span>
              </a>
              <a
                href={desktopUrl}
                onClick={closeMenu}
                className={`p-3 rounded-lg border flex items-center justify-between transition ${
                  clientPlatform.recommended === 'desktop'
                    ? 'bg-dw-green/15 border-dw-green/50 text-white'
                    : 'bg-dw-surface border-dw-border text-dw-text'
                }`}
              >
                <span className="font-bold">Linux Desktop (.AppImage)</span>
                <span className="text-dw-green text-[11px]">{desktopSize}</span>
              </a>
            </div>
            <a
              href={`https://github.com/${GITHUB_REPO}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center py-2 text-[11px] font-mono text-dw-muted hover:text-dw-green transition"
            >
              Inspect GitHub Releases &amp; SHA256SUMS.txt ↗
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
