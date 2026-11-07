import React from 'react';
import { useReleaseInfo, GITHUB_REPO } from '../useReleaseInfo.js';

export default function Footer() {
  const releaseInfo = useReleaseInfo();
  const tag = releaseInfo.tag;
  const desktopSize = releaseInfo.desktop?.size || 'Unavailable';
  const mobileSize = releaseInfo.mobile?.size || 'Unavailable';

  return (
    <footer className="py-10 sm:py-12 border-t border-dw-border bg-dw-bg text-dw-muted font-mono text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
          <span className="w-2 h-2 rounded-full bg-dw-green"></span>
          <span className="text-white font-bold">NexVault {tag}</span>
          <span className="text-dw-dim">
            — Zero cloud servers. Linux ({desktopSize}) &amp; Android ({mobileSize}).
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 text-[11px]">
          <a href="#features" className="hover:text-dw-green transition">
            Capabilities
          </a>
          <a href="#architecture" className="hover:text-dw-cyan transition">
            Protocol
          </a>
          <a href="#downloads" className="hover:text-white transition">
            Downloads
          </a>
          <a href="#release-strategy" className="hover:text-dw-green transition">
            Update Pipeline
          </a>
          <a
            href={`https://github.com/${GITHUB_REPO}`}
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
