import React from 'react';

export default function Footer() {
  return (
    <footer className="py-12 border-t border-white/5 bg-nv-bg text-nv-muted font-mono text-xs">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-nv-primary shadow-[0_0_8px_#00ff9d]"></span>
          <span className="text-white font-bold">NexVault</span>
          <span>— local-first. nothing in between.</span>
        </div>

        <div className="flex items-center gap-6">
          <a href="#features" className="hover:text-nv-primary transition">Features</a>
          <a href="#architecture" className="hover:text-nv-primary transition">Architecture</a>
          <a href="#downloads" className="hover:text-nv-primary transition">Downloads</a>
          <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition">Source Code</a>
        </div>
      </div>
    </footer>
  );
}

