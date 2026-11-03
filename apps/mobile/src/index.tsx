import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './cyber/cyber.css';
import './main.css';
import { getDefaultRelayUrl, CURRENT_VERSION } from './mobileVault';

function Shield({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 74" fill="none" style={{ width: size, height: size * 1.15 }}>
      <path d="M32 2 60 14v22c0 18-12.6 30.4-28 36C16.6 66.4 4 54 4 36V14L32 2z" stroke="#10b981" strokeWidth="2.5" fill="rgba(16,185,129,0.1)" />
      <path d="M22 36l7 7 14-15" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`nv-badge ${ok ? 'success' : ''}`}>
      <span className="dot" style={ok ? {} : { background: 'var(--nv-danger)' }} />
      {label}
    </span>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="nv-card" style={style}>{children}</div>;
}

type TabType = 'vault' | 'otp' | 'grid' | 'settings';

function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<TabType>('vault');

  // Auth State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenJson, setTokenJson] = useState('');
  const [status, setStatus] = useState('Ready');
  const [authMode, setAuthMode] = useState<'existing' | 'new'>('existing');
  const [unlocked, setUnlocked] = useState(false);

  // Vault State
  const [vaultItems, setVaultItems] = useState<{ service: string; username?: string; createdAt: string }[]>([]);
  const [vaultSearch, setVaultSearch] = useState('');
  const [showAddVault, setShowAddVault] = useState(false);
  const [service, setService] = useState('');
  const [vaultUsername, setVaultUsername] = useState('');
  const [credential, setCredential] = useState('');

  // OTP State
  const [otpItems, setOtpItems] = useState<{ service: string; code?: string }[]>([]);
  const [showAddOtp, setShowAddOtp] = useState(false);
  const [otpService, setOtpService] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [countdown, setCountdown] = useState(30);

  // NexGrid State
  const [relayUrl, setRelayUrl] = useState(getDefaultRelayUrl());
  const [gridStatus, setGridStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'paired'>('disconnected');
  const [pairingCode, setPairingCode] = useState('');
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; deviceName: string } | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<{ deviceId: string; deviceName?: string; pairedAt?: string }[]>([]);
  const [gridLog, setGridLog] = useState<string[]>([]);

  // Sync & Updates
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion: string; downloadUrl?: string } | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  async function onApplyMobileUpdate() {
    if (isUpdating) return;
    setIsUpdating(true);
    showToast('Downloading update and opening installer...');
    try {
      const res = await (window as any).nexVault.applyUpdate(updateInfo?.downloadUrl);
      if (res && res.success) {
        showToast('Package installer launched. Confirm to update in-place.');
      } else {
        showToast(res?.error || 'Update failed');
      }
    } catch (e: any) {
      showToast('Error applying update: ' + e.message);
    } finally {
      setIsUpdating(false);
    }
  }

  const log = (msg: string) => setGridLog(prev => [...prev.slice(-30), `>> ${msg}`]);

  async function checkMobileUpdates(manual = false) {
    if (manual) showToast('Checking GitHub for updates...');
    try {
      const res = await (window as any).nexVault.checkForUpdates();
      if (res && res.hasUpdate) {
        setUpdateInfo(res);
        showToast(`Update Available: v${res.latestVersion}`);
      } else if (res && res.success) {
        setUpdateInfo(null);
        if (manual) showToast(`Up to Date: v${res.currentVersion}`);
      }
    } catch (err: any) {
      if (manual) showToast('Update check failed: ' + err.message);
    }
  }

  async function loadDevices() {
    try {
      const res = await (window as any).nexVault.getTrustedDevices();
      const list = res.devices || [];
      setTrustedDevices(list.map((d: any) => typeof d === 'string' ? { deviceId: d, deviceName: 'Paired Device' } : d));
    } catch {}
  }

  async function onRevokeDevice(deviceId: string) {
    if (!confirm(`Revoke trust for device ${deviceId}?`)) return;
    try {
      await (window as any).nexVault.removeTrustedDevice(deviceId);
      await loadDevices();
      showToast('Device pairing revoked.');
      log(`Revoked trusted device: ${deviceId}`);
    } catch (e: any) {
      showToast('Error revoking device: ' + e.message);
    }
  }

  // TOTP countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      const sec = 30 - (Math.floor(Date.now() / 1000) % 30);
      setCountdown(sec);
      if (sec === 30 && unlocked) {
        refreshOTPs(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [unlocked]);

  useEffect(() => {
    async function checkExistingProfile() {
      try {
        const prof = await (window as any).nexVault.getVaultProfile();
        if (prof && prof.hasUser && prof.bootstrapToken) {
          setTokenJson(JSON.stringify(prof.bootstrapToken, null, 2));
          setAuthMode('existing');

          const sessionActive = sessionStorage.getItem('nexvault_mobile_unlocked') === '1';
          if (sessionActive) {
            setUnlocked(true);
            refreshVault(false);
            refreshOTPs(false);
            loadDevices();
            setTimeout(() => onStartGrid(), 300);
            showToast(`Session restored for ${prof.username || 'user'}.`);
          } else {
            setStatus(`Vault profile found. Enter master password to unlock.`);
          }
        }
      } catch {}
    }

    checkExistingProfile();
    checkMobileUpdates(false);
  }, []);

  async function onNewUser() {
    if (!username || !password) return setStatus('Enter username and password');
    setStatus('Generating keys...');
    try {
      const r = await (window as any).nexVault.initializeNewUser(username, password);
      if (!r.success) throw new Error(r.error);
      setStatus('Created identity: ' + r.tokenId);
      setTokenJson(JSON.stringify(r.bootstrapToken, null, 2));
      sessionStorage.setItem('nexvault_mobile_unlocked', '1');
      setUnlocked(true);
      showToast('Vault created successfully.');
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function onExistingUser() {
    if (!password) return setStatus('Enter master password');
    setStatus('Validating...');
    try {
      let t: any = null;
      if (tokenJson && tokenJson.trim()) {
        t = JSON.parse(tokenJson);
      } else {
        const prof = await (window as any).nexVault.getVaultProfile();
        if (prof && prof.bootstrapToken) t = prof.bootstrapToken;
      }
      if (!t) throw new Error('Bootstrap token is missing. Paste JSON first.');

      const r = await (window as any).nexVault.initializeExistingUser(t.tokenId, t.publicKey, t.signature, password, t.expiresAt);
      if (!r.success) throw new Error(r.error);
      sessionStorage.setItem('nexvault_mobile_unlocked', '1');
      setUnlocked(true);
      setStatus('Unlocked: ' + r.tokenId);
      refreshVault(false);
      refreshOTPs(false);
      loadDevices();
      setTimeout(() => onStartGrid(), 400);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  function onLockVault() {
    sessionStorage.removeItem('nexvault_mobile_unlocked');
    setUnlocked(false);
    setPassword('');
    setStatus('Vault locked.');
    showToast('Vault locked.');
  }

  // NexGrid Handlers
  async function onStartGrid() {
    log('Connecting NexGrid...');
    setGridStatus('connecting');
    try {
      const r = await (window as any).nexVault.startNexGrid(relayUrl);
      if (r.success) {
        setGridStatus('connected');
        log('NexGrid connected to relay.');
        loadDevices();
        if ((window as any).nexVault.onIncomingPairRequest) {
          (window as any).nexVault.onIncomingPairRequest(({ peerId, deviceName }: any) => {
            log(`🔔 Incoming pairing request from ${deviceName || peerId}`);
            setIncomingRequest({ from: peerId, deviceName: deviceName || 'Desktop Device' });
          });
        }
        if ((window as any).nexVault.onPeerPaired) {
          (window as any).nexVault.onPeerPaired(({ peerId, deviceName }: any) => {
            log(`✅ Device paired & verified: "${deviceName}" (${peerId})`);
            setGridStatus('paired');
            loadDevices();
            refreshVault(false);
            refreshOTPs(false);
            showToast(`Device paired: ${deviceName || peerId}`);
          });
        }
        if ((window as any).nexVault.onVaultUpdated) {
          (window as any).nexVault.onVaultUpdated(() => {
            log('🔄 Vault updated from network sync!');
            refreshVault(false);
            refreshOTPs(false);
            showToast('Vault refreshed from sync');
          });
        }
      } else {
        setGridStatus('disconnected');
        log('Connection notice: ' + r.error);
      }
    } catch (e: any) {
      setGridStatus('disconnected');
      log('Error: ' + e.message);
    }
  }

  async function onStopGrid() {
    try {
      await (window as any).nexVault.stopNexGrid();
      setGridStatus('disconnected');
      log('NexGrid stopped.');
    } catch (e: any) { log('Error: ' + e.message); }
  }

  async function onPairWithCode() {
    if (!pairingCode || pairingCode.trim().length < 6) return showToast('Enter valid 6-digit code');
    log(`Pairing with code ${pairingCode}...`);
    try {
      const r = await (window as any).nexVault.pairWithCode(pairingCode.trim());
      if (r.success) {
        log('Pairing successful! Devices synced.');
        showToast('Successfully paired!');
        setPairingCode('');
        setGridStatus('paired');
        await loadDevices();
        await refreshVault(false);
        await refreshOTPs(false);
      } else {
        log('Pairing notice: ' + (r.error || 'Failed to pair with code'));
        showToast(r.error || 'Pairing failed. Check code.');
      }
    } catch (e: any) {
      log('Error pairing: ' + e.message);
      showToast('Pair error: ' + e.message);
    }
  }

  async function onApproveIncoming() {
    if (!incomingRequest) return;
    try {
      await (window as any).nexVault.approvePairRequest(incomingRequest.from);
      log(`Approved pairing with ${incomingRequest.from}`);
      showToast('Pairing approved!');
      setIncomingRequest(null);
      await loadDevices();
      await refreshVault(false);
    } catch (e: any) {
      showToast('Error approving: ' + e.message);
    }
  }

  async function onRejectIncoming() {
    if (!incomingRequest) return;
    try {
      await (window as any).nexVault.rejectPairRequest(incomingRequest.from);
      log(`Rejected pairing from ${incomingRequest.from}`);
      setIncomingRequest(null);
    } catch (e: any) {
      showToast('Error rejecting: ' + e.message);
    }
  }

  // Passwords Handlers
  async function onSavePassword() {
    if (!service || !credential) return setStatus('Enter service and password');
    try {
      const r = await (window as any).nexVault.addPassword(service, credential, vaultUsername);
      if (r.success) {
        setService('');
        setVaultUsername('');
        setCredential('');
        setShowAddVault(false);
        refreshVault(false);
        showToast('Password saved.');
      } else throw new Error(r.error);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function refreshVault(interactive = true) {
    if (interactive) setIsSyncing(true);
    try {
      await (window as any).nexVault.syncWithPeers();
      const r = await (window as any).nexVault.listPasswords();
      setVaultItems(r.entries || []);
      if (interactive) showToast(`Refreshed ${r.entries?.length || 0} credentials`);
    } catch (err: any) {
      if (interactive) showToast('Sync error: ' + err.message);
    } finally {
      if (interactive) setIsSyncing(false);
    }
  }

  async function copyPassword(serviceName: string) {
    try {
      const res = await (window as any).nexVault.getPassword(serviceName);
      if (res && res.success && res.password) {
        await navigator.clipboard.writeText(res.password);
        showToast(`Copied password for ${serviceName}`);
      } else {
        showToast('Failed to retrieve password');
      }
    } catch (err: any) {
      showToast('Copy error: ' + err.message);
    }
  }

  async function copyUsername(user: string) {
    try {
      await navigator.clipboard.writeText(user);
      showToast(`Copied username: ${user}`);
    } catch {
      showToast('Copy error');
    }
  }

  async function deletePassword(serviceName: string) {
    if (!confirm(`Delete credential for ${serviceName}?`)) return;
    try {
      await (window as any).nexVault.deletePassword(serviceName);
      refreshVault(false);
      showToast(`Deleted ${serviceName}`);
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  // OTP Handlers
  async function onSaveOTP() {
    const s = otpService.trim();
    const sec = otpSecret.trim().toUpperCase().replace(/\s/g, '');
    if (!s || !sec) return setStatus('Enter service and secret key');
    try {
      const r = await (window as any).nexVault.addOTP(s, sec);
      if (r.success) {
        setOtpService('');
        setOtpSecret('');
        setShowAddOtp(false);
        refreshOTPs(false);
        showToast('TOTP authenticator added.');
      } else throw new Error(r.error);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  async function refreshOTPs(interactive = true) {
    if (interactive) setIsSyncing(true);
    try {
      await (window as any).nexVault.syncWithPeers();
      const r = await (window as any).nexVault.listOTPs();
      setOtpItems(r.entries || []);
      if (interactive) showToast(`Refreshed ${r.entries?.length || 0} TOTP codes`);
    } catch (err: any) {
      if (interactive) showToast('Refresh error: ' + err.message);
    } finally {
      if (interactive) setIsSyncing(false);
    }
  }

  async function copyOTP(code?: string) {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast(`Copied TOTP code: ${code}`);
    } catch {
      showToast('Copy error');
    }
  }

  async function deleteOTP(serviceName: string) {
    if (!confirm(`Delete TOTP for ${serviceName}?`)) return;
    try {
      await (window as any).nexVault.deleteOTP(serviceName);
      refreshOTPs(false);
      showToast(`Deleted ${serviceName}`);
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  function copyBootstrapToken() {
    if (!tokenJson) return;
    navigator.clipboard.writeText(tokenJson);
    showToast('Token copied to clipboard');
  }

  const filteredVaultItems = vaultItems.filter(v => {
    if (!vaultSearch) return true;
    const q = vaultSearch.toLowerCase();
    return v.service.toLowerCase().includes(q) || (v.username && v.username.toLowerCase().includes(q));
  });

  return (
    <div className="nv-app">
      <div className="nv-app-layer">
        
        {/* Header */}
        <header className="nv-app-header">
          <div className="nv-app-brand">
            <img src="/icon.png" alt="NextVault" style={{ width: 24, height: 24, borderRadius: 5, objectFit: 'contain' }} />
            <span className="nv-app-title">Next<span>Vault</span></span>
            <span className="nv-badge" style={{ fontSize: '0.62rem' }}>v{CURRENT_VERSION}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {unlocked && (
              <button
                className="nv-btn nv-btn-ghost"
                style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
                onClick={onLockVault}
              >
                Lock
              </button>
            )}
            <StatusPill ok={unlocked} label={unlocked ? 'unlocked' : 'locked'} />
          </div>
        </header>

        {/* Update Notification Banner */}
        {updateInfo && updateInfo.hasUpdate && (
          <div style={{
            margin: '0.75rem 1rem 0',
            padding: '0.75rem 1rem',
            background: 'var(--nv-accent-light)',
            border: '1px solid var(--nv-border-accent)',
            borderRadius: 'var(--nv-radius-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.82rem' }}>Update Available: v{updateInfo.latestVersion}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--nv-muted)' }}>A newer Android APK is available.</div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                className="nv-btn nv-btn-accent nv-btn-sm"
                disabled={isUpdating}
                onClick={onApplyMobileUpdate}
              >
                {isUpdating ? 'Installing...' : 'Update & Install'}
              </button>
              <button
                className="nv-btn nv-btn-ghost nv-btn-sm"
                onClick={() => setUpdateInfo(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="nv-app-main">
          {!unlocked ? (
            /* LOCKED AUTH SCREEN */
            <Card style={{ margin: 'auto 0' }}>
              <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                <img src="/icon.png" alt="NextVault" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: '0.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
                <h1 className="nv-title" style={{ fontSize: '1.35rem', marginTop: '0.25rem' }}>NextVault Mobile</h1>
                <p className="nv-muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                  Local-first password manager &amp; authenticator.
                </p>
              </div>

              <div className="nv-tabs" style={{ justifyContent: 'center' }}>
                <button
                  className={`nv-tab ${authMode === 'existing' ? 'active' : ''}`}
                  onClick={() => setAuthMode('existing')}
                >
                  Unlock Vault
                </button>
                <button
                  className={`nv-tab ${authMode === 'new' ? 'active' : ''}`}
                  onClick={() => setAuthMode('new')}
                >
                  New Vault
                </button>
              </div>

              {authMode === 'existing' ? (
                <div className="nv-form">
                  <div className="form-group">
                    <label className="nv-label">Master Password</label>
                    <input
                      className="nv-input"
                      type="password"
                      placeholder="Enter master password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  {(!tokenJson || tokenJson.length < 10) && (
                    <div className="form-group">
                      <label className="nv-label">Bootstrap Token (JSON from Desktop)</label>
                      <textarea
                        className="nv-textarea nv-mono"
                        rows={4}
                        placeholder='{"tokenId":"...","publicKey":"..."}'
                        value={tokenJson}
                        onChange={e => setTokenJson(e.target.value)}
                      />
                    </div>
                  )}
                  <button className="nv-btn" onClick={onExistingUser}>Unlock Vault</button>
                </div>
              ) : (
                <div className="nv-form">
                  <div className="form-group">
                    <label className="nv-label">Username</label>
                    <input
                      className="nv-input"
                      placeholder="Choose a username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      autoComplete="username"
                    />
                  </div>
                  <div className="form-group">
                    <label className="nv-label">Master Password</label>
                    <input
                      className="nv-input"
                      type="password"
                      placeholder="Choose master password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <button className="nv-btn" onClick={onNewUser}>Create Vault</button>
                </div>
              )}

              <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', textAlign: 'center', marginTop: '1rem', marginBottom: 0 }}>
                {status}
              </p>
            </Card>
          ) : (
            /* UNLOCKED MULTI-PAGE VIEWS */
            <>
              {/* PAGE 1: VAULT */}
              {activeTab === 'vault' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Vault Logins</div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => refreshVault(true)}>
                        {isSyncing ? 'Syncing...' : 'Sync'}
                      </button>
                      <button className="nv-btn nv-btn-sm" onClick={() => setShowAddVault(!showAddVault)}>
                        {showAddVault ? '✕ Close' : '+ Add'}
                      </button>
                    </div>
                  </div>

                  <div className="nv-search-bar">
                    <span>🔍</span>
                    <input
                      placeholder="Search passwords..."
                      value={vaultSearch}
                      onChange={e => setVaultSearch(e.target.value)}
                    />
                  </div>

                  {showAddVault && (
                    <Card style={{ marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>Add Credential</div>
                      <div className="nv-form">
                        <input
                          className="nv-input"
                          placeholder="Service / Website (e.g. github.com)"
                          value={service}
                          onChange={e => setService(e.target.value)}
                        />
                        <input
                          className="nv-input"
                          placeholder="Username / Email"
                          value={vaultUsername}
                          onChange={e => setVaultUsername(e.target.value)}
                        />
                        <input
                          className="nv-input"
                          placeholder="Credential / Password"
                          value={credential}
                          onChange={e => setCredential(e.target.value)}
                        />
                        <div className="nv-btn-row">
                          <button className="nv-btn" onClick={onSavePassword}>Save Credential</button>
                          <button className="nv-btn nv-btn-ghost" onClick={() => setShowAddVault(false)}>Cancel</button>
                        </div>
                      </div>
                    </Card>
                  )}

                  {filteredVaultItems.length === 0 ? (
                    <div className="nv-empty">
                      No credentials found. Connect to Desktop via NexGrid to sync your logins!
                    </div>
                  ) : (
                    filteredVaultItems.map(v => (
                      <div className="nv-vault-item" key={v.service}>
                        <div className="nv-vault-info">
                          <span className="nv-vault-service">{v.service}</span>
                          <span className="nv-vault-meta">
                            {v.username ? `👤 ${v.username}` : `Saved ${new Date(v.createdAt).toLocaleDateString()}`}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            onClick={() => copyPassword(v.service)}
                          >
                            Copy Pass
                          </button>
                          {v.username && (
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              onClick={() => copyUsername(v.username!)}
                            >
                              Copy User
                            </button>
                          )}
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            style={{ color: 'var(--nv-danger)' }}
                            onClick={() => deletePassword(v.service)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* PAGE 2: AUTHENTICATOR (OTP) */}
              {activeTab === 'otp' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Authenticator</div>
                      <span className="nv-badge" style={{ fontSize: '0.65rem' }}>Refreshes in {countdown}s</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => refreshOTPs(true)}>
                        {isSyncing ? 'Syncing...' : 'Sync'}
                      </button>
                      <button className="nv-btn nv-btn-sm" onClick={() => setShowAddOtp(!showAddOtp)}>
                        {showAddOtp ? '✕ Close' : '+ Add TOTP'}
                      </button>
                    </div>
                  </div>

                  {showAddOtp && (
                    <Card style={{ marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>New Authenticator</div>
                      <div className="nv-form">
                        <input
                          className="nv-input"
                          placeholder="Service Name (e.g. GitHub)"
                          value={otpService}
                          onChange={e => setOtpService(e.target.value)}
                        />
                        <input
                          className="nv-input nv-mono"
                          placeholder="Base32 Secret Key"
                          value={otpSecret}
                          onChange={e => setOtpSecret(e.target.value)}
                        />
                        <div className="nv-btn-row">
                          <button className="nv-btn" onClick={onSaveOTP}>Save TOTP</button>
                          <button className="nv-btn nv-btn-ghost" onClick={() => setShowAddOtp(false)}>Cancel</button>
                        </div>
                      </div>
                    </Card>
                  )}

                  {otpItems.length === 0 ? (
                    <div className="nv-empty">No TOTP authenticators added yet.</div>
                  ) : (
                    otpItems.map(o => (
                      <div className="nv-vault-item" key={o.service}>
                        <div className="nv-vault-info">
                          <span className="nv-vault-service">{o.service}</span>
                          <span style={{
                            fontSize: '1.25rem',
                            fontFamily: 'var(--nv-font-mono)',
                            fontWeight: 700,
                            color: 'var(--nv-primary)',
                            letterSpacing: '3px'
                          }}>
                            {o.code || '------'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            className="nv-btn nv-btn-accent nv-btn-sm"
                            onClick={() => copyOTP(o.code)}
                          >
                            Copy Code
                          </button>
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            style={{ color: 'var(--nv-danger)' }}
                            onClick={() => deleteOTP(o.service)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* PAGE 3: NEXGRID */}
              {activeTab === 'grid' && (
                <div>
                  <Card style={{ marginBottom: '1rem' }}>
                    <div className="nv-panel-header">
                      <span className="nv-panel-title">NexGrid Mesh Connection</span>
                      <StatusPill ok={gridStatus === 'paired' || gridStatus === 'connected'} label={gridStatus} />
                    </div>

                    <div style={{ marginBottom: '0.65rem' }}>
                      <label className="nv-label">Relay Server URL</label>
                      <input
                        className="nv-input nv-mono"
                        value={relayUrl}
                        onChange={e => setRelayUrl(e.target.value)}
                        placeholder="ws://10.0.2.2:46123 or ws://192.168.1.X:46123"
                        style={{ fontSize: '0.8rem' }}
                      />
                    </div>

                    <div className="nv-btn-row">
                      <button className="nv-btn nv-btn-sm" onClick={onStartGrid}>
                        {gridStatus === 'disconnected' ? 'Start NexGrid' : 'Reconnect'}
                      </button>
                      {gridStatus !== 'disconnected' && (
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={onStopGrid}>Stop</button>
                      )}
                    </div>
                  </Card>

                  {/* Pair with 6-digit Code */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                      Enter Desktop Pairing Code
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--nv-muted)', margin: '0 0 0.65rem' }}>
                      Generate a pairing code on your Desktop NextVault app and enter it here.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        className="nv-input nv-mono"
                        placeholder="e.g. 543210"
                        value={pairingCode}
                        maxLength={8}
                        onChange={e => setPairingCode(e.target.value)}
                        style={{ fontSize: '1.05rem', letterSpacing: '3px', fontWeight: 700 }}
                      />
                      <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={onPairWithCode}>
                        Pair Code
                      </button>
                    </div>
                  </Card>

                  {/* Incoming Request Alert */}
                  {incomingRequest && (
                    <Card style={{ marginBottom: '1rem', background: 'var(--nv-primary-light)', borderColor: 'var(--nv-primary)' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
                        Pairing Request from "{incomingRequest.deviceName}"
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                        <button className="nv-btn nv-btn-sm" onClick={onApproveIncoming}>Approve &amp; Sync</button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={onRejectIncoming}>Reject</button>
                      </div>
                    </Card>
                  )}

                  {/* Trusted Devices List */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.85rem' }}>Paired Devices</span>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={loadDevices}>Reload</button>
                    </div>

                    {trustedDevices.length === 0 ? (
                      <div className="nv-empty" style={{ padding: '0.75rem', fontSize: '0.75rem' }}>
                        No paired devices yet. Devices will auto-reconnect once paired.
                      </div>
                    ) : (
                      trustedDevices.map(d => (
                        <div
                          key={d.deviceId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.65rem',
                            background: 'var(--nv-bg-2)',
                            border: '1px solid var(--nv-border)',
                            borderRadius: 'var(--nv-radius-sm)',
                            marginBottom: '0.4rem',
                            fontSize: '0.75rem'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: '#fff' }}>{d.deviceName || 'Desktop'}</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--nv-muted)', fontFamily: 'var(--nv-font-mono)' }}>{d.deviceId}</div>
                          </div>
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            style={{ color: 'var(--nv-danger)', padding: '0.2rem 0.45rem', fontSize: '0.65rem' }}
                            onClick={() => onRevokeDevice(d.deviceId)}
                          >
                            Revoke
                          </button>
                        </div>
                      ))
                    )}
                  </Card>

                  {/* Network Log */}
                  <div className="nv-terminal" style={{ maxHeight: '140px', overflowY: 'auto' }}>
                    {gridLog.length ? gridLog.join('\n') : '>> NexGrid ready.'}
                  </div>
                </div>
              )}

              {/* PAGE 4: SETTINGS */}
              {activeTab === 'settings' && (
                <div>
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.35rem' }}>Vault Identity &amp; Token</div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Your cryptographically signed identity token.
                    </p>
                    {tokenJson ? (
                      <>
                        <textarea
                          className="nv-textarea nv-mono"
                          rows={4}
                          readOnly
                          value={tokenJson}
                          style={{ fontSize: '0.72rem', marginBottom: '0.5rem' }}
                        />
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={copyBootstrapToken}>
                          Copy Token JSON
                        </button>
                      </>
                    ) : (
                      <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)' }}>No token loaded in memory.</p>
                    )}
                  </Card>

                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Application Updates</div>
                      <span className="nv-badge">v{CURRENT_VERSION}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Check GitHub releases for seamless in-place updates.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => checkMobileUpdates(true)}>
                        Check for Updates
                      </button>
                      {updateInfo && updateInfo.hasUpdate && (
                        <button
                          className="nv-btn nv-btn-accent nv-btn-sm"
                          disabled={isUpdating}
                          onClick={onApplyMobileUpdate}
                        >
                          {isUpdating ? 'Installing...' : `Install v${updateInfo.latestVersion}`}
                        </button>
                      )}
                    </div>
                  </Card>

                  <Card style={{ borderColor: 'rgba(239, 68, 68, 0.25)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--nv-danger)', marginBottom: '0.35rem' }}>Session</div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Lock your vault to encrypt passwords and keys in memory.
                    </p>
                    <button className="nv-btn nv-btn-danger nv-btn-sm" onClick={onLockVault}>
                      Lock Vault Now
                    </button>
                  </Card>
                </div>
              )}
            </>
          )}
        </main>

        {/* Global Toast */}
        {toastMsg && (
          <div className="nv-toast">
            {toastMsg}
          </div>
        )}

        {/* Bottom Navigation Bar (Visible when unlocked) */}
        {unlocked && (
          <nav className="nv-bottom-nav">
            <button
              className={`nv-nav-button ${activeTab === 'vault' ? 'active' : ''}`}
              onClick={() => setActiveTab('vault')}
            >
              <span className="nav-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-1.5 1.5L16 7l-1.5-1.5M16 7l-4 4m0 0a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Z"/></svg>
              </span>
              <span>Vault</span>
            </button>
            <button
              className={`nv-nav-button ${activeTab === 'otp' ? 'active' : ''}`}
              onClick={() => setActiveTab('otp')}
            >
              <span className="nav-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
              <span>OTP</span>
            </button>
            <button
              className={`nv-nav-button ${activeTab === 'grid' ? 'active' : ''}`}
              onClick={() => setActiveTab('grid')}
            >
              <span className="nav-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="6" height="6" x="9" y="2" rx="1"/><rect width="6" height="6" x="2" y="16" rx="1"/><rect width="6" height="6" x="16" y="16" rx="1"/><path d="M12 8v4m0 0H5v4m7-4h7v4"/></svg>
              </span>
              <span>NexGrid</span>
            </button>
            <button
              className={`nv-nav-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <span className="nav-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              </span>
              <span>Settings</span>
            </button>
          </nav>
        )}

      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}

export default App;
