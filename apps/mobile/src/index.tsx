import { useState, useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './cyber/cyber.css';
import './main.css';
import { getSavedRelayUrl, CURRENT_VERSION, parseOtpAuthUri, parseBulkImport, clearAutofillCredentials, syncAutofillCredentials, mergeNativeAutofillCredentials, openAutofillSettings } from './mobileVault';
import { startCameraQrScanner, scanQrFromImageSource, requestCameraPermission } from './qrScanner';

/** Copies a secret and clears the clipboard after 30s if it still holds that value. */
async function copySecret(value: string) {
  await navigator.clipboard.writeText(value);
  setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText('');
    } catch {
      try { await navigator.clipboard.writeText(''); } catch {}
    }
  }, 30000);
}

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

function QrScannerModal({
  onDetected,
  onClose,
  showToast
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [manualUri, setManualUri] = useState('');
  const [isRequestingPerm, setIsRequestingPerm] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let stopFn: (() => void) | null = null;
    let isMounted = true;

    async function initCamera() {
      // Proactively ensure permission is requested
      await requestCameraPermission();

      if (!isMounted) return;

      if (videoRef.current) {
        try {
          const stop = await startCameraQrScanner(
            videoRef.current,
            (detected) => {
              onDetected(detected);
            },
            (err) => {
              if (isMounted) {
                setCamErr(err?.message?.includes('Permission') || err?.name === 'NotAllowedError'
                  ? 'Camera permission was denied. Tap "Grant Camera Permission" below or select an image screenshot.'
                  : 'Camera access not available on this device. You can upload an image or paste the link below.');
              }
            }
          );
          if (isMounted) {
            stopFn = stop;
            setCamErr(null);
          } else {
            stop();
          }
        } catch {
          if (isMounted) {
            setCamErr('Camera permission needed to scan QR code.');
          }
        }
      }
    }

    initCamera();

    return () => {
      isMounted = false;
      if (stopFn) stopFn();
    };
  }, [retryKey]);

  async function handleGrantPermission() {
    setIsRequestingPerm(true);
    try {
      const granted = await requestCameraPermission();
      if (granted) {
        showToast('Camera permission granted! Connecting camera...');
        setCamErr(null);
        setRetryKey(k => k + 1);
      } else {
        setCamErr('Permission not granted yet. Please allow Camera in device Settings > Apps > NextVault.');
      }
    } catch (e: any) {
      setCamErr('Permission request error: ' + (e?.message || e));
    } finally {
      setIsRequestingPerm(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast('Scanning image for QR code...');
    const result = await scanQrFromImageSource(file);
    if (result) {
      onDetected(result);
    } else {
      showToast('Could not detect a QR code in this image.');
    }
  }

  function handleManualSubmit() {
    if (!manualUri.trim()) return;
    onDetected(manualUri.trim());
  }

  return (
    <div className="nv-modal-backdrop" onClick={onClose}>
      <div className="nv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="nv-modal-header">
          <div className="nv-modal-title">📷 Scan 2FA QR Code</div>
          <button className="nv-btn nv-btn-ghost nv-btn-sm" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="nv-modal-body">
          <div className="nv-qr-viewfinder">
            <video ref={videoRef} className="nv-qr-video" playsInline autoPlay muted />
            <div className="nv-qr-target" />
          </div>

          {camErr && (
            <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: 'var(--nv-radius-sm)', padding: '0.65rem', textAlign: 'center' }}>
              <div style={{ color: 'var(--nv-danger)', fontSize: '0.78rem', marginBottom: '0.45rem', lineHeight: '1.4' }}>
                {camErr}
              </div>
              <button
                type="button"
                className="nv-btn nv-btn-accent nv-btn-sm"
                disabled={isRequestingPerm}
                onClick={handleGrantPermission}
              >
                {isRequestingPerm ? 'Requesting Permission...' : '📷 Grant Camera Permission'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileSelected}
            />
            <button
              className="nv-btn nv-btn-ghost nv-btn-sm"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Choose QR Screenshot / Image
            </button>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                className="nv-input nv-mono"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.6rem' }}
                placeholder="Or paste otpauth:// link..."
                value={manualUri}
                onChange={e => setManualUri(e.target.value)}
              />
              <button
                className="nv-btn nv-btn-sm"
                type="button"
                onClick={handleManualSubmit}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
        <div className="nv-modal-footer">
          <button className="nv-btn nv-btn-ghost nv-btn-sm" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function BulkImportModal({
  type,
  onClose,
  showToast,
  onImportDone
}: {
  type: 'vault' | 'otp' | 'all';
  onClose: () => void;
  showToast: (msg: string) => void;
  onImportDone: () => void;
}) {
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<{ passwords: any[]; otps: any[] }>({ passwords: [], otps: [] });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onTextChange(val: string) {
    setRawText(val);
    if (!val.trim()) {
      setParsed({ passwords: [], otps: [] });
      return;
    }
    const res = parseBulkImport(val);
    setParsed({ passwords: res.passwords || [], otps: res.otps || [] });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        onTextChange(text);
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setBusy(true);
    let total = 0;
    try {
      if (parsed.passwords.length > 0 && (window as any).nexVault?.bulkImportPasswords) {
        const r = await (window as any).nexVault.bulkImportPasswords(parsed.passwords);
        if (r && r.success) total += r.count || parsed.passwords.length;
      }
      if (parsed.otps.length > 0 && (window as any).nexVault?.bulkImportOTPs) {
        const r = await (window as any).nexVault.bulkImportOTPs(parsed.otps);
        if (r && r.success) total += r.count || parsed.otps.length;
      }
      showToast(`✅ Successfully imported ${total} credentials into mesh!`);
      onImportDone();
      onClose();
    } catch (err: any) {
      showToast('Import error: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  const title = type === 'otp' ? 'Bulk Import 2FA Accounts' : (type === 'vault' ? 'Bulk Import Passwords' : 'Bulk Import Credentials & 2FA');

  return (
    <div className="nv-modal-backdrop" onClick={onClose}>
      <div className="nv-modal" onClick={e => e.stopPropagation()}>
        <div className="nv-modal-header">
          <div className="nv-modal-title">{title}</div>
          <button className="nv-btn nv-btn-ghost nv-btn-sm" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="nv-modal-body">
          <div style={{ fontSize: '0.8rem', color: 'var(--nv-muted)', lineHeight: '1.4' }}>
            Supports Chrome, Bitwarden, 1Password CSV/JSON exports, and <code>otpauth://</code> 2FA lists.
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="file" ref={fileRef} accept=".csv,.json,.txt" style={{ display: 'none' }} onChange={onFileChange} />
            <button className="nv-btn nv-btn-accent nv-btn-sm" type="button" onClick={() => fileRef.current?.click()}>
              Choose File (.csv, .json)
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--nv-muted)' }}>{fileName || 'No file selected'}</span>
          </div>

          <div>
            <label className="nv-label">Or paste CSV, JSON, or otpauth:// links:</label>
            <textarea
              className="nv-input nv-mono"
              rows={5}
              style={{ fontSize: '0.75rem' }}
              placeholder="Paste data here..."
              value={rawText}
              onChange={e => onTextChange(e.target.value)}
            />
          </div>

          {(parsed.passwords.length > 0 || parsed.otps.length > 0) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, color: '#fff', marginBottom: '0.4rem' }}>
                <span>Detected Records:</span>
                <span className="nv-badge success">{parsed.passwords.length} Passwords, {parsed.otps.length} 2FA</span>
              </div>
              <div className="nv-import-preview">
                {parsed.passwords.slice(0, 30).map((p, i) => (
                  <div className="nv-import-tag" key={'p-' + i}>
                    <span>🔑 <strong>{p.service}</strong> {p.username ? `(${p.username})` : ''}</span>
                    <span style={{ color: 'var(--nv-muted)', fontSize: '0.7rem' }}>Password</span>
                  </div>
                ))}
                {parsed.otps.slice(0, 30).map((o, i) => (
                  <div className="nv-import-tag" key={'o-' + i}>
                    <span>⏳ <strong>{o.service}</strong></span>
                    <span style={{ color: 'var(--nv-primary)', fontSize: '0.7rem' }}>2FA TOTP</span>
                  </div>
                ))}
                {(parsed.passwords.length + parsed.otps.length) > 60 && (
                  <div style={{ textAlign: 'center', color: 'var(--nv-muted)', fontSize: '0.7rem', padding: '0.2rem' }}>
                    + {(parsed.passwords.length + parsed.otps.length) - 60} more items...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="nv-modal-footer">
          <button className="nv-btn nv-btn-ghost nv-btn-sm" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="nv-btn nv-btn-sm"
            type="button"
            onClick={handleImport}
            disabled={busy || (parsed.passwords.length === 0 && parsed.otps.length === 0)}
          >
            {busy ? 'Importing...' : 'Import to Vault & Mesh'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TabType = 'vault' | 'quick-fill' | 'otp' | 'grid' | 'settings';
type QuickFillView = 'vault' | 'generator' | 'settings';

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
  const [quickFillView, setQuickFillView] = useState<QuickFillView>('vault');
  const [quickFillSearch, setQuickFillSearch] = useState('');
  const [quickFillStatus, setQuickFillStatus] = useState('Ready');
  const [quickFillPassword, setQuickFillPassword] = useState('');
  const [quickFillPasswordLength, setQuickFillPasswordLength] = useState(24);
  const [showAddVault, setShowAddVault] = useState(false);
  const [editingVaultService, setEditingVaultService] = useState<string | null>(null);
  const [service, setService] = useState('');
  const [vaultUsername, setVaultUsername] = useState('');
  const [credential, setCredential] = useState('');

  // OTP State
  const [otpItems, setOtpItems] = useState<{ service: string; code?: string }[]>([]);
  const [showAddOtp, setShowAddOtp] = useState(false);
  const [editingOtpService, setEditingOtpService] = useState<string | null>(null);
  const [otpService, setOtpService] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [countdown, setCountdown] = useState(30);

  // NexGrid State
  const [relayUrl, setRelayUrl] = useState(() => getSavedRelayUrl());
  const [gridStatus, setGridStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'paired'>('disconnected');
  const [pairingCode, setPairingCode] = useState('');
  const [generatedPairCode, setGeneratedPairCode] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; deviceName: string } | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<{ deviceId: string; deviceName?: string; pairedAt?: string }[]>([]);
  const [gridLog, setGridLog] = useState<string[]>([]);

  // Sync & Updates
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion: string; downloadUrl?: string } | null>(null);

  // Bulk Import & QR Scanning State
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [importModalType, setImportModalType] = useState<'vault' | 'otp' | 'all' | null>(null);

  // Instant Copy Feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function markCopied(key: string) {
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(prev => (prev === key ? null : prev));
    }, 1800);
  }

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  function generateQuickFillPassword(length = quickFillPasswordLength) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_+=';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => charset[byte % charset.length]).join('');
  }

  function openQuickFill() {
    setActiveTab('quick-fill');
    setQuickFillView('vault');
    setQuickFillStatus('Ready');
    if (!quickFillPassword) setQuickFillPassword(generateQuickFillPassword());
  }

  async function copyQuickFillCredential(serviceName: string, kind: 'password' | 'username') {
    try {
      const result = await (window as any).nexVault.getPassword(serviceName);
      const value = kind === 'password' ? result?.password : result?.username;
      if (!result?.success || !value) throw new Error(kind === 'password' ? 'Password unavailable' : 'Username unavailable');
      await copySecret(value);
      setQuickFillStatus(`${kind === 'password' ? 'Password' : 'Username'} copied`);
      showToast(`${kind === 'password' ? 'Password' : 'Username'} copied for ${serviceName}`);
    } catch (error: any) {
      setQuickFillStatus('Copy failed');
      showToast(error.message || 'Could not copy credential');
    }
  }

  function refreshQuickFillPassword(length = quickFillPasswordLength) {
    setQuickFillPasswordLength(length);
    setQuickFillPassword(generateQuickFillPassword(length));
    setQuickFillStatus('New password generated');
  }

  function onQrCodeDetected(rawCode: string) {
    setIsScanningQr(false);
    const parsed = parseOtpAuthUri(rawCode);
    if (parsed) {
      setOtpService(parsed.service);
      setOtpSecret(parsed.secret);
      setShowAddOtp(true);
      setActiveTab('otp');
      showToast(`Scanned QR for "${parsed.service}". Click Save to add.`);
    } else {
      const cleaned = rawCode.trim().replace(/\s+/g, '').toUpperCase();
      if (/^[A-Z2-7]{16,64}$/.test(cleaned)) {
        setOtpSecret(cleaned);
        setShowAddOtp(true);
        setActiveTab('otp');
        showToast('Detected Base32 TOTP secret from QR code!');
      } else {
        showToast('Scanned code is not a valid otpauth:// URI');
      }
    }
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

  // Auto-lock: after 2 minutes in the background, or 5 minutes of inactivity.
  useEffect(() => {
    if (!unlocked) return;
    let hiddenAt: number | null = null;
    let lastActive = Date.now();
    const touch = () => { lastActive = Date.now(); };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000) {
        onLockVault();
      } else {
        hiddenAt = null;
        touch();
      }
    };
    const idle = setInterval(() => {
      if (Date.now() - lastActive > 5 * 60 * 1000) onLockVault();
    }, 15000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('touchstart', touch, { passive: true });
    window.addEventListener('keydown', touch);
    return () => {
      clearInterval(idle);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('touchstart', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [unlocked]);

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

          const sessionActive = Boolean((window as any).nexVault.isUnlocked?.());
          if (sessionActive) {
            setUnlocked(true);
            await mergeNativeAutofillCredentials();
            syncAutofillCredentials();
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

    if ((window as any).nexVault?.onVaultUpdated) {
      (window as any).nexVault.onVaultUpdated(() => {
        refreshVault(false);
        refreshOTPs(false);
      });
    }
  }, []);

  async function onNewUser() {
    if (!username || !password) return setStatus('Enter username and password');
    setStatus('Generating keys...');
    try {
      const r = await (window as any).nexVault.initializeNewUser(username, password);
      if (!r.success) throw new Error(r.error);
      setStatus('Created identity: ' + r.tokenId);
      setTokenJson(JSON.stringify(r.bootstrapToken, null, 2));
      setUnlocked(true);
      syncAutofillCredentials();
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
      setUnlocked(true);
      syncAutofillCredentials();
      await mergeNativeAutofillCredentials();
      setStatus('Unlocked: ' + r.tokenId);
      refreshVault(false);
      refreshOTPs(false);
      loadDevices();
      setTimeout(() => onStartGrid(), 400);
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  function onLockVault() {
    (window as any).nexVault.lock?.();
    clearAutofillCredentials();
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
      if (relayUrl) {
        try { localStorage.setItem('nexvault_relay_url', relayUrl); } catch {}
      }
      const r = await (window as any).nexVault.startNexGrid({ relayUrl }, {
        onLog: (msg: string) => log(msg),
        onStatusChange: (s: any) => setGridStatus(s),
        onVaultSynced: () => {
          refreshVault(false);
          refreshOTPs(false);
          showToast('Vault updated from mesh sync');
        }
      });
      if (r.success) {
        setGridStatus('connected');
        log('NexGrid connected to relay.');
        loadDevices();
        if ((window as any).nexVault.onIncomingPairRequest) {
          (window as any).nexVault.onIncomingPairRequest(({ peerId, deviceName }: any) => {
            log(`🔔 Incoming pairing request from ${deviceName || peerId}`);
            setIncomingRequest({ from: peerId, deviceName: deviceName || 'Mesh Peer' });
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

  async function onGenerateMobilePairCode() {
    try {
      const res = await (window as any).nexVault.requestPairingCode();
      if (res && res.success) {
        setGeneratedPairCode(res.code);
        showToast(`Pairing code generated: ${res.code}`);
        log(`Generated pairing code ${res.code} (valid for 5 mins)`);
      } else {
        showToast(res?.error || 'Failed to generate code');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
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
        if (editingVaultService && editingVaultService !== service) {
          await (window as any).nexVault.deletePassword(editingVaultService);
        }
        setService('');
        setVaultUsername('');
        setCredential('');
        setEditingVaultService(null);
        setShowAddVault(false);
        refreshVault(false);
        showToast(editingVaultService ? 'Credential updated.' : 'Password saved.');
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
        await copySecret(res.password);
        markCopied(`pass-${serviceName}`);
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
      await copySecret(user);
      markCopied(`user-${user}`);
      showToast(`Copied username: ${user}`);
    } catch {
      showToast('Copy error');
    }
  }

  async function deletePassword(serviceName: string) {
    if (!confirm(`Delete credential for ${serviceName}?`)) return;
    try {
      await (window as any).nexVault.deletePassword(serviceName);
      const r = await (window as any).nexVault.listPasswords();
      setVaultItems(r.entries || []);
      showToast(`Deleted ${serviceName}`);
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  async function editPassword(serviceName: string) {
    try {
      const result = await (window as any).nexVault.getPassword(serviceName);
      if (!result?.success) throw new Error(result?.error || 'Credential not found');
      setEditingVaultService(serviceName);
      setService(serviceName);
      setVaultUsername(result.username || '');
      setCredential(result.password || '');
      setShowAddVault(true);
      setActiveTab('vault');
    } catch (err: any) {
      showToast('Edit error: ' + err.message);
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
        if (editingOtpService && editingOtpService !== s) {
          await (window as any).nexVault.deleteOTP(editingOtpService);
        }
        setOtpService('');
        setOtpSecret('');
        setEditingOtpService(null);
        setShowAddOtp(false);
        refreshOTPs(false);
        showToast(editingOtpService ? 'Authenticator updated.' : 'TOTP authenticator added.');
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

  async function copyOTP(code?: string, serviceName?: string) {
    if (!code) return;
    try {
      await copySecret(code);
      if (serviceName) markCopied(`otp-${serviceName}`);
      showToast(`Copied TOTP code: ${code}`);
    } catch {
      showToast('Copy error');
    }
  }

  async function deleteOTP(serviceName: string) {
    if (!confirm(`Delete TOTP for ${serviceName}?`)) return;
    try {
      await (window as any).nexVault.deleteOTP(serviceName);
      const r = await (window as any).nexVault.listOTPs();
      setOtpItems(r.entries || []);
      showToast(`Deleted ${serviceName}`);
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  async function editOTP(serviceName: string) {
    try {
      const entry = await (window as any).nexVault.getOTPDetails(serviceName);
      if (!entry?.success) throw new Error(entry?.error || 'Authenticator not found');
      setEditingOtpService(serviceName);
      setOtpService(serviceName);
      setOtpSecret(entry.secret || '');
      setShowAddOtp(true);
      setActiveTab('otp');
    } catch (err: any) {
      showToast('Edit error: ' + err.message);
    }
  }

  async function onDeleteAllVault() {
    if (!window.confirm('Are you sure you want to delete ALL passwords? This will delete them across all connected devices in the mesh.')) return;
    try {
      const r = await (window as any).nexVault.deleteAllPasswords();
      if (r && r.success) {
        showToast(`Deleted ${r.count || 0} passwords`);
        refreshVault(false);
      } else {
        throw new Error(r?.error || 'Failed to delete');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  async function onDeleteAllOTPs() {
    if (!window.confirm('Are you sure you want to delete ALL 2FA authenticators? This will delete them across all connected devices in the mesh.')) return;
    try {
      const r = await (window as any).nexVault.deleteAllOTPs();
      if (r && r.success) {
        showToast(`Deleted ${r.count || 0} authenticators`);
        refreshOTPs(false);
      } else {
        throw new Error(r?.error || 'Failed to delete');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  }

  async function onDeleteAllEverything() {
    if (!window.confirm('Are you sure you want to delete ALL passwords and 2FA authenticators? This will permanently wipe all credentials from this vault and all mesh devices.')) return;
    try {
      const r = await (window as any).nexVault.deleteAllVault();
      if (r && r.success) {
        showToast(`Wiped all ${r.totalCount || 0} vault items`);
        refreshVault(false);
        refreshOTPs(false);
      } else {
        throw new Error(r?.error || 'Failed to delete');
      }
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
            /* LOCKED AUTH SCREEN WITH HERO COVER BANNER */
            <div className="nv-hero-cover-card" style={{ margin: 'auto 0' }}>
              <div className="nv-hero-cover-media">
                <img src="/cover.jpg" alt="NextVault Cover" className="nv-hero-cover-img" />
                <div className="nv-hero-cover-gradient" />
                <div className="nv-hero-cover-content">
                  <span className="nv-hero-chip">P2P ENCRYPTED MESH</span>
                  <div className="nv-hero-brand">
                    <Shield size={36} />
                    <div>
                      <h1 className="nv-hero-title">Next<span>Vault</span></h1>
                      <p className="nv-hero-subtitle">Decentralized Zero-Knowledge Security</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="nv-hero-cover-body">
                <div className="nv-segmented-control">
                  <button
                    className={`nv-segment-btn ${authMode === 'existing' ? 'active' : ''}`}
                    onClick={() => setAuthMode('existing')}
                  >
                    Unlock Vault
                  </button>
                  <button
                    className={`nv-segment-btn ${authMode === 'new' ? 'active' : ''}`}
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
            </div>
          </div>
        ) : (
            /* UNLOCKED MULTI-PAGE VIEWS */
            <>
              {/* PAGE 1: MOBILE EXTENSION */}
              {activeTab === 'quick-fill' && (
                <section className="nv-extension-panel">
                  <div className="nv-extension-header">
                    <div className="nv-extension-brand">
                      <Shield size={24} />
                      <div>
                        <div className="nv-extension-title">Next<span>Vault</span></div>
                        <div className="nv-extension-subtitle">Mobile Quick Fill</div>
                      </div>
                    </div>
                    <div className="nv-extension-status">
                      <span className="dot" />
                      <span>{quickFillStatus}</span>
                    </div>
                  </div>

                  <div className="nv-extension-nav" role="tablist" aria-label="Quick Fill tools">
                    {(['vault', 'generator', 'settings'] as QuickFillView[]).map(view => (
                      <button
                        key={view}
                        className={`nv-extension-nav-btn ${quickFillView === view ? 'active' : ''}`}
                        onClick={() => setQuickFillView(view)}
                        role="tab"
                        aria-selected={quickFillView === view}
                      >
                        {view === 'vault' ? 'Vault' : view === 'generator' ? 'Generator' : 'Settings'}
                      </button>
                    ))}
                  </div>

                  {quickFillView === 'vault' && (
                    <div className="nv-extension-view">
                      <button className="nv-btn nv-extension-primary" onClick={() => refreshVault(true)}>
                        {isSyncing ? 'Syncing Vault...' : 'Refresh Mobile Vault'}
                      </button>
                      <div className="nv-extension-copy-note">
                        Copy a username or password into the mobile browser or app you are using.
                      </div>
                      <div className="nv-extension-search">
                        <span>⌕</span>
                        <input
                          value={quickFillSearch}
                          onChange={e => setQuickFillSearch(e.target.value)}
                          placeholder="Search vault credentials..."
                          aria-label="Search vault credentials"
                        />
                      </div>
                      <div className="nv-extension-result">
                        {vaultItems.filter(item => {
                          const query = quickFillSearch.toLowerCase().trim();
                          return !query || item.service.toLowerCase().includes(query) || (item.username || '').toLowerCase().includes(query);
                        }).length > 0 ? vaultItems.filter(item => {
                          const query = quickFillSearch.toLowerCase().trim();
                          return !query || item.service.toLowerCase().includes(query) || (item.username || '').toLowerCase().includes(query);
                        }).map(item => (
                          <div className="nv-extension-item" key={item.service}>
                            <div className="nv-extension-item-info">
                              <strong>{item.service}</strong>
                              <span>{item.username || 'No username saved'}</span>
                            </div>
                            <div className="nv-extension-item-actions">
                              {item.username && (
                                <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => copyQuickFillCredential(item.service, 'username')}>
                                  User
                                </button>
                              )}
                              <button className="nv-btn nv-btn-sm" onClick={() => copyQuickFillCredential(item.service, 'password')}>
                                Copy
                              </button>
                            </div>
                          </div>
                        )) : (
                          <span className="nv-extension-empty">{quickFillSearch ? `No matches for "${quickFillSearch}"` : '>> No credentials saved in mobile vault'}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {quickFillView === 'generator' && (
                    <div className="nv-extension-view">
                      <label className="nv-label" htmlFor="quick-fill-length">
                        Password Length: <strong>{quickFillPasswordLength}</strong> characters
                      </label>
                      <input
                        id="quick-fill-length"
                        className="nv-extension-range"
                        type="range"
                        min="12"
                        max="64"
                        value={quickFillPasswordLength}
                        onChange={e => refreshQuickFillPassword(Number(e.target.value))}
                      />
                      <input className="nv-input nv-mono nv-extension-password" value={quickFillPassword} readOnly aria-label="Generated password" />
                      <div className="nv-btn-row">
                        <button className="nv-btn" onClick={() => refreshQuickFillPassword()}>Generate New</button>
                        <button className="nv-btn nv-btn-ghost" onClick={async () => {
                          await copySecret(quickFillPassword);
                          setQuickFillStatus('Password copied');
                          showToast('Generated password copied');
                        }}>Copy</button>
                      </div>
                    </div>
                  )}

                  {quickFillView === 'settings' && (
                    <div className="nv-extension-view">
                      <div className="nv-extension-setting">
                        <span>Mobile vault</span>
                        <StatusPill ok label="Connected" />
                      </div>
                      <div className="nv-extension-copy-note">
                        Quick Fill is powered by this unlocked mobile vault. It uses the same credentials as Vault and syncs through NexGrid.
                      </div>
                      <button className="nv-btn nv-btn-ghost" onClick={copyBootstrapToken}>Copy Account Token</button>
                      <button className="nv-btn nv-btn-ghost" onClick={async () => {
                        await openAutofillSettings();
                        setQuickFillStatus('Choose NexVault as Autofill service');
                      }}>Enable Browser Autofill</button>
                      <button className="nv-btn nv-btn-danger" onClick={onLockVault}>Lock Mobile Vault</button>
                    </div>
                  )}
                </section>
              )}

              {/* PAGE 2: VAULT */}
              {activeTab === 'vault' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Vault Logins</div>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      {vaultItems.length > 0 && (
                        <button
                          className="nv-btn nv-btn-ghost nv-btn-sm"
                          style={{ color: 'var(--nv-danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                          onClick={onDeleteAllVault}
                          title="Delete all passwords from vault and mesh"
                        >
                          🗑 Delete All
                        </button>
                      )}
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => refreshVault(true)}>
                        {isSyncing ? 'Syncing...' : 'Sync'}
                      </button>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => setImportModalType('vault')}>
                        📥 Import
                      </button>
                      <button className="nv-btn nv-btn-sm" onClick={() => {
                        if (!showAddVault) {
                          setEditingVaultService(null);
                          setService('');
                          setVaultUsername('');
                          setCredential('');
                        }
                        setShowAddVault(!showAddVault);
                      }}>
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
                    {vaultSearch && (
                      <button className="nv-search-clear" onClick={() => setVaultSearch('')} title="Clear">
                        ✕
                      </button>
                    )}
                  </div>

                  {showAddVault && (
                    <Card style={{ marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>{editingVaultService ? 'Edit Credential' : 'Add Credential'}</div>
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
                          <button className="nv-btn" onClick={onSavePassword}>{editingVaultService ? 'Update Credential' : 'Save Credential'}</button>
                          <button className="nv-btn nv-btn-ghost" onClick={() => {
                            setShowAddVault(false);
                            setEditingVaultService(null);
                            setService('');
                            setVaultUsername('');
                            setCredential('');
                          }}>Cancel</button>
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
                        <div className="nv-vault-left">
                          <div className="nv-avatar-monogram">
                            {(v.service.charAt(0) || 'V').toUpperCase()}
                          </div>
                          <div className="nv-vault-info">
                            <span className="nv-vault-service">{v.service}</span>
                            <span className="nv-vault-meta">
                              {v.username ? `👤 ${v.username}` : `Saved ${new Date(v.createdAt).toLocaleDateString()}`}
                            </span>
                          </div>
                        </div>
                        <div className="nv-vault-actions">
                          <button
                            className="nv-btn nv-btn-sm"
                            style={copiedKey === `pass-${v.service}` ? { background: 'rgba(16, 185, 129, 0.2)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : { background: 'transparent' }}
                            onClick={() => copyPassword(v.service)}
                          >
                            {copiedKey === `pass-${v.service}` ? '✓ Copied' : 'Copy'}
                          </button>
                          {v.username && (
                            <button
                              className="nv-btn nv-btn-sm"
                              style={copiedKey === `user-${v.username}` ? { background: 'rgba(16, 185, 129, 0.2)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : { background: 'transparent' }}
                              onClick={() => copyUsername(v.username!)}
                            >
                              {copiedKey === `user-${v.username}` ? '✓ User' : 'User'}
                            </button>
                          )}
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            onClick={() => editPassword(v.service)}
                            title="Edit credential"
                          >
                            Edit
                          </button>
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            style={{ color: 'var(--nv-danger)', padding: '0.35rem 0.55rem' }}
                            onClick={() => deletePassword(v.service)}
                            title="Delete credential"
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Authenticator</div>
                      <span className="nv-badge" style={{ fontSize: '0.65rem' }}>Refreshes in {countdown}s</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      {otpItems.length > 0 && (
                        <button
                          className="nv-btn nv-btn-ghost nv-btn-sm"
                          style={{ color: 'var(--nv-danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                          onClick={onDeleteAllOTPs}
                          title="Delete all 2FA accounts from vault and mesh"
                        >
                          🗑 Delete All
                        </button>
                      )}
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => refreshOTPs(true)}>
                        {isSyncing ? 'Syncing...' : 'Sync'}
                      </button>
                      <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={() => setIsScanningQr(true)}>
                        📷 Scan QR
                      </button>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => setImportModalType('otp')}>
                        📥 Import
                      </button>
                      <button className="nv-btn nv-btn-sm" onClick={() => {
                        if (!showAddOtp) {
                          setEditingOtpService(null);
                          setOtpService('');
                          setOtpSecret('');
                        }
                        setShowAddOtp(!showAddOtp);
                      }}>
                        {showAddOtp ? '✕ Close' : '+ Add'}
                      </button>
                    </div>
                  </div>

                  {showAddOtp && (
                    <Card style={{ marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>{editingOtpService ? 'Edit Authenticator' : 'New Authenticator'}</div>
                      <div className="nv-form">
                        <input
                          className="nv-input"
                          placeholder="Service Name (e.g. GitHub)"
                          value={otpService}
                          onChange={e => setOtpService(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            className="nv-input nv-mono"
                            placeholder="Base32 Secret Key"
                            value={otpSecret}
                            onChange={e => setOtpSecret(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="nv-btn nv-btn-accent nv-btn-sm"
                            onClick={() => setIsScanningQr(true)}
                            title="Scan QR Code"
                            style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}
                          >
                            📷 Scan QR
                          </button>
                        </div>
                        <div className="nv-btn-row">
                          <button className="nv-btn" onClick={onSaveOTP}>{editingOtpService ? 'Update TOTP' : 'Save TOTP'}</button>
                          <button className="nv-btn nv-btn-ghost" onClick={() => {
                            setShowAddOtp(false);
                            setEditingOtpService(null);
                            setOtpService('');
                            setOtpSecret('');
                          }}>Cancel</button>
                        </div>
                      </div>
                    </Card>
                  )}

                  {otpItems.length === 0 ? (
                    <div className="nv-empty">No TOTP authenticators added yet.</div>
                  ) : (
                    otpItems.map(o => {
                      const codeClean = (o.code || '').replace(/\s+/g, '');
                      const displayCode = codeClean.length === 6
                        ? `${codeClean.slice(0, 3)} ${codeClean.slice(3)}`
                        : (o.code || '------');
                      const isCopied = copiedKey === `otp-${o.service}`;

                      return (
                        <div className="nv-vault-item" key={o.service}>
                          <div className="nv-vault-left">
                            <div className="nv-avatar-monogram" style={{ background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(16, 185, 129, 0.25))', borderColor: 'rgba(14, 165, 233, 0.35)' }}>
                              {(o.service.charAt(0) || '2').toUpperCase()}
                            </div>
                            <div className="nv-vault-info">
                              <span className="nv-vault-service">{o.service}</span>
                              <span style={{
                                fontSize: '1.25rem',
                                fontFamily: 'var(--nv-font-mono)',
                                fontWeight: 700,
                                color: 'var(--nv-primary)',
                                letterSpacing: '2.5px'
                              }}>
                                {displayCode}
                              </span>
                            </div>
                          </div>
                          <div className="nv-vault-actions">
                            <button
                              className="nv-btn nv-btn-sm"
                              style={isCopied ? { background: 'rgba(16, 185, 129, 0.2)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : {}}
                              onClick={() => copyOTP(codeClean || o.code, o.service)}
                            >
                              {isCopied ? '✓ Copied' : 'Copy'}
                            </button>
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              onClick={() => editOTP(o.service)}
                              title="Edit authenticator"
                            >
                              Edit
                            </button>
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              style={{ color: 'var(--nv-danger)', padding: '0.35rem 0.55rem' }}
                              onClick={() => deleteOTP(o.service)}
                              title="Delete TOTP"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* PAGE 3: NEXGRID */}
              {activeTab === 'grid' && (
                <div>
                  <Card style={{ marginBottom: '1rem' }}>
                    <div className="nv-panel-header">
                      <span className="nv-panel-title">NexGrid P2P Mesh</span>
                      <StatusPill ok={gridStatus === 'paired' || gridStatus === 'connected'} label={gridStatus} />
                    </div>

                    <div style={{ marginBottom: '0.65rem' }}>
                      <label className="nv-label">Relay Server URL (Saved Persistently)</label>
                      <input
                        className="nv-input nv-mono"
                        value={relayUrl}
                        onChange={e => {
                          const val = e.target.value;
                          setRelayUrl(val);
                          try {
                            localStorage.setItem('nexvault_relay_url', val);
                            (window as any).nexVault?.setRelayUrl?.(val);
                          } catch {}
                        }}
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
                      <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={onGenerateMobilePairCode}>
                        Generate Code
                      </button>
                    </div>

                    {generatedPairCode && (
                      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--nv-primary-light)', border: '1px solid var(--nv-border-strong)', borderRadius: 'var(--nv-radius-sm)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--nv-text-secondary)', textTransform: 'uppercase' }}>Active Pairing Code (Enter on Any Peer Node):</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--nv-primary)', letterSpacing: '4px', margin: '0.25rem 0' }}>{generatedPairCode}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>Valid for 5 minutes. Enter this code on desktop or any other mesh node.</div>
                      </div>
                    )}
                  </Card>

                  {/* Pair with 6-digit Code */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                      Enter Peer Pairing Code
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--nv-muted)', margin: '0 0 0.65rem' }}>
                      Enter a pairing code generated by any mesh peer node (mobile or desktop).
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

                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.35rem' }}>Data &amp; Migration</div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Import passwords and 2FA accounts from Chrome, Bitwarden, 1Password, or otpauth:// links, or delete all vault entries.
                    </p>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={() => setImportModalType('all')}>
                        📥 Bulk Import Credentials &amp; 2FA
                      </button>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" style={{ color: 'var(--nv-danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }} onClick={onDeleteAllEverything}>
                        🗑 Delete All Vault Items
                      </button>
                    </div>
                  </Card>

                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Browser &amp; System Autofill</div>
                      <span className="nv-badge success">Integrated</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      NextVault uses Android's system Autofill service to fill logins and 2FA across mobile browsers (Chrome, Firefox, Brave) and installed apps. On desktop, the extension is registered automatically to default browsers upon installation and launch.
                    </p>
                    <div style={{ fontSize: '0.7rem', color: 'var(--nv-text-secondary)', background: 'var(--nv-bg-2)', padding: '0.5rem 0.65rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
                      💡 Link this mobile node with Desktop via NexGrid to keep credentials synchronized across all your devices.
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
              className={`nv-nav-button ${activeTab === 'quick-fill' ? 'active' : ''}`}
              onClick={openQuickFill}
            >
              <span className="nav-icon">
                <Shield size={18} />
              </span>
              <span>Quick Fill</span>
            </button>
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

        {/* QR Scanner Modal */}
        {isScanningQr && (
          <QrScannerModal
            onClose={() => setIsScanningQr(false)}
            onDetected={onQrCodeDetected}
            showToast={showToast}
          />
        )}

        {/* Bulk Import Modal */}
        {importModalType && (
          <BulkImportModal
            type={importModalType}
            onClose={() => setImportModalType(null)}
            showToast={showToast}
            onImportDone={() => {
              refreshVault(false);
              refreshOTPs(false);
            }}
          />
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
