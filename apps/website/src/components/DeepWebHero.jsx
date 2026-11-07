import React, { useState, useEffect } from 'react';
import { useReleaseInfo, useClientPlatform, GITHUB_RELEASES_URL } from '../useReleaseInfo.js';
import DeepWebBackground from './DeepWebBackground.jsx';

export default function DeepWebHero() {
  const releaseInfo = useReleaseInfo();
  const {
    recommended,
    osLabel,
    selectedPlatform,
    setSelectedPlatform
  } = useClientPlatform();

  const [activeConsoleTab, setActiveConsoleTab] = useState('mesh');
  const [copiedText, setCopiedText] = useState(null);

  // Mesh simulator state
  const [syncCount, setSyncCount] = useState(14);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncHash, setLastSyncHash] = useState('7f4a...8e21');

  // Password generator state
  const [pwdLength, setPwdLength] = useState(24);
  const [generatedPwd, setGeneratedPwd] = useState('');
  const [entropyBits, setEntropyBits] = useState(144);

  // TOTP simulator state
  const [totpCode, setTotpCode] = useState('839 210');
  const [totpSeconds, setTotpSeconds] = useState(24);

  // Tamper nuke state
  const [tamperTriggered, setTamperTriggered] = useState(false);

  // Normalized release metadata
  const currentTag = releaseInfo.tag;
  const desktop = releaseInfo.desktop || {};
  const mobile = releaseInfo.mobile || {};

  const desktopUrl = desktop.url || GITHUB_RELEASES_URL;
  const desktopSize = desktop.size || 'Unavailable';
  const desktopFilename = desktop.filename || `NexVault-${releaseInfo.version}.AppImage`;
  const desktopSha = desktop.sha256 || '';

  const mobileUrl = mobile.url || GITHUB_RELEASES_URL;
  const mobileSize = mobile.size || 'Unavailable';
  const mobileFilename = mobile.filename || `NexVault-${releaseInfo.version}.apk`;
  const mobileSha = mobile.sha256 || '';

  const activeAsset = selectedPlatform === 'mobile' ? mobile : desktop;
  const activeCommand =
    selectedPlatform === 'mobile'
      ? `adb install -r ${mobileFilename}`
      : `chmod +x ${desktopFilename} && ./${desktopFilename}`;
  const activeSha = selectedPlatform === 'mobile' ? mobileSha : desktopSha;

  const handleCopy = (text, label) => {
    if (navigator?.clipboard && text) {
      navigator.clipboard.writeText(text);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const generatePassword = (len) => {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_+=';
    let res = '';
    const array = new Uint32Array(len);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(array);
      for (let i = 0; i < len; i++) {
        res += chars[array[i] % chars.length];
      }
    } else {
      for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    setGeneratedPwd(res);
    setEntropyBits(Math.round(len * 5.95));
  };

  useEffect(() => {
    generatePassword(pwdLength);
  }, [pwdLength]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTotpSeconds((prev) => {
        if (prev <= 1) {
          const newCode = Math.floor(100000 + Math.random() * 900000).toString();
          setTotpCode(`${newCode.slice(0, 3)} ${newCode.slice(3)}`);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setTimeout(() => {
      setSyncCount((c) => c + 1);
      const chars = '0123456789abcdef';
      let h = '';
      for (let i = 0; i < 8; i++) h += chars[Math.floor(Math.random() * chars.length)];
      setLastSyncHash(`${h}...${h.split('').reverse().join('')}`);
      setIsSyncing(false);
    }, 450);
  };

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden pt-6 sm:pt-10 pb-16 sm:pb-20 bg-dw-bg">
      <DeepWebBackground />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left Column: Sovereign Manifesto & Platform-Aware Downloads */}
          <div className="lg:col-span-6 text-left">
            {/* Top Status & Release Telemetry Badge */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-widest text-dw-green bg-dw-surface/90 border border-dw-border">
                <span className="w-2 h-2 rounded-full bg-dw-green animate-pulse"></span>
                <span>P2P MESH // ZERO-CLOUD AIRGAP</span>
              </div>
              <a
                href="#downloads"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-mono text-dw-cyan bg-dw-cyan/10 border border-dw-cyan/30 hover:border-dw-cyan transition"
              >
                <span>RELEASE {currentTag}</span>
                <span className="text-dw-dim">·</span>
                <span className="text-white">SHA-256 SIGNED</span>
              </a>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-white mb-5 leading-[1.1]">
              Decentralized key sovereignty. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-dw-green via-dw-cyan to-white font-mono">
                No Cloud. No Telemetry.
              </span>
            </h1>

            <p className="text-sm sm:text-base lg:text-lg text-dw-muted mb-6 leading-relaxed max-w-xl">
              NexVault secures your credentials and TOTP 2FA secrets inside a local SQLCipher AES-256 hardware enclave on{' '}
              <strong className="text-white font-semibold">Linux Desktop</strong> and{' '}
              <strong className="text-white font-semibold">Android Mobile</strong>. Devices sync peer-to-peer over X25519 WebRTC with verified in-app updates.
            </p>

            {/* Platform Target Switcher (Auto-detects Mobile vs Desktop) */}
            <div className="max-w-xl mb-6 p-4 rounded-2xl cyber-card border border-dw-border space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-dw-border font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-dw-muted">Target Enclave:</span>
                  <div className="inline-flex p-0.5 rounded-lg bg-black/60 border border-dw-border">
                    <button
                      type="button"
                      onClick={() => setSelectedPlatform('desktop')}
                      className={`px-2.5 py-1 rounded-md font-bold transition flex items-center gap-1.5 ${
                        selectedPlatform === 'desktop'
                          ? 'bg-dw-green/20 text-dw-green border border-dw-green/40'
                          : 'text-dw-muted hover:text-white'
                      }`}
                    >
                      <span>Linux Desktop</span>
                      <span className="text-[10px] opacity-80">({desktopSize})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlatform('mobile')}
                      className={`px-2.5 py-1 rounded-md font-bold transition flex items-center gap-1.5 ${
                        selectedPlatform === 'mobile'
                          ? 'bg-dw-cyan/20 text-dw-cyan border border-dw-cyan/40'
                          : 'text-dw-muted hover:text-white'
                      }`}
                    >
                      <span>Android APK</span>
                      <span className="text-[10px] opacity-80">({mobileSize})</span>
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-dw-dim">
                  Detected: <strong className="text-dw-text">{osLabel}</strong>
                </span>
              </div>

              {/* Dual Responsive Download CTA Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={desktopUrl}
                  onMouseEnter={() => setSelectedPlatform('desktop')}
                  className={`px-4 py-3.5 rounded-xl font-mono text-xs uppercase tracking-wider transition flex items-center justify-between gap-2 ${
                    selectedPlatform === 'desktop'
                      ? 'font-bold text-black bg-gradient-to-r from-dw-green to-dw-cyan shadow-glow'
                      : 'font-semibold text-dw-text bg-dw-surface hover:bg-dw-surface2 border border-dw-border hover:border-dw-green/50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <div className="text-left truncate">
                      <span className="block leading-tight">Desktop {currentTag}</span>
                      <span className={`block text-[10px] font-normal ${selectedPlatform === 'desktop' ? 'text-black/75' : 'text-dw-muted'}`}>
                        x86_64 AppImage · {desktopSize}
                      </span>
                    </div>
                  </div>
                  {recommended === 'desktop' && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                      selectedPlatform === 'desktop' ? 'bg-black/20 text-black' : 'bg-dw-green/15 text-dw-green'
                    }`}>
                      HOST
                    </span>
                  )}
                </a>

                <a
                  href={mobileUrl}
                  onMouseEnter={() => setSelectedPlatform('mobile')}
                  className={`px-4 py-3.5 rounded-xl font-mono text-xs uppercase tracking-wider transition flex items-center justify-between gap-2 ${
                    selectedPlatform === 'mobile'
                      ? 'font-bold text-black bg-gradient-to-r from-dw-cyan to-dw-green shadow-glowCyan'
                      : 'font-semibold text-dw-text bg-dw-surface hover:bg-dw-surface2 border border-dw-border hover:border-dw-cyan/50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <div className="text-left truncate">
                      <span className="block leading-tight">Android {currentTag}</span>
                      <span className={`block text-[10px] font-normal ${selectedPlatform === 'mobile' ? 'text-black/75' : 'text-dw-muted'}`}>
                        Signed APK · {mobileSize}
                      </span>
                    </div>
                  </div>
                  {recommended === 'mobile' && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                      selectedPlatform === 'mobile' ? 'bg-black/20 text-black' : 'bg-dw-cyan/15 text-dw-cyan'
                    }`}>
                      DEVICE
                    </span>
                  )}
                </a>
              </div>

              {/* Active Binary CLI & SHA-256 Telemetry Bar */}
              <div className="space-y-2 pt-1">
                <div className="p-2.5 rounded-lg bg-black/70 border border-dw-border font-mono text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-dw-muted min-w-0 flex-1">
                    <span className="text-dw-green select-none shrink-0">$</span>
                    <span className="text-dw-text truncate select-all text-[11px]">{activeCommand}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(activeCommand, 'cmd')}
                    className="px-2.5 py-1 rounded bg-white/5 hover:bg-dw-green/20 text-dw-muted hover:text-dw-green border border-white/10 hover:border-dw-green/40 transition shrink-0 text-[10px] font-bold"
                  >
                    {copiedText === 'cmd' ? '✓ Copied' : 'Copy CLI'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono text-dw-muted">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-dw-dim">Artifact:</span>
                    <span className="text-white font-semibold truncate">{activeAsset.filename}</span>
                    <span className="text-dw-dim">({activeAsset.sizeExact || activeAsset.size})</span>
                  </div>
                  {activeSha && (
                    <button
                      type="button"
                      onClick={() => handleCopy(activeSha, 'hero-sha')}
                      title={`Click to copy full SHA-256: ${activeSha}`}
                      className="text-dw-cyan hover:text-dw-green transition flex items-center gap-1 text-[10px]"
                    >
                      <span>SHA256: {activeSha.slice(0, 10)}…{activeSha.slice(-6)}</span>
                      <span className="underline">{copiedText === 'hero-sha' ? '✓ Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Cryptographic Architecture Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-left max-w-xl text-[11px]">
              <div className="p-2.5 bg-dw-surface/50 rounded-xl border border-dw-border">
                <span className="text-dw-dim block uppercase text-[10px]">Enclave Cipher</span>
                <span className="font-bold text-dw-green">SQLCipher AES-256</span>
              </div>
              <div className="p-2.5 bg-dw-surface/50 rounded-xl border border-dw-border">
                <span className="text-dw-dim block uppercase text-[10px]">P2P Transport</span>
                <span className="font-bold text-dw-cyan">X25519 WebRTC</span>
              </div>
              <div className="p-2.5 bg-dw-surface/50 rounded-xl border border-dw-border">
                <span className="text-dw-dim block uppercase text-[10px]">Auto-Updater</span>
                <span className="font-bold text-dw-text">SHA-256 Verified</span>
              </div>
              <div className="p-2.5 bg-dw-surface/50 rounded-xl border border-dw-border">
                <span className="text-dw-dim block uppercase text-[10px]">Dead-Man Switch</span>
                <span className="font-bold text-dw-amber">24h Crypto-Nuke</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Deep Web Security Console */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="w-full max-w-[580px] rounded-2xl cyber-card border border-dw-border p-3.5 sm:p-5">
              {/* Terminal Title Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-dw-border font-mono text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-red/80 shrink-0"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-amber/80 shrink-0"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-green/80 shrink-0"></span>
                  <span className="text-dw-muted ml-1.5 text-[11px] truncate">
                    /dev/nexgrid · enclave@{selectedPlatform === 'mobile' ? 'android-node' : 'linux-workstation'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-dw-green animate-ping"></span>
                  <span className="text-[10px] sm:text-[11px] text-dw-green font-bold">P2P RTT: 0.8ms</span>
                </div>
              </div>

              {/* Responsive Mode Selector Tabs (2x2 on narrow mobile, 4-col on sm+) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-4 p-1 rounded-xl bg-black/50 border border-dw-border font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('mesh')}
                  className={`py-2 px-2 rounded-lg font-bold transition ${
                    activeConsoleTab === 'mesh'
                      ? 'bg-dw-surface2 text-dw-green border border-dw-green/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  01. P2P Mesh
                </button>
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('generator')}
                  className={`py-2 px-2 rounded-lg font-bold transition ${
                    activeConsoleTab === 'generator'
                      ? 'bg-dw-surface2 text-dw-cyan border border-dw-cyan/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  02. Generator
                </button>
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('totp')}
                  className={`py-2 px-2 rounded-lg font-bold transition ${
                    activeConsoleTab === 'totp'
                      ? 'bg-dw-surface2 text-dw-green border border-dw-green/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  03. TOTP 2FA
                </button>
                <button
                  type="button"
                  onClick={() => setActiveConsoleTab('nuke')}
                  className={`py-2 px-2 rounded-lg font-bold transition ${
                    activeConsoleTab === 'nuke'
                      ? 'bg-dw-surface2 text-dw-red border border-dw-red/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  04. Tamper
                </button>
              </div>

              {/* Console Screen Box */}
              <div className="min-h-[340px] bg-black/65 rounded-xl p-3.5 sm:p-4 border border-dw-border font-mono text-xs flex flex-col justify-between">
                {/* Tab 1: P2P Mesh Simulator */}
                {activeConsoleTab === 'mesh' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-dw-muted border-b border-dw-border/60 pb-2 text-[11px]">
                      <span>PEER TOPOLOGY (ED25519 VERIFIED)</span>
                      <span className="text-dw-green font-bold">3 NODES ONLINE</span>
                    </div>

                    <div className="space-y-2">
                      <div
                        onClick={() => setSelectedPlatform('desktop')}
                        className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                          selectedPlatform === 'desktop'
                            ? 'bg-dw-surface2/90 border-dw-green/50'
                            : 'bg-dw-surface/80 border-dw-border hover:border-dw-green/30'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-dw-green shrink-0"></span>
                          <div className="min-w-0">
                            <span className="text-white font-bold block truncate">
                              Node Alpha · Linux Desktop ({desktopSize})
                            </span>
                            <span className="text-[10px] text-dw-dim block truncate">
                              X25519: 9e4f..88b1 · AppImage Auto-Updater Ready
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-green px-2 py-0.5 rounded bg-dw-green/10 border border-dw-green/20 shrink-0">
                          DESKTOP
                        </span>
                      </div>

                      <div
                        onClick={() => setSelectedPlatform('mobile')}
                        className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                          selectedPlatform === 'mobile'
                            ? 'bg-dw-surface2/90 border-dw-cyan/50'
                            : 'bg-dw-surface/80 border-dw-border hover:border-dw-cyan/30'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-dw-cyan shrink-0"></span>
                          <div className="min-w-0">
                            <span className="text-white font-bold block truncate">
                              Node Beta · Android Mobile ({mobileSize})
                            </span>
                            <span className="text-[10px] text-dw-dim block truncate">
                              X25519: 3a1c..e092 · Native Autofill &amp; APK Verifier
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-cyan px-2 py-0.5 rounded bg-dw-cyan/10 border border-dw-cyan/20 shrink-0">
                          MOBILE
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-dw-surface/80 border border-dw-border flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-dw-green shrink-0"></span>
                          <div className="min-w-0">
                            <span className="text-white font-bold block truncate">
                              Extension Bridge (Shadow DOM)
                            </span>
                            <span className="text-[10px] text-dw-dim block truncate">
                              IPC: 127.0.0.1:46124 · AES-256-GCM Loopback
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-dim px-2 py-0.5 rounded bg-white/5 border border-white/10 shrink-0">
                          LOCAL IPC
                        </span>
                      </div>
                    </div>

                    {/* Interactive Sync Trigger */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={triggerSync}
                        disabled={isSyncing}
                        className="w-full py-2.5 px-4 rounded-lg bg-dw-surface hover:bg-dw-surface2 border border-dw-green/40 text-dw-green hover:text-white transition flex items-center justify-center gap-2 font-bold text-xs"
                      >
                        <span className={isSyncing ? 'animate-spin' : ''}>⚡</span>
                        <span>
                          {isSyncing
                            ? 'Exchanging Encrypted X25519 Envelope...'
                            : 'Simulate Desktop ⇄ Mobile WebRTC Sync'}
                        </span>
                      </button>
                      <div className="flex items-center justify-between text-[10px] text-dw-muted mt-2 px-1">
                        <span>
                          Total mesh syncs: <strong className="text-white">{syncCount}</strong>
                        </span>
                        <span>
                          Last envelope: <strong className="text-dw-cyan">{lastSyncHash}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Zero-Knowledge Password Generator */}
                {activeConsoleTab === 'generator' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2 text-[11px]">
                      <span>ENTROPY GENERATOR</span>
                      <span className="text-dw-cyan font-bold">{entropyBits} BITS ENTROPY</span>
                    </div>

                    <div className="p-3 rounded-lg bg-dw-surface border border-dw-cyan/40 flex items-center justify-between gap-2">
                      <span className="text-xs sm:text-sm font-bold text-white tracking-wider truncate select-all">
                        {generatedPwd}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(generatedPwd, 'pwd')}
                        className="px-3 py-1 rounded bg-dw-cyan/10 hover:bg-dw-cyan/20 text-dw-cyan border border-dw-cyan/40 transition shrink-0 text-xs font-bold"
                      >
                        {copiedText === 'pwd' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dw-muted">
                          Length: <strong className="text-white">{pwdLength} chars</strong>
                        </span>
                        <span className="text-dw-green font-bold text-[11px]">
                          Crack Time: 4.8×10¹⁶ yrs
                        </span>
                      </div>
                      <input
                        type="range"
                        min="16"
                        max="48"
                        value={pwdLength}
                        onChange={(e) => setPwdLength(Number(e.target.value))}
                        className="w-full accent-dw-cyan cursor-pointer"
                      />
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => generatePassword(pwdLength)}
                        className="px-4 py-2 rounded-lg bg-dw-surface hover:bg-dw-surface2 border border-dw-border text-dw-text hover:text-white transition flex items-center gap-1.5 text-xs font-bold"
                      >
                        <span>↺</span>
                        <span>Regenerate Seed</span>
                      </button>
                      <span className="text-[10px] text-dw-dim">CSPRNG Uint32Array</span>
                    </div>
                  </div>
                )}

                {/* Tab 3: Live TOTP 2FA Authenticator */}
                {activeConsoleTab === 'totp' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2 text-[11px]">
                      <span>RFC 6238 TOTP AUTHENTICATOR</span>
                      <span className="text-dw-green font-bold">HMAC-SHA1</span>
                    </div>

                    <div className="p-4 rounded-lg bg-dw-surface border border-dw-green/40 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-dw-muted block">github.com (secops_master)</span>
                        <span className="text-2xl font-extrabold text-white tracking-widest mt-1 block">
                          {totpCode}
                        </span>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="relative w-12 h-12 flex items-center justify-center">
                          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-white/10"
                              strokeWidth="3.5"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className="text-dw-green transition-all duration-1000"
                              strokeDasharray={`${(totpSeconds / 30) * 100}, 100`}
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <span className="absolute text-[11px] font-bold text-white">{totpSeconds}s</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => handleCopy(totpCode.replace(' ', ''), 'totp')}
                        className="px-4 py-2 rounded-lg bg-dw-green/10 hover:bg-dw-green/20 text-dw-green border border-dw-green/40 transition font-bold"
                      >
                        {copiedText === 'totp' ? '✓ Copied Code' : 'Copy 6-Digit Code'}
                      </button>
                      <span className="text-[11px] text-dw-dim font-mono">Synced Desktop + Mobile</span>
                    </div>
                  </div>
                )}

                {/* Tab 4: 24h Dead-Man Switch & Tamper Protocol */}
                {activeConsoleTab === 'nuke' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2 text-[11px]">
                      <span>TAMPER AUDIT &amp; DEAD-MAN PROTOCOL</span>
                      <span className={`font-bold ${tamperTriggered ? 'text-dw-red' : 'text-dw-amber'}`}>
                        {tamperTriggered ? 'DEFENSE ACTIVE' : 'HEARTBEAT ARMED'}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-dw-surface border border-dw-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dw-muted">Authorization Window:</span>
                        <span className="text-dw-amber font-bold">18h 42m 10s left</span>
                      </div>
                      <div className="w-full bg-black/60 rounded-full h-2 overflow-hidden border border-white/5">
                        <div className="bg-gradient-to-r from-dw-green to-dw-amber h-full w-[78%]"></div>
                      </div>
                      <span className="text-[10px] text-dw-dim block">
                        If device remains unauthenticated past deadline, local SQLCipher keys are overwritten with CSPRNG entropy.
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-dw-surface/60 border border-dw-border flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-white font-bold block text-xs">SHA-256 Vault Integrity:</span>
                        <span className="text-[11px] text-dw-green">0 out-of-band alterations</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTamperTriggered(!tamperTriggered)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                          tamperTriggered
                            ? 'bg-dw-red/20 text-dw-red border-dw-red/40'
                            : 'bg-white/5 hover:bg-dw-red/20 text-dw-muted hover:text-dw-red border-white/10'
                        }`}
                      >
                        {tamperTriggered ? 'Reset Simulation' : 'Simulate Tamper Alert'}
                      </button>
                    </div>

                    {tamperTriggered && (
                      <div className="p-2.5 rounded-lg bg-dw-red/10 border border-dw-red/40 text-[11px] text-dw-red animate-pulse">
                        ⚠️ TAMPER ALERT DETECTED: Enclave keys frozen. Trust Ledger hash chain appended.
                      </div>
                    )}
                  </div>
                )}

                {/* Console Footer Status */}
                <div className="pt-3 mt-3 border-t border-dw-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dw-muted">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-dw-green"></span>
                    <span>Release {currentTag} · Verified Builds</span>
                  </div>
                  <span className="text-dw-dim select-none">
                    {activeSha ? `SHA256: ${activeSha.slice(0, 6)}…${activeSha.slice(-4)}` : 'E2EE ENCLAVE'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
