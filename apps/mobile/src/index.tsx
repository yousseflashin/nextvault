import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './main.css';

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
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenJson, setTokenJson] = useState('');
  const [status, setStatus] = useState('Ready');
  const [tab, setTab] = useState<'new' | 'existing'>('new');
  const [gridLog, setGridLog] = useState<string[]>([]);
  const [vaultItems, setVaultItems] = useState<{ service: string; createdAt: string }[]>([]);
  const [service, setService] = useState('');
  const [credential, setCredential] = useState('');
  const [otpService, setOtpService] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [otpItems, setOtpItems] = useState<{ service: string }[]>([]);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    // Binary shield background
    const canvas = document.createElement('canvas');
    canvas.className = 'nv-canvas';
    canvas.setAttribute('data-nv-binary-shield', 'true');
    document.body.prepend(canvas);
    const script = document.createElement('script');
    script.src = 'cyber/binary-shield.js';
    script.onload = () => (window as any).NexVaultFX?.mountAll?.();
    document.body.appendChild(script);
  }, []);

  const log = (msg: string) => setGridLog(prev => [...prev, `>> ${msg}`]);

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
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function onStartGrid() {
    log('Starting NexGrid...');
    try {
      const r = await (window as any).nexVault.startNexGrid();
      log(r.success ? 'NexGrid started - waiting for peers...' : 'Error: ' + r.error);
    } catch (e: any) { log('Exception: ' + e.message); }
  }

  async function onSavePassword() {
    if (!service || !credential) return setStatus('Enter service and credential');
    try {
      const r = await (window as any).nexVault.addPassword(service, credential);
      if (r.success) { setStatus('Saved'); setService(''); setCredential(''); refreshVault(); }
      else throw new Error(r.error);
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
                <button className={`nv-tab ${tab === 'new' ? 'active' : ''}`} onClick={() => setTab('new')}>New Network</button>
                <button className={`nv-tab ${tab === 'existing' ? 'active' : ''}`} onClick={() => setTab('existing')}>Existing Network</button>
              </div>

              {tab === 'new' ? (
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
              ) : (
                <div className="nv-form">
                  <label className="nv-label">Paste Bootstrap Token (JSON)</label>
                  <textarea className="nv-textarea" rows={5} placeholder='{"tokenId":"...","publicKey":"...","signature":"...","expiresAt":...}' value={tokenJson} onChange={e => setTokenJson(e.target.value)} />
                  <label className="nv-label">Master Password</label>
                  <input className="nv-input" type="password" placeholder="master password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                  <button className="nv-btn nv-btn-cyan" onClick={onExistingUser}>Validate & Unlock</button>
                </div>
              )}

              <p className="nv-app-status">{status}</p>
            </Card>
          ) : (
            <>
              <Card style={{ marginBottom: '1rem' }}>
                <div className="nv-panel-header">
                  <span className="nv-panel-title">nexgrid</span>
                  <StatusPill ok label="p2p" />
                </div>
                <div className="nv-btn-row">
                  <button className="nv-btn" onClick={onStartGrid}>Start Grid</button>
                </div>
                <div className="nv-terminal">
                  {gridLog.length ? gridLog.join('\n') : '>> Awaiting NexGrid start...'}
                </div>
              </Card>

              <Card style={{ marginBottom: '1rem' }}>
                <div className="nv-panel-header">
                  <span className="nv-panel-title">vault</span>
                </div>
                <div className="nv-form-row">
                  <input className="nv-input" placeholder="Service / Website" value={service} onChange={e => setService(e.target.value)} />
                  <input className="nv-input" placeholder="Credential / Password" value={credential} onChange={e => setCredential(e.target.value)} />
                </div>
                <div className="nv-btn-row">
                  <button className="nv-btn" onClick={onSavePassword}>Save Credential</button>
                  <button className="nv-btn nv-btn-ghost" onClick={refreshVault}>List All</button>
                </div>
                <div className="nv-vault-list">
                  {vaultItems.length === 0 ? (
                    <div className="nv-empty">No credentials stored yet.</div>
                  ) : vaultItems.map(v => (
                    <div className="nv-vault-item" key={v.service}>
                      <div className="nv-vault-info">
                        <span className="nv-vault-service">{v.service}</span>
                        <span className="nv-vault-meta">Created: {new Date(v.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

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
                  <button className="nv-btn nv-btn-ghost" onClick={refreshOTPs}>List All</button>
                </div>
                <div className="nv-vault-list">
                  {otpItems.length === 0 ? (
                    <div className="nv-empty">No TOTP entries yet.</div>
                  ) : otpItems.map(o => (
                    <div className="nv-vault-item" key={o.service}>
                      <div className="nv-vault-info">
                        <span className="nv-vault-service">{o.service}</span>
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

export default App;
