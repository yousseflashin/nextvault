import React, { useEffect, useRef, useState } from 'react';

const STAGE_DESCRIPTIONS = [
  'Matrix binary streams converging into full shield & hooded hacker behind laptop (facing hacker)...',
  'Terminal overcharge: upward screen light cone & atmospheric shockwave...',
  'Solidifying into dark realism titanium-carbon armor with glowing lid emblem...',
  'Continuous stealth orbital data streams & rain deflection field.'
];

export default function CyberShieldHero() {
  const canvasRef = useRef(null);
  const heroRef = useRef(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [stageName, setStageName] = useState('MATRIX CONVERGENCE');
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const init = () => {
      if (window.NexVaultFX?.startShieldAnimation) {
        window.NexVaultFX.startShieldAnimation(canvas);
        if (canvas.__nv_set_stage_listener) {
          canvas.__nv_set_stage_listener((idx, name) => {
            setStageIdx(idx);
            setStageName(name);
          });
        }
      }
    };

    if (window.NexVaultFX) {
      init();
    } else {
      const timer = setTimeout(init, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // Replay animation automatically when user scrolls away and returns to top
  useEffect(() => {
    const heroEl = heroRef.current;
    if (!heroEl) return;

    let hasScrolledAway = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            hasScrolledAway = true;
          } else if (hasScrolledAway && entry.isIntersecting) {
            hasScrolledAway = false;
            if (canvasRef.current?.__nv_replay) {
              canvasRef.current.__nv_replay();
            }
          }
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(heroEl);
    return () => observer.disconnect();
  }, []);

  const handleReplay = () => {
    if (canvasRef.current?.__nv_replay) {
      setReplaying(true);
      canvasRef.current.__nv_replay();
      setTimeout(() => setReplaying(false), 500);
    }
  };

  return (
    <section ref={heroRef} className="relative min-h-[92vh] flex items-center justify-center overflow-hidden pt-8 pb-16">
      {/* Background ambient radial glow & cyber grid */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-nv-primary/15 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[350px] bg-nv-accent/15 blur-[100px] pointer-events-none rounded-full" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,157,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,157,0.03)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none opacity-60" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
          
          {/* Left Column: Value Proposition & CTAs */}
          <div className="lg:col-span-6 xl:col-span-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono tracking-wider uppercase text-nv-primary bg-black/60 backdrop-blur-md border border-nv-primary/40 mb-6 shadow-glow">
              <span className="w-2 h-2 rounded-full bg-nv-primary animate-ping"></span>
              <span>NexVault 2.0 · Local-First Security</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
              Local-first security. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-nv-primary via-nv-accent to-white">
                Zero cloud storage.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-nv-muted mb-8 leading-relaxed font-sans max-w-xl">
              NexVault keeps passwords and OTP secrets locked inside your own hardware with SQLCipher + AES-256.
              Devices discover each other over local WebSockets and sync directly through an encrypted WebRTC mesh.
            </p>

            <div className="flex flex-wrap items-center gap-4 font-mono text-sm mb-12">
              <a
                href="#downloads"
                className="px-6 py-3.5 rounded-lg font-bold text-black bg-gradient-to-r from-nv-primary to-nv-accent hover:opacity-90 transition shadow-glow flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download NexVault
              </a>
              <a
                href="#architecture"
                className="px-6 py-3.5 rounded-lg font-semibold text-nv-text bg-nv-surface/80 hover:bg-nv-surface border border-white/10 hover:border-nv-primary/50 transition backdrop-blur-md"
              >
                View Architecture
              </a>
            </div>

            {/* Quick Specs Grid */}
            <div className="grid grid-cols-2 gap-3 font-mono text-left max-w-lg">
              <div className="p-3 bg-black/40 rounded-lg border border-white/5 backdrop-blur-sm">
                <span className="text-[11px] text-nv-muted block uppercase tracking-wide">Crypto Core</span>
                <span className="text-sm font-bold text-nv-primary">SQLCipher + X25519</span>
              </div>
              <div className="p-3 bg-black/40 rounded-lg border border-white/5 backdrop-blur-sm">
                <span className="text-[11px] text-nv-muted block uppercase tracking-wide">P2P Network</span>
                <span className="text-sm font-bold text-nv-accent">WebRTC DataChannel</span>
              </div>
              <div className="p-3 bg-black/40 rounded-lg border border-white/5 backdrop-blur-sm">
                <span className="text-[11px] text-nv-muted block uppercase tracking-wide">Autofill Engine</span>
                <span className="text-sm font-bold text-nv-primary">1Password-Style Field</span>
              </div>
              <div className="p-3 bg-black/40 rounded-lg border border-white/5 backdrop-blur-sm">
                <span className="text-[11px] text-nv-muted block uppercase tracking-wide">Emergency Protocol</span>
                <span className="text-sm font-bold text-nv-accent">24h Tamper Nuke</span>
              </div>
            </div>
          </div>

          {/* Right Column: Prominent Dedicated Full Shield Showcase */}
          <div className="lg:col-span-6 xl:col-span-6 flex flex-col items-center">
            <div className="w-full max-w-[560px] relative rounded-2xl bg-gradient-to-b from-[#0a1220]/95 via-[#060b16]/95 to-[#040710]/98 border border-nv-primary/40 p-4 sm:p-5 shadow-[0_0_50px_rgba(0,255,157,0.18)]">
              
              {/* Corner Sci-Fi Accent Brackets */}
              <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-nv-primary pointer-events-none" />
              <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-nv-primary pointer-events-none" />
              <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-nv-primary pointer-events-none" />
              <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-nv-primary pointer-events-none" />

              {/* Console Header Bar */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-nv-primary animate-pulse" />
                  <span className="text-nv-primary font-bold tracking-wider">DEFENSE CORE // HUD</span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Dynamic Stage Pill */}
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-nv-primary/10 text-nv-primary border border-nv-primary/40">
                    STAGE {stageIdx + 1}/4: {stageName}
                  </span>

                  {/* Replay Sequence Button */}
                  <button
                    onClick={handleReplay}
                    disabled={replaying}
                    title="Replay Full Shield Animation"
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-nv-primary/20 text-nv-text hover:text-white border border-white/10 hover:border-nv-primary/50 transition font-mono text-[11px]"
                  >
                    <span className={replaying ? 'animate-spin' : ''}>↺</span>
                    <span>Replay</span>
                  </button>
                </div>
              </div>

              {/* Full Shield Interactive Canvas */}
              <div className="relative w-full h-[440px] sm:h-[480px] bg-[#04060c] rounded-xl overflow-hidden border border-white/10 shadow-inner">
                <canvas
                  ref={canvasRef}
                  data-nv-binary-shield
                  className="w-full h-full cursor-pointer block"
                />

                {/* Subtitle Telemetry overlay at bottom inside canvas */}
                <div className="absolute bottom-3 left-3 right-3 pointer-events-none flex items-center justify-between font-mono text-[11px] text-nv-muted/80 bg-black/60 px-3 py-1.5 rounded border border-white/10">
                  <span className="truncate pr-2">{STAGE_DESCRIPTIONS[stageIdx]}</span>
                  <span className="text-nv-primary shrink-0 hidden sm:inline">Deflection: 100%</span>
                </div>
              </div>

              {/* Console Footer Telemetry */}
              <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between text-[11px] font-mono text-nv-muted gap-2">
                <div className="flex items-center gap-3">
                  <span>ARMOR: <strong className="text-white">TITANIUM-3D</strong></span>
                  <span>•</span>
                  <span>ORBIT: <strong className="text-nv-accent">ACTIVE DUAL-SPIN</strong></span>
                </div>
                <div className="text-[10px] text-nv-primary/70">
                  ⚡ Click shield to pulse shockwave
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
