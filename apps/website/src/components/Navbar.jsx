import React from 'react';
import { useReleaseInfo } from '../useReleaseInfo.js';

export default function Navbar() {
  const releaseInfo = useReleaseInfo();
  const currentTag = releaseInfo.tag || 'Releases';

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-dw-bg/90 border-b border-dw-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        
        {/* Brand */}
        <a href="#" className="flex items-center gap-2.5 group">
          <img src="/icon.png" alt="NextVault" className="w-6 h-6 rounded-md object-contain" />
          <span className="font-sans font-bold text-base tracking-tight text-white">
            Next<span className="text-dw-green">Vault</span>
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
            <span className="w-1.5 h-1.5 rounded-full bg-dw-green"></span>
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
