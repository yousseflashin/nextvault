import React from 'react';

export default function Footer() {
  return (
    <footer className="py-12 border-t border-dw-border bg-dw-bg text-dw-muted font-mono text-xs">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-dw-green"></span>
          <span className="text-white font-bold">NexVault</span>
          <span className="text-dw-dim">— Zero cloud servers. Zero cookies. Zero trackers.</span>
        </div>

        <div className="flex items-center gap-6 text-[11px]">
          <a href="#features" className="hover:text-dw-green transition">Capabilities</a>
          <a href="#architecture" className="hover:text-dw-cyan transition">Protocol</a>
          <a href="#downloads" className="hover:text-white transition">Downloads</a>
          <a
            href="https://github.com/yousseflashin/nextvault"
            target="_blank"
            rel="noreferrer"
            className="text-dw-green hover:underline flex items-center gap-1"
          >
            <span>GitHub</span>
            <span>↗</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
