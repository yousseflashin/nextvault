import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './cyber/cyber.css';
import './main.css';
import { getDefaultRelayUrl } from './mobileVault';
import './cyber/binary-shield.js';

function Shield({ size = 56 }) {
  return (
    <svg viewBox="0 0 64 74" fill="none" style={{ width: size, height: size * 1.16, filter: 'drop-shadow(0 0 12px rgba(0,255,157,0.5))' }}>
      <path d="M32 2 60 14v22c0 18-12.6 30.4-28 36C16.6 66.4 4 54 4 36V14L32 2z" stroke="#00ff9d" strokeWidth="2.5" fill="rgba(0,255,157,0.06)" />
      <path d="M22 36l7 7 14-15" stroke="#00d4ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="nv-badge">
      <span className="dot" style={ok ? {} : { background: 'var(--nv-danger)', boxShadow: '0 0 8px var(--nv-danger)' }} />
      {label}
    </span>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="nv-card" style={style}>{children}</div>;
}

function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenJson, setTokenJson] = useState('');
  const [status, setStatus] = useState('Ready');
  const [tab, setTab] = useState<'new' | 'existing'>('existing');
  const [gridLog, setGridLog] = useState<string[]>([]);
  const [relayUrl, setRelayUrl] = useState(getDefaultRelayUrl());
  const [gridStatus, setGridStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'paired'>('disconnected');
  const [pairingCode, setPairingCode] = useState('');
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; deviceName: string } | null>(null);

  const [vaultItems, setVaultItems] = useState<{ service: string; username?: string; createdAt: string }[]>([]);
  const [service, setService] = useState('');
  const [vaultUsername, setVaultUsername] = useState('');
  const [credential, setCredential] = useState('');
  const [otpService, setOtpService] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [otpItems, setOtpItems] = useState<{ service: string; code?: string }[]>([]);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    // Mount binary shield
    if ((window as any).NexVaultFX?.mountAll) {
      (window as any).NexVaultFX.mountAll();
    }

    // Check if vault profile already exists locally
    async function checkExistingProfile() {
      try {
        const prof = await (window as any).nexVault.getVaultProfile();
        if (prof && prof.hasUser && prof.bootstrapToken) {
          setTokenJson(JSON.stringify(prof.bootstrapToken, null, 2));
          setTab('existing');
          setStatus(`Saved vault found for ${prof.username || 'user'}. Enter password to unlock.`);
        }
      } catch {}
    }
    checkExistingProfile();
  }, []);

  const log = (msg: string) => setGridLog(prev => [...prev.slice(-40), `>> ${msg}`]);

  async function onNewUser() {
    if (!username || !password) return setStatus('Enter username and password');
    setStatus('Generating keys...');
    try {
      const r = await (window as any).nexVault.initializeNewUser(username, password);
      if (!r.success) throw new Error(r.error);
      setStatus('Bootstrap token: ' + r.tokenId);
      setTokenJson(JSON.stringify(r.bootstrapToken, null, 2));
      setTab('existing');
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function onExistingUser() {
    if (!tokenJson || !password) return setStatus('Enter token and password');
    setStatus('Validating...');
    try {
      const t = JSON.parse(tokenJson);
      const r = await (window as any).nexVault.initializeExistingUser(t.tokenId, t.publicKey, t.signature, password, t.expiresAt);
      if (!r.success) throw new Error(r.error);
      setStatus('Unlocked: ' + r.tokenId);
      setUnlocked(true);
      refreshVault();
      refreshOTPs();
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function onStartGrid() {
    log(`Connecting to NexGrid relay (${relayUrl})...`);
    try {
      const r = await (window as any).nexVault.startNexGrid({ relayUrl }, {
        onLog: (msg: string) => log(msg),
        onStatusChange: (s: any) => setGridStatus(s),
        onPairApproved: (peer: any) => {
          log(`✅ Paired with ${peer.deviceName || peer.deviceId}!`);
          refreshVault();
          refreshOTPs();
        },
        onIncomingPairRequest: (req: any) => {
          setIncomingRequest({ from: req.from, deviceName: req.deviceName });
        },
        onVaultSynced: () => {
          refreshVault();
          refreshOTPs();
        }
      });
      if (r && !r.success) {
        log('Error: ' + r.error);
      }
    } catch (e: any) { log('Exception: ' + e.message); }
  }

  async function onStopGrid() {
    log('Stopping NexGrid...');
    try {
      await (window as any).nexVault.stopNexGrid();
      setGridStatus('disconnected');
    } catch (e: any) { log('Error: ' + e.message); }
  }

  async function onPairWithCode() {
    if (!pairingCode.trim()) return log('Enter the 6-digit code from desktop');
    log(`Submitting pairing code ${pairingCode}...`);
    try {
      const r = await (window as any).nexVault.pairWithCode(pairingCode);
      if (r.success) {
        log('Pairing code sent to network. Waiting for desktop confirmation...');
        setPairingCode('');
      } else {
        log('Pair error: ' + r.error);
      }
    } catch (e: any) {
      log('Pair error: ' + e.message);
    }
  }

  async function onApproveIncoming() {
    if (!incomingRequest) return;
    try {
      await (window as any).nexVault.approvePairRequest(incomingRequest.from);
      log(`Approved pairing with ${incomingRequest.deviceName}`);
      setIncomingRequest(null);
      refreshVault();
    } catch (e: any) { log('Error: ' + e.message); }
  }

  async function onRejectIncoming() {
    if (!incomingRequest) return;
    try {
      await (window as any).nexVault.rejectPairRequest(incomingRequest.from);
      log(`Declined pairing with ${incomingRequest.deviceName}`);
      setIncomingRequest(null);
    } catch (e: any) { log('Error: ' + e.message); }
  }

  async function onSavePassword() {
    if (!service || !credential) return setStatus('Enter service and credential');
    try {
      const r = await (window as any).nexVault.addPassword(service, credential, vaultUsername);
      if (r.success) {
        setStatus('Saved');
        setService('');
        setVaultUsername('');
        setCredential('');
        refreshVault();
      } else throw new Error(r.error);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function refreshVault() {
    try {
      const r = await (window as any).nexVault.listPasswords();
      setVaultItems(r.entries || []);
    } catch { /* ignore */ }
  }

  async function onSaveOTP() {
    if (!otpService || !otpSecret) return setStatus('Enter service and secret');
    try {
      const r = await (window as any).nexVault.addOTP(otpService, otpSecret);
      if (r.success) { setStatus('TOTP added'); setOtpService(''); setOtpSecret(''); refreshOTPs(); }
      else throw new Error(r.error);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function refreshOTPs() {
    try {
      const r = await (window as any).nexVault.listOTPs();
      setOtpItems(r.entries || []);
    } catch { /* ignore */ }
  }

  return (
    <div className="nv-app">
      <canvas className="nv-canvas" data-nv-binary-shield></canvas>
      <div className="nv-app-layer">
        <header className="nv-app-header">
          <div className="nv-app-brand">
            <Shield size={40} />
            <span className="nv-app-title">NEX<span className="nv-gradient-text">VAULT</span></span>
          </div>
          <StatusPill ok={unlocked} label={unlocked ? 'unlocked' : 'locked'} />
        </header>

        <main className="nv-app-main">
          {!unlocked ? (
            <Card>
              <h1 className="nv-title nv-app-h1">NexVault<span className="nv-gradient-text"> Mobile</span></h1>
              <p className="nv-muted nv-app-sub">Local-first password, OTP, and trusted-device network.</p>

              <div className="nv-tabs">
                <button className={`nv-tab ${tab === 'existing' ? 'active' : ''}`} onClick={() => setTab('existing')}>Existing Network / Pair</button>
                <button className={`nv-tab ${tab === 'new' ? 'active' : ''}`} onClick={() => setTab('new')}>New Network</button>
              </div>

              {tab === 'existing' ? (
                <div className="nv-form">
                  <label className="nv-label">Paste Bootstrap Token (from Desktop)</label>
                  <textarea className="nv-textarea" rows={5} placeholder='{"tokenId":"...","publicKey":"...","signature":"...","expiresAt":...}' value={tokenJson} onChange={e => setTokenJson(e.target.value)} />
                  <label className="nv-label">Master Password</label>
                  <input className="nv-input" type="password" placeholder="master password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                  <button className="nv-btn nv-btn-cyan" onClick={onExistingUser}>Validate &amp; Unlock</button>
                </div>
              ) : (
                <div className="nv-form">
                  <label className="nv-label">Username</label>
                  <input className="nv-input" placeholder="choose a username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
                  <label className="nv-label">Master Password</label>
                  <input className="nv-input" type="password" placeholder="master password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                  <button className="nv-btn" onClick={onNewUser}>Generate Bootstrap Token</button>
                  {tokenJson && (
                    <>
                      <label className="nv-label">Your Bootstrap Token (save this!)</label>
                      <textarea className="nv-textarea" rows={6} readOnly value={tokenJson} onChange={e => setTokenJson(e.target.value)} />
                    </>
                  )}
                </div>
              )}

              <p className="nv-app-status">{status}</p>
            </Card>
          ) : (
            <>
              {/* NexGrid Panel */}
              <Card style={{ marginBottom: '1rem' }}>
                <div className="nv-panel-header">
                  <span className="nv-panel-title">nexgrid p2p</span>
                  <StatusPill ok={gridStatus === 'paired' || gridStatus === 'connected'} label={gridStatus} />
                </div>

                <div style={{ marginBottom: '0.65rem' }}>
                  <label className="nv-label">Relay Server URL</label>
                  <input
                    className="nv-input"
                    value={relayUrl}
                    onChange={e => setRelayUrl(e.target.value)}
                    placeholder="ws://10.0.2.2:46123 or ws://192.168.1.X:46123"
                    style={{ fontSize: '0.8rem' }}
                  />
                </div>

                <div className="nv-btn-row">
                  <button className="nv-btn" onClick={onStartGrid}>
                    {gridStatus === 'disconnected' ? 'Start NexGrid' : 'Reconnect Grid'}
                  </button>
                  {gridStatus !== 'disconnected' && (
                    <button className="nv-btn nv-btn-ghost" onClick={onStopGrid}>Stop</button>
                  )}
                </div>

                {/* Pair with 6-digit code */}
                <div style={{ marginTop: '0.75rem', padding: '0.65rem', background: 'rgba(0,212,255,0.06)', borderRadius: '8px', border: '1px solid rgba(0,212,255,0.2)' }}>
                  <label className="nv-label" style={{ color: 'var(--nv-accent)' }}>Enter Desktop Pairing Code</label>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <input
                      className="nv-input"
                      placeholder="e.g. 543210"
                      value={pairingCode}
                      maxLength={8}
                      onChange={e => setPairingCode(e.target.value)}
                      style={{ fontSize: '1rem', letterSpacing: '2px', fontWeight: 'bold' }}
                    />
                    <button className="nv-btn nv-btn-cyan" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={onPairWithCode}>
                      Pair Code
                    </button>
                  </div>
                </div>

                {/* Incoming Request Banner */}
                {incomingRequest && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,255,157,0.12)', border: '1px solid var(--nv-primary)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>🔔 Pairing Request from "{incomingRequest.deviceName}"</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                      <button className="nv-btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} onClick={onApproveIncoming}>Approve &amp; Sync</button>
                      <button className="nv-btn nv-btn-ghost" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} onClick={onRejectIncoming}>Reject</button>
                    </div>
                  </div>
                )}

                <div className="nv-terminal" style={{ marginTop: '0.75rem' }}>
                  {gridLog.length ? gridLog.join('\n') : '>> Awaiting NexGrid start...'}
                </div>
              </Card>

              {/* Vault Credentials Card */}
              <Card style={{ marginBottom: '1rem' }}>
                <div className="nv-panel-header">
                  <span className="nv-panel-title">vault credentials</span>
                </div>
                <div className="nv-form-row">
                  <input className="nv-input" placeholder="Service / Website" value={service} onChange={e => setService(e.target.value)} />
                  <input className="nv-input" placeholder="Username / Email" value={vaultUsername} onChange={e => setVaultUsername(e.target.value)} />
                </div>
                <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <input className="nv-input" placeholder="Credential / Password" value={credential} onChange={e => setCredential(e.target.value)} />
                </div>
                <div className="nv-btn-row">
                  <button className="nv-btn" onClick={onSavePassword}>Save Credential</button>
                  <button className="nv-btn nv-btn-ghost" onClick={refreshVault}>Refresh</button>
                </div>
                <div className="nv-vault-list">
                  {vaultItems.length === 0 ? (
                    <div className="nv-empty">No credentials stored yet. Connect to Desktop via NexGrid to sync!</div>
                  ) : vaultItems.map(v => (
                    <div className="nv-vault-item" key={v.service}>
                      <div className="nv-vault-info">
                        <span className="nv-vault-service">
                          {v.service} {v.username ? <span style={{ color: 'var(--nv-accent)', fontSize: '0.75rem' }}>({v.username})</span> : null}
                        </span>
                        <span className="nv-vault-meta">Created: {new Date(v.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* OTP / TOTP Card */}
              <Card>
                <div className="nv-panel-header">
                  <span className="nv-panel-title">otp / totp</span>
                </div>
                <div className="nv-form-row">
                  <input className="nv-input" placeholder="Service" value={otpService} onChange={e => setOtpService(e.target.value)} />
                  <input className="nv-input" placeholder="Secret (base32)" value={otpSecret} onChange={e => setOtpSecret(e.target.value)} />
                </div>
                <div className="nv-btn-row">
                  <button className="nv-btn" onClick={onSaveOTP}>Add TOTP</button>
                  <button className="nv-btn nv-btn-ghost" onClick={refreshOTPs}>Refresh</button>
                </div>
                <div className="nv-vault-list">
                  {otpItems.length === 0 ? (
                    <div className="nv-empty">No TOTP entries yet.</div>
                  ) : otpItems.map(o => (
                    <div className="nv-vault-item" key={o.service}>
                      <div className="nv-vault-info">
                        <span className="nv-vault-service">{o.service}</span>
                        {o.code && (
                          <span style={{ fontSize: '1.2rem', fontFamily: 'var(--nv-font-mono)', fontWeight: 'bold', color: 'var(--nv-primary)', letterSpacing: '3px' }}>
                            {o.code}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </main>

        <footer className="nv-app-footer">NEXVAULT — local-first. nothing in between.</footer>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}

export default App;
