import React, { useState, useEffect } from 'react';
import releaseInfo from '../release-info.json';
import DeepWebBackground from './DeepWebBackground.jsx';

export default function DeepWebHero() {
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

  // Direct download URLs from release-info.json
  const currentVersion = releaseInfo.version || '0.1.1';
  const currentTag = releaseInfo.tag || `v${currentVersion}`;
  const desktopUrl = releaseInfo.desktop?.url || `https://github.com/yousseflashin/nextvault/releases/download/${currentTag}/NexVault-${currentVersion}.AppImage`;
  const desktopSize = releaseInfo.desktop?.size || '124.5 MB';
  const mobileUrl = releaseInfo.mobile?.url || `https://github.com/yousseflashin/nextvault/releases/download/${currentTag}/NexVault-mobile-app-debug.apk`;
  const mobileSize = releaseInfo.mobile?.size || '4.0 MB';

  const installCommand = `chmod +x NexVault-${currentVersion}.AppImage && ./NexVault-${currentVersion}.AppImage`;

  // Copy helper with feedback
  const handleCopy = (text, label) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  // Generate cryptographic password
  const generatePassword = (len) => {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_+=';
    let res = '';
    const array = new Uint32Array(len);
    if (window.crypto) {
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

  // Live TOTP countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTotpSeconds((prev) => {
        if (prev <= 1) {
          // Regenerate fake code
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
    <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden pt-8 pb-16 bg-dw-bg">
      {/* Lightweight ambient node mesh */}
      <DeepWebBackground />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column: Deep Web Manifesto & Downloads */}
          <div className="lg:col-span-6 text-left">
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-widest text-dw-green bg-dw-surface/80 border border-dw-border mb-6">
              <span className="w-2 h-2 rounded-full bg-dw-green animate-pulse"></span>
              <span>TOR / P2P MESH // ZERO-CLOUD AIRGAP</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
              Decentralized key sovereignty. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-dw-green via-dw-cyan to-white font-mono">
                No Cloud. No Telemetry.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-dw-muted mb-8 leading-relaxed max-w-xl">
              NexVault secures your credentials inside an air-gapped, SQLCipher-encrypted vault directly on your physical hardware.
              Syncs between your personal devices over authenticated peer-to-peer WebSockets & WebRTC mesh without any central database.
            </p>

            {/* Quick Actions & One-Click Terminal Install */}
            <div className="space-y-4 mb-8">
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href={desktopUrl}
                  className="px-6 py-3.5 rounded-lg font-mono font-bold text-xs uppercase tracking-wider text-black bg-gradient-to-r from-dw-green to-dw-cyan hover:opacity-90 transition shadow-glow flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download Desktop {currentTag}</span>
                  <span className="opacity-75 text-[10px]">({desktopSize})</span>
                </a>

                <a
                  href={mobileUrl}
                  className="px-5 py-3.5 rounded-lg font-mono font-semibold text-xs uppercase tracking-wider text-dw-text bg-dw-surface hover:bg-dw-surface2 border border-dw-border hover:border-dw-cyan transition flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-dw-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span>Android APK</span>
                  <span className="text-dw-muted text-[10px]">({mobileSize})</span>
                </a>
              </div>

              {/* Terminal Quick Launch Box */}
              <div className="p-3 rounded-lg bg-dw-surface/70 border border-dw-border max-w-xl font-mono text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-dw-muted truncate">
                  <span className="text-dw-green select-none">$</span>
                  <span className="text-dw-text truncate select-all">{installCommand}</span>
                </div>
                <button
                  onClick={() => handleCopy(installCommand, 'cmd')}
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-dw-green/20 text-dw-muted hover:text-dw-green border border-white/10 hover:border-dw-green/40 transition shrink-0 text-[11px]"
                >
                  {copiedText === 'cmd' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Cryptographic Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-left max-w-xl text-[11px]">
              <div className="p-2.5 bg-dw-surface/40 rounded border border-dw-border">
                <span className="text-dw-dim block uppercase">Encryption</span>
                <span className="font-bold text-dw-green">SQLCipher AES-256</span>
              </div>
              <div className="p-2.5 bg-dw-surface/40 rounded border border-dw-border">
                <span className="text-dw-dim block uppercase">P2P Mesh</span>
                <span className="font-bold text-dw-cyan">X25519 Ratchet</span>
              </div>
              <div className="p-2.5 bg-dw-surface/40 rounded border border-dw-border">
                <span className="text-dw-dim block uppercase">In-Field Autofill</span>
                <span className="font-bold text-dw-text">Shadow DOM</span>
              </div>
              <div className="p-2.5 bg-dw-surface/40 rounded border border-dw-border">
                <span className="text-dw-dim block uppercase">Dead-Man Switch</span>
                <span className="font-bold text-dw-amber">24h Crypto-Nuke</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Deep Web Security Console */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="w-full max-w-[560px] rounded-2xl bg-dw-surface/95 border border-dw-border shadow-deep p-4 sm:p-5">
              
              {/* Terminal Title Bar */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-dw-border font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-red/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-amber/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-dw-green/80"></span>
                  <span className="text-dw-muted ml-2 text-[11px]">/dev/nexgrid · root@local-enclave</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-dw-green animate-ping"></span>
                  <span className="text-[11px] text-dw-green font-bold">LATENCY: 0.8ms</span>
                </div>
              </div>

              {/* Mode Selector Tabs */}
              <div className="grid grid-cols-4 gap-1.5 mb-4 p-1 rounded-lg bg-black/40 border border-dw-border font-mono text-[11px]">
                <button
                  onClick={() => setActiveConsoleTab('mesh')}
                  className={`py-1.5 rounded font-bold transition ${
                    activeConsoleTab === 'mesh'
                      ? 'bg-dw-surface2 text-dw-green border border-dw-green/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  01. P2P Mesh
                </button>
                <button
                  onClick={() => setActiveConsoleTab('generator')}
                  className={`py-1.5 rounded font-bold transition ${
                    activeConsoleTab === 'generator'
                      ? 'bg-dw-surface2 text-dw-cyan border border-dw-cyan/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  02. Generator
                </button>
                <button
                  onClick={() => setActiveConsoleTab('totp')}
                  className={`py-1.5 rounded font-bold transition ${
                    activeConsoleTab === 'totp'
                      ? 'bg-dw-surface2 text-dw-green border border-dw-green/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  03. TOTP 2FA
                </button>
                <button
                  onClick={() => setActiveConsoleTab('nuke')}
                  className={`py-1.5 rounded font-bold transition ${
                    activeConsoleTab === 'nuke'
                      ? 'bg-dw-surface2 text-dw-red border border-dw-red/30'
                      : 'text-dw-muted hover:text-white'
                  }`}
                >
                  04. Tamper
                </button>
              </div>

              {/* Console Screen Box */}
              <div className="min-h-[340px] bg-black/60 rounded-xl p-4 border border-dw-border font-mono text-xs flex flex-col justify-between">
                
                {/* Tab 1: P2P Mesh Simulator */}
                {activeConsoleTab === 'mesh' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2">
                      <span>PEER TOPOLOGY (ED25519 VERIFIED)</span>
                      <span className="text-dw-green font-bold">MESH RATIFIED</span>
                    </div>

                    <div className="space-y-2">
                      <div className="p-2.5 rounded bg-dw-surface/80 border border-dw-border flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-dw-green"></span>
                          <div>
                            <span className="text-white font-bold block">Node Alpha (Linux Desktop)</span>
                            <span className="text-[10px] text-dw-dim">X25519: 9e4f..88b1 · Primary Vault Enclave</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-green px-2 py-0.5 rounded bg-dw-green/10 border border-dw-green/20">
                          MASTER
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-dw-surface/80 border border-dw-border flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-dw-cyan"></span>
                          <div>
                            <span className="text-white font-bold block">Node Beta (Android Mobile)</span>
                            <span className="text-[10px] text-dw-dim">X25519: 3a1c..e092 · P2P WebRTC Direct</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-cyan px-2 py-0.5 rounded bg-dw-cyan/10 border border-dw-cyan/20">
                          SYNCED
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-dw-surface/80 border border-dw-border flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-dw-green"></span>
                          <div>
                            <span className="text-white font-bold block">Extension Bridge (Shadow DOM)</span>
                            <span className="text-[10px] text-dw-dim">IPC: 127.0.0.1:46124 · AES-256-GCM Session</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-dw-dim px-2 py-0.5 rounded bg-white/5 border border-white/10">
                          LOCAL IPC
                        </span>
                      </div>
                    </div>

                    {/* Interactive Sync Trigger */}
                    <div className="pt-2">
                      <button
                        onClick={triggerSync}
                        disabled={isSyncing}
                        className="w-full py-2.5 px-4 rounded bg-dw-surface hover:bg-dw-surface2 border border-dw-green/40 text-dw-green hover:text-white transition flex items-center justify-center gap-2 font-bold text-xs"
                      >
                        <span className={isSyncing ? 'animate-spin' : ''}>⚡</span>
                        <span>{isSyncing ? 'Exchanging Encrypted X25519 Envelope...' : 'Simulate P2P WebRTC Sync'}</span>
                      </button>
                      <div className="flex items-center justify-between text-[10px] text-dw-muted mt-2 px-1">
                        <span>Total mesh syncs: <strong className="text-white">{syncCount}</strong></span>
                        <span>Last envelope: <strong className="text-dw-cyan">{lastSyncHash}</strong></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Zero-Knowledge Password Generator */}
                {activeConsoleTab === 'generator' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2">
                      <span>ENTROPY GENERATOR</span>
                      <span className="text-dw-cyan font-bold">{entropyBits} BITS ENTROPY</span>
                    </div>

                    <div className="p-3 rounded-lg bg-dw-surface border border-dw-cyan/40 flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white tracking-wider truncate select-all">{generatedPwd}</span>
                      <button
                        onClick={() => handleCopy(generatedPwd, 'pwd')}
                        className="px-3 py-1 rounded bg-dw-cyan/10 hover:bg-dw-cyan/20 text-dw-cyan border border-dw-cyan/40 transition shrink-0 text-xs font-bold"
                      >
                        {copiedText === 'pwd' ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dw-muted">Length: <strong className="text-white">{pwdLength} characters</strong></span>
                        <span className="text-dw-green font-bold text-[11px]">Crack Time: 4.8×10¹⁶ years</span>
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
                        onClick={() => generatePassword(pwdLength)}
                        className="px-4 py-2 rounded bg-dw-surface hover:bg-dw-surface2 border border-dw-border text-dw-text hover:text-white transition flex items-center gap-1.5 text-xs font-bold"
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
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2">
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

                      {/* Circular Progress Timer */}
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
                        onClick={() => handleCopy(totpCode.replace(' ', ''), 'totp')}
                        className="px-4 py-2 rounded bg-dw-green/10 hover:bg-dw-green/20 text-dw-green border border-dw-green/40 transition font-bold"
                      >
                        {copiedText === 'totp' ? '✓ Copied Code' : 'Copy 6-Digit Code'}
                      </button>
                      <span className="text-[11px] text-dw-dim font-mono">Period: 30s · Digits: 6</span>
                    </div>
                  </div>
                )}

                {/* Tab 4: 24h Dead-Man Switch & Tamper Protocol */}
                {activeConsoleTab === 'nuke' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-dw-muted border-b border-dw-border/60 pb-2">
                      <span>TAMPER AUDIT & DEAD-MAN PROTOCOL</span>
                      <span className={`font-bold ${tamperTriggered ? 'text-dw-red' : 'text-dw-amber'}`}>
                        {tamperTriggered ? 'TAMPER DEFENSE ACTIVE' : 'HEARTBEAT ARMED'}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-dw-surface border border-dw-border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dw-muted">Dead-Man Authorization Deadline:</span>
                        <span className="text-dw-amber font-bold">18h 42m 10s remaining</span>
                      </div>
                      <div className="w-full bg-black/60 rounded-full h-2 overflow-hidden border border-white/5">
                        <div className="bg-gradient-to-r from-dw-green to-dw-amber h-full w-[78%]"></div>
                      </div>
                      <span className="text-[10px] text-dw-dim block">
                        If device remains offline past deadline, all local database keys are overwritten with cryptographic entropy.
                      </span>
                    </div>

                    <div className="p-3 rounded bg-dw-surface/60 border border-dw-border flex items-center justify-between">
                      <div>
                        <span className="text-white font-bold block text-xs">SHA-256 Vault Manifest Integrity:</span>
                        <span className="text-[11px] text-dw-green">0 out-of-band alterations detected</span>
                      </div>
                      <button
                        onClick={() => setTamperTriggered(!tamperTriggered)}
                        className={`px-3 py-1.5 rounded text-xs font-bold transition border ${
                          tamperTriggered
                            ? 'bg-dw-red/20 text-dw-red border-dw-red/40'
                            : 'bg-white/5 hover:bg-dw-red/20 text-dw-muted hover:text-dw-red border-white/10'
                        }`}
                      >
                        {tamperTriggered ? 'Reset Simulation' : 'Simulate Tamper Alert'}
                      </button>
                    </div>

                    {tamperTriggered && (
                      <div className="p-2.5 rounded bg-dw-red/10 border border-dw-red/40 text-[11px] text-dw-red animate-pulse">
                        ⚠️ TAMPER ALERT DETECTED: Enclave keys frozen. Trust Ledger hash chain appended.
                      </div>
                    )}
                  </div>
                )}

                {/* Console Footer Status */}
                <div className="pt-3 border-t border-dw-border/60 flex items-center justify-between text-[11px] text-dw-muted">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-dw-green"></span>
                    <span>Zero Cloud Servers</span>
                  </div>
                  <span className="text-dw-dim select-none">SHA256: 3c7a...9d01</span>
                </div>

              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

