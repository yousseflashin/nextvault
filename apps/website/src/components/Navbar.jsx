import React from 'react';
import releaseInfo from '../release-info.json';

export default function Navbar() {
  const currentTag = releaseInfo.tag || `v${releaseInfo.version || '0.1.1'}`;

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-dw-bg/90 border-b border-dw-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        
        {/* Brand */}
        <a href="#" className="flex items-center gap-3 group">
          <div className="w-7 h-7 rounded-lg bg-dw-surface border border-dw-border flex items-center justify-center text-dw-green font-mono font-bold group-hover:border-dw-green/40 transition">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-dw-green">
              <path d="M12 2L4 6V12C4 17.5 7.4 22.6 12 24C16.6 22.6 20 17.5 20 12V6L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 12L11 14L15 10" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-mono font-extrabold text-base tracking-tight text-white">
            NEX<span className="text-dw-green">VAULT</span>
            <span className="text-dw-dim ml-1.5 text-xs font-normal">// 0-CLOUD</span>
          </span>
        </a>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs font-mono text-dw-muted">
          <a href="#features" className="hover:text-dw-green transition">[ 01. Capabilities ]</a>
          <a href="#architecture" className="hover:text-dw-cyan transition">[ 02. Protocol ]</a>
          <a href="#downloads" className="hover:text-white transition">[ 03. Releases ]</a>
        </nav>

        {/* Status Pill & Action */}
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-mono text-dw-green bg-dw-surface border border-dw-border">
            <span className="w-1.5 h-1.5 rounded-full bg-dw-green animate-pulse"></span>
            <span>AIR-GAP READY</span>
          </span>

          <a
            href="#downloads"
            className="px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-dw-green to-dw-cyan hover:opacity-90 transition shadow-glow"
          >
            Get {currentTag}
          </a>
        </div>

      </div>
    </header>
  );
}
