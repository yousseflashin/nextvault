import React from 'react';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-nv-bg/80 border-b border-white/5">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-3 group">
          <div className="w-8 h-9 relative flex items-center justify-center">
            <svg viewBox="0 0 64 74" fill="none" className="w-full h-full drop-shadow-[0_0_8px_rgba(0,255,157,0.5)]">
              <path d="M32 2 60 14v22c0 18-12.6 30.4-28 36C16.6 66.4 4 54 4 36V14L32 2z" stroke="#00ff9d" strokeWidth="2.5" fill="rgba(0,255,157,0.06)" />
              <path d="M22 36l7 7 14-15" stroke="#00d4ff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-mono font-extrabold text-lg tracking-tight text-white">
            NEX<span className="text-nv-primary">VAULT</span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-nv-muted">
          <a href="#features" className="hover:text-nv-primary transition">Features</a>
          <a href="#architecture" className="hover:text-nv-primary transition">Architecture</a>
          <a href="#extension" className="hover:text-nv-primary transition">In-Field Autofill</a>
          <a href="#downloads" className="hover:text-nv-primary transition">Downloads</a>
        </nav>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono uppercase tracking-wider text-nv-primary bg-nv-primary/10 border border-nv-primary/30">
            <span className="w-2 h-2 rounded-full bg-nv-primary animate-pulse"></span>
            Zero Cloud
          </span>
          <a
            href="#downloads"
            className="px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider text-black bg-gradient-to-r from-nv-primary to-nv-accent hover:opacity-90 transition shadow-glow"
          >
            Get Vault
          </a>
        </div>
      </div>
    </header>
  );
}

