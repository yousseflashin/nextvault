import { useState, useEffect, useRef, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './cyber/cyber.css';
import './main.css';
import {
  getSavedRelayUrl,
  CURRENT_VERSION,
  parseOtpAuthUri,
  parseBulkImport,
  clearAutofillCredentials,
  syncAutofillCredentials,
  mergeNativeAutofillCredentials,
  openAutofillSettings,
  isAutofillEnabled,
  openAccessibilitySettings,
  isAccessibilityEnabled,
  openAppDetailsSettings,
  getAutofillDiagnosticStatus,
  setSecureWindow,
  getSecurityPolicy,
  saveSecurityPolicy,
  type DeviceSecurityPolicy,
  getSecurityWindowStatus,
  extendOfflineSecurityWindow,
  requestPeerSecurityExtension,
  respondToPeerSecurityExtension,
  grantPeerSecurityExtension,
  requestPeerToExtend,
  emergencyNukeVault,
  type PeerExtensionRequest
} from './mobileVault';
import { startCameraQrScanner, scanQrFromImageSource, requestCameraPermission } from './qrScanner';

function CircularCountdown({ seconds, period = 30, size = 26 }: { seconds: number; period?: number; size?: number }) {
  const radius = 10;
  const stroke = 2.4;
  const normalizedRadius = radius - stroke * 0.5;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (seconds / period) * circumference;
  const isUrgent = seconds <= 5;
  const strokeColor = isUrgent ? '#ef4444' : '#10b981';

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg height={size} width={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle
          stroke="rgba(255, 255, 255, 0.12)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          stroke={strokeColor}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.85s linear, stroke 0.3s ease' }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <span style={{
        position: 'absolute',
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        fontFamily: 'var(--nv-font-mono)',
        color: strokeColor,
        lineHeight: 1
      }}>
        {seconds}
      </span>
    </div>
  );
}

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

function MobileMeshVisualizer({
  trustedDevices,
  onExtendPeer,
  showToast
}: {
  trustedDevices: { deviceId: string; deviceName?: string }[];
  onExtendPeer: (peerId: string, duration: string) => void;
  showToast: (msg: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const nodesRef = useRef<any[]>([]);
  const packetsRef = useRef<any[]>([]);
  const ripplesRef = useRef<any[]>([]);

  const defaultNodes = useMemo(() => [
    { id: 0, name: "This Phone", type: "mobile", icon: "📱", x: 0.5, y: 0.5, isLocal: true, safeHours: 24, latency: 0, color: "#10b981", deviceId: "local" },
    { id: 1, name: "MacBook Pro", type: "laptop", icon: "💻", x: 0.22, y: 0.32, isLocal: false, safeHours: 23.8, latency: 14, color: "#0ea5e9", deviceId: "peer-mac" },
    { id: 2, name: "Linux Node", type: "desktop", icon: "🖥️", x: 0.78, y: 0.32, isLocal: false, safeHours: 720, latency: 9, color: "#f59e0b", deviceId: "peer-linux" },
    { id: 3, name: "Workstation", type: "desktop", icon: "🖥️", x: 0.5, y: 0.82, isLocal: false, safeHours: 168, latency: 16, color: "#a855f7", deviceId: "peer-work" }
  ], []);

  useEffect(() => {
    if (!trustedDevices.length) {
      nodesRef.current = defaultNodes;
    } else {
      const angles = [0.3 * Math.PI, 0.8 * Math.PI, 1.3 * Math.PI, 1.8 * Math.PI];
      const newNodes = [
        { id: 0, name: "This Phone", type: "mobile", icon: "📱", x: 0.5, y: 0.5, isLocal: true, safeHours: 24, latency: 0, color: "#10b981", deviceId: "local" }
      ];
      trustedDevices.forEach((d, idx) => {
        const a = angles[idx % angles.length];
        const dist = 0.36;
        const x = 0.5 + Math.cos(a) * dist;
        const y = 0.5 + Math.sin(a) * (dist * 0.85);
        newNodes.push({
          id: idx + 1,
          name: d.deviceName || 'Peer Node',
          type: 'desktop',
          icon: '💻',
          x: Math.max(0.16, Math.min(0.84, x)),
          y: Math.max(0.18, Math.min(0.82, y)),
          isLocal: false,
          safeHours: 24,
          latency: 14 + idx * 4,
          color: '#0ea5e9',
          deviceId: d.deviceId
        });
      });
      nodesRef.current = newNodes;
    }
  }, [trustedDevices, defaultNodes]);

  const addPacket = (fromIdx: number, toIdx: number, type: string, payload: any) => {
    const from = nodesRef.current[fromIdx];
    const to = nodesRef.current[toIdx];
    if (!from || !to) return;
    packetsRef.current.push({
      from, to,
      progress: 0,
      speed: 0.02,
      type, payload,
      size: type === 'extension-grant' ? 6 : 4,
      color: type === 'extension-grant' ? '#10b981' : (type === 'ping' ? '#0ea5e9' : '#f59e0b'),
      tail: []
    });
  };

  const handleBeam = (dur = '1week') => {
    const peers = nodesRef.current.filter(n => !n.isLocal);
    if (!peers.length) {
      showToast('No peer devices connected');
      return;
    }
    const target = selectedNode && !selectedNode.isLocal ? selectedNode : peers[0];
    const targetIdx = nodesRef.current.indexOf(target);
    const durLabel = dur === '1week' ? '+7 Days' : '+30 Days';
    showToast(`⚡ Beaming Safe Period Extension to "${target.name}" (${durLabel})...`);
    addPacket(0, targetIdx, 'extension-grant', { dur, durLabel, targetName: target.name });
    if (target.deviceId && target.deviceId !== 'peer-mac' && target.deviceId !== 'peer-linux') {
      onExtendPeer(target.deviceId, dur);
    }
  };

  const handlePing = () => {
    showToast('📡 Radar ping broadcasted to all mesh peers');
    for (let i = 1; i < nodesRef.current.length; i++) {
      setTimeout(() => addPacket(0, i, 'ping', {}), i * 120);
    }
  };

  const handleSync = () => {
    showToast('🔄 Syncing encrypted credentials with mesh peers...');
    for (let i = 1; i < nodesRef.current.length; i++) {
      setTimeout(() => addPacket(0, i, 'sync', {}), i * 140);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      frame++;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const gs = 32;
      for (let x = 0; x < W; x += gs) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += gs) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      const nodes = nodesRef.current;
      if (!nodes || !nodes.length) {
        animId = requestAnimationFrame(render);
        return;
      }

      const local = nodes[0];
      const lx = local.x * W;
      const ly = local.y * H;

      for (let i = 1; i < nodes.length; i++) {
        const p = nodes[i];
        const px = p.x * W;
        const py = p.y * H;

        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(px, py);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.setLineDash([5, 10]);
        ctx.lineDashOffset = -frame * 0.45;
        ctx.moveTo(lx, ly);
        ctx.lineTo(px, py);
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += 1.2;
        r.alpha -= 0.025;
        if (r.alpha <= 0 || r.radius >= 35) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = Math.max(0, r.alpha);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      const packets = packetsRef.current;
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.progress += p.speed;

        const x1 = p.from.x * W;
        const y1 = p.from.y * H;
        const x2 = p.to.x * W;
        const y2 = p.to.y * H;

        const curX = x1 + (x2 - x1) * p.progress;
        const curY = y1 + (y2 - y1) * p.progress;

        p.tail.push({ x: curX, y: curY });
        if (p.tail.length > 10) p.tail.shift();

        for (let t = 0; t < p.tail.length; t++) {
          const pt = p.tail[t];
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, p.size * (t / p.tail.length), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = (t / p.tail.length) * 0.7;
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        ctx.beginPath();
        ctx.arc(curX, curY, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (p.progress >= 1.0) {
          ripples.push({ x: x2, y: y2, radius: 5, alpha: 0.9, color: p.color });
          if (p.type === 'extension-grant') {
            showToast(`✓ Safe Period extended for "${p.to.name}" (${p.payload.durLabel})!`);
            packets.push({ from: p.to, to: p.from, progress: 0, speed: 0.025, type: 'ack', size: 4, color: '#34d399', tail: [] });
          }
          packets.splice(i, 1);
        }
      }

      for (const node of nodes) {
        const nx = node.x * W;
        const ny = node.y * H;
        const isSel = selectedNode?.id === node.id;

        if (node.isLocal) {
          const pulse = Math.sin(frame * 0.05) * 4;
          ctx.beginPath();
          ctx.arc(nx, ny, 26 + pulse, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
          ctx.fill();
        }

        if (isSel) {
          ctx.beginPath();
          ctx.arc(nx, ny, 24, 0, Math.PI * 2);
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(nx, ny, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.shadowColor = node.color;
        ctx.shadowBlur = node.isLocal ? 14 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = node.color;
        ctx.lineWidth = node.isLocal ? 2 : 1.5;
        ctx.stroke();

        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.icon, nx, ny);

        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(node.name, nx, ny + 28);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, [selectedNode, showToast]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    let found = null;
    for (const node of nodesRef.current) {
      const nx = node.x * rect.width;
      const ny = node.y * rect.height;
      if (Math.hypot(cx - nx, cy - ny) < 28) {
        found = node;
        break;
      }
    }
    setSelectedNode(found);
  };

  return (
    <Card style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}>
      <div className="nv-mesh-toolbar" style={{ padding: '0.65rem 0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span className="nv-pulse-dot" />
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>Mesh Neural Topology</span>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button className="nv-btn nv-btn-sm" onClick={() => handleBeam('1week')} style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', color: '#000', fontWeight: 600, fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>
            ⚡ Extend
          </button>
          <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={handlePing} style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>
            📡 Ping
          </button>
          <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={handleSync} style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>
            🔄 Sync
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height: '260px', background: '#04060a' }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ width: '100%', height: '100%', display: 'block' }} />

        {selectedNode && (
          <div style={{
            position: 'absolute', bottom: '8px', left: '8px', right: '8px',
            background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--nv-radius-sm)', padding: '0.65rem 0.85rem',
            backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)'
          }}>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{selectedNode.icon}</span>
                <span>{selectedNode.name}</span>
                {selectedNode.isLocal && <span className="nv-badge success" style={{ fontSize: '0.6rem', marginLeft: '4px' }}>Local</span>}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--nv-muted)', fontFamily: 'var(--nv-font-mono)' }}>
                {selectedNode.isLocal ? 'Active Core' : `● ${selectedNode.latency}ms • Direct WebRTC`}
              </div>
            </div>
            {!selectedNode.isLocal && (
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button className="nv-btn nv-btn-sm" onClick={() => handleBeam('1week')} style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem' }}>
                  ⚡ +1W
                </button>
                <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={() => handleBeam('1month')} style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem' }}>
                  ⚡ +1M
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
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

function RestrictedSettingsGuideModal({
  onClose,
  showToast,
  diagStatus
}: {
  onClose: () => void;
  showToast: (msg: string) => void;
  diagStatus: { sdkInt: number; hasRestrictedSettings: boolean; packageName: string } | null;
}) {
  const [copiedAdb, setCopiedAdb] = useState(false);
  const pkg = diagStatus?.packageName || 'com.nexvault.app';
  const adbCmd = `adb shell cmd appops set ${pkg} ACCESS_RESTRICTED_SETTINGS allow`;

  const copyAdb = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(adbCmd);
      setCopiedAdb(true);
      showToast('Copied ADB bypass command to clipboard');
      setTimeout(() => setCopiedAdb(false), 2500);
    }
  };

  return (
    <div className="nv-modal-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="nv-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '440px', width: '92%', maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🔓</span>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
                Fix "Restricted Setting" Block
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>
                Android 13, 14 &amp; 15 Sideload Permission Unlock
              </div>
            </div>
          </div>
          <button
            className="nv-btn nv-btn-ghost nv-btn-sm"
            onClick={onClose}
            style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
          >
            ✕
          </button>
        </div>

        {/* Why this happens banner */}
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            borderRadius: 'var(--nv-radius-sm)',
            padding: '0.65rem',
            marginBottom: '0.85rem'
          }}
        >
          <div style={{ fontWeight: 600, color: '#facc15', fontSize: '0.76rem', marginBottom: '0.2rem' }}>
            Why does Android say "Restricted setting"?
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--nv-text-secondary)', margin: 0, lineHeight: '1.4' }}>
            In modern Android (API 33+), Google locks Accessibility for apps installed outside Google Play. The setting is grayed out until you manually allow restricted settings in App Info.
          </p>
        </div>

        {/* 4 Illustrated Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', background: 'var(--nv-bg-2)', padding: '0.6rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--nv-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0 }}>
              1
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.78rem' }}>Tap "Open App Info" Below</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>
                This directly opens NexVault's application details in Android Settings.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', background: 'var(--nv-bg-2)', padding: '0.6rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--nv-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0 }}>
              2
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.78rem' }}>Tap the 3 Dots (⋮) Top-Right</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>
                In the upper-right corner of the App Info page, tap the overflow menu icon.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', background: 'var(--nv-bg-2)', padding: '0.6rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--nv-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0 }}>
              3
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.78rem' }}>Select "Allow restricted settings"</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>
                Confirm with your fingerprint, face unlock, or device PIN.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', background: 'var(--nv-bg-2)', padding: '0.6rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--nv-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0 }}>
              4
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.78rem' }}>Return Here &amp; Enable Overlay</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>
                Tap "Open Accessibility Settings" — the toggle will now be unlocked and ready to turn ON!
              </div>
            </div>
          </div>
        </div>

        {/* 1-Tap Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.75rem' }}>
          <button
            className="nv-btn nv-btn-accent"
            onClick={async () => {
              await openAppDetailsSettings();
              showToast('Look for (⋮) in top-right -> "Allow restricted settings"');
            }}
            style={{ fontWeight: 700 }}
          >
            🔓 1. Open App Info to Allow Restricted Settings
          </button>
          <button
            className="nv-btn nv-btn-ghost"
            onClick={async () => {
              await openAccessibilitySettings();
              showToast('Turn ON "NexVault Autofill Overlay"');
            }}
          >
            ⚙️ 2. Open Accessibility Settings
          </button>
        </div>

        {/* ADB Bypass for Power Users */}
        <div style={{ background: 'black', padding: '0.5rem 0.65rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--nv-dim)', fontFamily: 'monospace' }}>DEVELOPER ADB COMMAND:</span>
            <button
              className="nv-btn nv-btn-ghost nv-btn-sm"
              onClick={copyAdb}
              style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
            >
              {copiedAdb ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <code style={{ fontSize: '0.68rem', color: 'var(--nv-accent)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {adbCmd}
          </code>
        </div>
      </div>
    </div>
  );
}

type TabType = 'vault' | 'otp' | 'grid' | 'security' | 'settings' | 'quick-fill';
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
  const [vaultSort, setVaultSort] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'user-asc'>('date-desc');
  const [vaultFilter, setVaultFilter] = useState<'all' | 'has-user' | 'no-user'>('all');
  const [vaultGroup, setVaultGroup] = useState<'none' | 'site' | 'account' | 'letter'>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
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

  function generateMobilePassword() {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_+=';
    let res = '';
    const array = new Uint32Array(20);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < 20; i++) res += chars[array[i] % chars.length];
    setCredential(res);
    showToast('Generated strong 20-character password');
  }

  function getPasswordScore(pass: string) {
    if (!pass) return 0;
    let s = 0;
    if (pass.length >= 8) s++;
    if (pass.length >= 14) s++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) s++;
    if (/[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass)) s++;
    return s;
  }

  // OTP State
  const [otpItems, setOtpItems] = useState<{ service: string; code?: string }[]>([]);
  const [otpSearch, setOtpSearch] = useState('');
  const [showAddOtp, setShowAddOtp] = useState(false);
  const [editingOtpService, setEditingOtpService] = useState<string | null>(null);
  const [otpService, setOtpService] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [countdown, setCountdown] = useState(30);

  // Security & Auto-Lock State
  const [autoLockMinutes, setAutoLockMinutesState] = useState<number | 'never'>(() => (window as any).nexVault?.getAutoLockMinutes?.() ?? 5);
  const [securityDeadlineStatus, setSecurityDeadlineStatus] = useState<{ isWithinWindow: boolean; deadline: string; remainingSeconds: number; isExpired: boolean } | null>(null);
  const [selectedExtension, setSelectedExtension] = useState<'1week' | '1month' | '3months'>('1week');
  const [incomingExtensionRequest, setIncomingExtensionRequest] = useState<PeerExtensionRequest | null>(null);
  const [incomingExtensionGrant, setIncomingExtensionGrant] = useState<{
    grantId: string;
    from: string;
    granterDeviceName: string;
    duration: string;
    newDeadline: string;
  } | null>(null);
  const [incomingExtensionPrompt, setIncomingExtensionPrompt] = useState<{
    from: string;
    fromDeviceName: string;
    duration: string;
  } | null>(null);
  const [pendingExtensionRequest, setPendingExtensionRequest] = useState<{ requestId: string; duration: string; expiresAt: string; peersCount?: number } | null>(() => {
    try {
      const saved = localStorage.getItem('nexvault_pending_extension_request');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

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
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean;
    latestVersion: string;
    downloadUrl?: string;
    size?: number;
    sha256?: string;
  } | null>(null);

  // Bulk Import & QR Scanning State
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [importModalType, setImportModalType] = useState<'vault' | 'otp' | 'all' | null>(null);

  // Instant Copy Feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Accessibility Autofill Overlay & Security Policy State
  const [a11yEnabled, setA11yEnabled] = useState(false);
  const [showRestrictedGuide, setShowRestrictedGuide] = useState(false);
  const [securityPolicy, setSecurityPolicy] = useState<DeviceSecurityPolicy>(getSecurityPolicy());
  const [diagStatus, setDiagStatus] = useState<{
    sdkInt: number;
    hasRestrictedSettings: boolean;
    packageName: string;
    isAccessibilityEnabled: boolean;
    isAutofillEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    isAccessibilityEnabled().then(setA11yEnabled).catch(() => {});
    getAutofillDiagnosticStatus().then(setDiagStatus).catch(() => {});
    const onWindowFocus = () => {
      isAccessibilityEnabled().then(setA11yEnabled).catch(() => {});
      getAutofillDiagnosticStatus().then(setDiagStatus).catch(() => {});
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, []);

  function onUpdateSecurityPolicy(partial: Partial<DeviceSecurityPolicy>) {
    const updated = saveSecurityPolicy(partial);
    setSecurityPolicy(updated);
    showToast(`Security policy updated: ${updated.profile.toUpperCase()}`);
  }

  useEffect(() => {
    isAutofillEnabled().then((enabled) => {
      if (!enabled) setQuickFillStatus('Enable NexVault as the Android Autofill service');
    }).catch(() => {});
  }, []);

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
    setUpdateProgress(0);
    showToast('Downloading & verifying SHA-256 update package...');
    try {
      const res = await (window as any).nexVault.applyUpdate(
        updateInfo?.downloadUrl,
        (pct: number) => setUpdateProgress(pct)
      );
      if (res && res.success) {
        showToast(res.message || 'Package installer launched. Confirm to update in-place.');
      } else if (res && res.needPermission) {
        showToast(res.message || 'Enable unknown app installation for NexVault, then tap Install again.');
      } else {
        showToast(res?.error || res?.message || 'Update failed. You can use the browser download option.');
      }
    } catch (e: any) {
      showToast('Error applying update: ' + e.message);
    } finally {
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  }

  function onDownloadApkInBrowser() {
    const url = updateInfo?.downloadUrl || `https://github.com/yousseflashin/nextvault/releases/latest`;
    window.open(url, '_system');
    showToast('Opening APK download in browser...');
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
      const minutes = (window as any).nexVault?.getAutoLockMinutes?.() ?? 5;
      if (minutes !== 'never' && typeof minutes === 'number') {
        if (Date.now() - lastActive > minutes * 60 * 1000) onLockVault();
      }
    }, 10000);
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
    if (!unlocked) return;
    const updateSecurity = () => {
      const s = getSecurityWindowStatus();
      setSecurityDeadlineStatus(s);
      if (s.isExpired) {
        onLockVault();
      }
    };
    updateSecurity();
    const interval = setInterval(updateSecurity, 10000);
    return () => clearInterval(interval);
  }, [unlocked]);

  function onChangeAutoLock(val: string) {
    const parsed = val === 'never' ? 'never' : (Number(val) || 5);
    (window as any).nexVault?.setAutoLockMinutes?.(parsed);
    setAutoLockMinutesState(parsed);
    showToast(`Auto-lock timeout set to: ${val === 'never' ? 'Disabled' : `${val} Minutes`}`);
  }

  function formatRemainingCountdown(diffSeconds?: number) {
    const diff = diffSeconds ?? (24 * 3600);
    const hours = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;
    const days = Math.floor(hours / 24);
    if (days > 1) {
      return `${days} days, ${hours % 24}h remaining`;
    }
    return `${hours}h ${mins}m ${secs}s remaining`;
  }

  function onRequestSecurityExtension(forceLocal = false) {
    if (forceLocal) {
      const res = extendOfflineSecurityWindow(selectedExtension);
      if (res.success) {
        setSecurityDeadlineStatus(getSecurityWindowStatus());
        setPendingExtensionRequest(null);
        try { localStorage.removeItem('nexvault_pending_extension_request'); } catch {}
        showToast(`Standalone grace extension applied (${res.duration})`);
      }
      return;
    }

    const res = requestPeerSecurityExtension(selectedExtension);
    if (res.success) {
      setPendingExtensionRequest({
        requestId: res.requestId,
        duration: res.duration,
        expiresAt: res.expiresAt,
        peersCount: res.peersCount
      });
      if (res.peersCount > 0) {
        showToast(`Request broadcasted to ${res.peersCount} mesh device(s)`);
      } else {
        showToast(`Request sent across mesh. Standalone grace is also available.`);
      }
    }
  }

  function onApprovePeerExtension() {
    if (!incomingExtensionRequest) return;
    const res = respondToPeerSecurityExtension(
      incomingExtensionRequest.from,
      incomingExtensionRequest.requestId,
      incomingExtensionRequest.duration,
      true
    );
    if (res.success) {
      showToast(`Approved ${incomingExtensionRequest.duration} extension for "${incomingExtensionRequest.deviceName}"`);
      setIncomingExtensionRequest(null);
    } else {
      showToast(res.error || 'Failed to approve extension');
    }
  }

  function onRejectPeerExtension() {
    if (!incomingExtensionRequest) return;
    respondToPeerSecurityExtension(
      incomingExtensionRequest.from,
      incomingExtensionRequest.requestId,
      incomingExtensionRequest.duration,
      false,
      'Declined by mobile user'
    );
    showToast('Declined extension request');
    setIncomingExtensionRequest(null);
  }

  function onGrantPeerExtension(targetPeerId: string, duration: string = '1week') {
    const res = grantPeerSecurityExtension(targetPeerId, duration);
    if (res.success) {
      showToast(`⚡ Safe Period Extension (${duration}) beamed to peer!`);
      log(`⚡ Safe Period Extension (${duration}) beamed to peer ${targetPeerId}`);
    } else {
      showToast(res.error || 'Failed to beam extension');
    }
  }

  function onRequestPeerToExtend(targetPeerId: string, duration: string = '1week') {
    const res = requestPeerToExtend(targetPeerId, duration);
    if (res.success) {
      showToast('🔔 Extension prompt dispatched to peer');
      log(`🔔 Extension prompt dispatched to peer ${targetPeerId}`);
    } else {
      showToast(res.error || 'Failed to prompt peer');
    }
  }

  function onCheckInNow() {
    if (typeof localStorage !== 'undefined') {
      const dayMs = 24 * 60 * 60 * 1000;
      localStorage.setItem('nexvault_offline_deadline', new Date(Date.now() + dayMs).toISOString());
    }
    setSecurityDeadlineStatus(getSecurityWindowStatus());
    showToast('Check-in confirmed! 24-hour heartbeat reset.');
  }

  async function onEmergencyNuke() {
    const first = confirm('☢️ EMERGENCY NUKE WARNING: This will permanently wipe all local encryption keys, saved passwords, and 2FA accounts from this mobile node. Proceed?');
    if (!first) return;
    const second = confirm('FINAL VERIFICATION: Are you absolutely certain? This operation CANNOT be undone.');
    if (!second) return;
    try {
      emergencyNukeVault();
      setUnlocked(false);
      setPassword('');
      setUsername('');
      setTokenJson('');
      setVaultItems([]);
      setOtpItems([]);
      setStatus('Vault destroyed');
      showToast('Vault wiped. All local data permanently shredded.');
      alert('NexVault mobile node has been permanently wiped and destroyed.');
    } catch (e: any) {
      showToast('Nuke error: ' + e.message);
    }
  }

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
        },
        onIncomingExtensionRequest: (req: any) => {
          setIncomingExtensionRequest(req);
          log(`🔔 Incoming security window extension request from "${req.deviceName}" (${req.duration})`);
          showToast(`🔔 Extension request from ${req.deviceName} (${req.duration})`);
        },
        onExtensionApproved: (data: any) => {
          setPendingExtensionRequest(null);
          try { localStorage.removeItem('nexvault_pending_extension_request'); } catch {}
          setSecurityDeadlineStatus(getSecurityWindowStatus());
          showToast(`🎉 Extension approved by ${data.approverName || 'peer'}!`);
          log(`🎉 Extension approved by ${data.approverName || 'peer'}!`);
        },
        onExtensionRejected: (data: any) => {
          setPendingExtensionRequest(null);
          try { localStorage.removeItem('nexvault_pending_extension_request'); } catch {}
          showToast(`❌ Extension request declined: ${data.reason || 'Declined'}`);
          log(`❌ Extension request declined: ${data.reason || 'Declined'}`);
        },
        onExtensionGrantReceived: (grant: any) => {
          setIncomingExtensionGrant(grant);
          setSecurityDeadlineStatus(getSecurityWindowStatus());
          showToast(`⚡ Safe period extended by "${grant.granterDeviceName}" until ${new Date(grant.newDeadline).toLocaleDateString()}!`);
          log(`⚡ Safe period extended by "${grant.granterDeviceName}" until ${grant.newDeadline}!`);
        },
        onExtensionGrantAcknowledged: (_ack: any) => {
          showToast(`✓ Peer confirmed extension applied!`);
          log(`✓ Peer confirmed extension applied!`);
        },
        onExtensionPromptReceived: (prompt: any) => {
          setIncomingExtensionPrompt(prompt);
          showToast(`🔔 Peer "${prompt.fromDeviceName}" requested to extend safe period`);
          log(`🔔 Peer "${prompt.fromDeviceName}" requested safe period extension`);
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

  const filteredVaultItems = useMemo(() => {
    let items = vaultItems.filter(v => {
      if (vaultSearch) {
        const q = vaultSearch.toLowerCase();
        const match = v.service.toLowerCase().includes(q) || (v.username && v.username.toLowerCase().includes(q));
        if (!match) return false;
      }
      if (vaultFilter === 'has-user' && !v.username) return false;
      if (vaultFilter === 'no-user' && v.username) return false;
      return true;
    });

    items = [...items].sort((a, b) => {
      if (vaultSort === 'name-asc') return a.service.localeCompare(b.service);
      if (vaultSort === 'name-desc') return b.service.localeCompare(a.service);
      if (vaultSort === 'user-asc') return (a.username || '').localeCompare(b.username || '');
      if (vaultSort === 'date-asc') return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return items;
  }, [vaultItems, vaultSearch, vaultFilter, vaultSort]);

  const groupedVaultItems = useMemo(() => {
    if (vaultGroup === 'none') return null;
    const map = new Map<string, { label: string; items: typeof vaultItems }>();
    for (const v of filteredVaultItems) {
      let key = '';
      let label = '';
      if (vaultGroup === 'site') {
        key = (v.service || 'unknown').toLowerCase().trim();
        label = v.service || 'Unknown Site';
      } else if (vaultGroup === 'account') {
        key = (v.username || '').toLowerCase().trim() || '__empty__';
        label = v.username ? `👤 ${v.username}` : '(No Username)';
      } else if (vaultGroup === 'letter') {
        const first = (v.service || '').charAt(0).toUpperCase();
        key = /^[A-Z]$/.test(first) ? first : '#';
        label = key === '#' ? '# (Other)' : `Letter ${key}`;
      }
      if (!map.has(key)) {
        map.set(key, { label, items: [] });
      }
      map.get(key)!.items.push(v);
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      if (a === '__empty__') return 1;
      if (b === '__empty__') return -1;
      return a.localeCompare(b);
    });
    return sortedKeys.map(k => ({ key: k, label: map.get(k)!.label, items: map.get(k)!.items }));
  }, [filteredVaultItems, vaultGroup]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {unlocked && (
              <>
                <button
                  className="nv-btn nv-btn-ghost"
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                  onClick={openQuickFill}
                  title="Quick Fill credentials"
                >
                  <Shield size={12} />
                  <span>Fill</span>
                </button>
                <button
                  className="nv-btn nv-btn-ghost"
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
                  onClick={onLockVault}
                >
                  Lock
                </button>
              </>
            )}
            <StatusPill ok={unlocked} label={unlocked ? 'unlocked' : 'locked'} />
          </div>
        </header>

        {/* Incoming Extension Approval Banner */}
        {unlocked && incomingExtensionRequest && (
          <div style={{
            margin: '0.75rem 1rem 0',
            padding: '0.75rem 1rem',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid var(--nv-primary)',
            borderRadius: 'var(--nv-radius-sm)',
            boxShadow: '0 0 15px rgba(16, 185, 129, 0.25)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>🔔</span>
                <span>Extension Request from "{incomingExtensionRequest.deviceName}"</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--nv-text-secondary)' }}>
                Requesting <strong>{incomingExtensionRequest.duration}</strong> offline security extension.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button className="nv-btn nv-btn-sm" onClick={onApprovePeerExtension}>
                ✓ Approve
              </button>
              <button className="nv-btn nv-btn-ghost nv-btn-sm" style={{ color: 'var(--nv-danger)' }} onClick={onRejectPeerExtension}>
                ✕ Decline
              </button>
            </div>
          </div>
        )}

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
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.82rem' }}>
                Update Available: v{updateInfo.latestVersion}
                {updateInfo.size ? ` (${(updateInfo.size / 1048576).toFixed(1)} MB)` : ''}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--nv-muted)' }}>
                {updateInfo.sha256 ? `SHA-256 verified (${updateInfo.sha256.slice(0, 10)}…)` : 'A newer Android APK is available.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                className="nv-btn nv-btn-accent nv-btn-sm"
                disabled={isUpdating}
                onClick={onApplyMobileUpdate}
              >
                {isUpdating
                  ? (updateProgress !== null && updateProgress > 0 ? `Downloading ${updateProgress}%...` : 'Verifying...')
                  : 'Update & Install'}
              </button>
              <button
                className="nv-btn nv-btn-ghost nv-btn-sm"
                onClick={onDownloadApkInBrowser}
                title="Download APK file directly in your web browser"
              >
                Browser Download
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.5rem 0' }}>
                        <button className="nv-btn nv-btn-accent" onClick={async () => {
                          await openAccessibilitySettings();
                          setQuickFillStatus('Enable NexVault Overlay in Accessibility');
                          showToast('Enable "NexVault Autofill Overlay" under Downloaded Apps');
                        }}>
                          🛡️ Enable Chrome &amp; Browser Overlay
                        </button>
                        <button className="nv-btn nv-btn-ghost" onClick={() => setShowRestrictedGuide(true)}>
                          🔓 Fix "Restricted Setting" Error (Android 13/14+)
                        </button>
                        <button className="nv-btn nv-btn-ghost" onClick={async () => {
                          await openAutofillSettings();
                          setQuickFillStatus('Choose NexVault as Autofill service');
                        }}>
                          ⚙️ Open Standard Android Autofill
                        </button>
                      </div>
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

                  {/* Sorting, Filtering & Grouping Toolbar */}
                  <div className="nv-filter-bar" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                    <select
                      className="nv-select nv-select-sm"
                      value={vaultSort}
                      onChange={e => setVaultSort(e.target.value as any)}
                      title="Sort order"
                    >
                      <option value="name-asc">Site (A → Z)</option>
                      <option value="name-desc">Site (Z → A)</option>
                      <option value="user-asc">User (A → Z)</option>
                      <option value="date-desc">Newest</option>
                      <option value="date-asc">Oldest</option>
                    </select>

                    <select
                      className="nv-select nv-select-sm"
                      value={vaultFilter}
                      onChange={e => setVaultFilter(e.target.value as any)}
                      title="Filter credentials"
                    >
                      <option value="all">All</option>
                      <option value="has-user">With User</option>
                      <option value="no-user">Without User</option>
                    </select>

                    <select
                      className="nv-select nv-select-sm"
                      value={vaultGroup}
                      onChange={e => setVaultGroup(e.target.value as any)}
                      title="Group credentials"
                    >
                      <option value="none">No Grouping</option>
                      <option value="site">By Site</option>
                      <option value="account">By Account</option>
                      <option value="letter">By Letter</option>
                    </select>

                    <span className="nv-badge" style={{ marginLeft: 'auto', fontSize: '0.65rem' }}>
                      {filteredVaultItems.length} of {vaultItems.length}
                    </span>
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
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            className="nv-input nv-mono"
                            placeholder="Credential / Password"
                            value={credential}
                            onChange={e => setCredential(e.target.value)}
                          />
                          <button
                            type="button"
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            style={{ whiteSpace: 'nowrap', padding: '0.45rem 0.65rem' }}
                            onClick={generateMobilePassword}
                            title="Generate strong random password"
                          >
                            ⚡ Gen
                          </button>
                        </div>
                        {/* Password strength meter */}
                        <div className="nv-strength-wrap" style={{ marginTop: '0.15rem', marginBottom: '0.4rem' }}>
                          <div className="nv-strength-bars">
                            <div className={`nv-strength-bar ${getPasswordScore(credential) >= 1 ? (getPasswordScore(credential) === 1 ? 'weak' : getPasswordScore(credential) === 2 ? 'fair' : getPasswordScore(credential) === 3 ? 'good' : 'strong') : ''}`}></div>
                            <div className={`nv-strength-bar ${getPasswordScore(credential) >= 2 ? (getPasswordScore(credential) === 2 ? 'fair' : getPasswordScore(credential) === 3 ? 'good' : 'strong') : ''}`}></div>
                            <div className={`nv-strength-bar ${getPasswordScore(credential) >= 3 ? (getPasswordScore(credential) === 3 ? 'good' : 'strong') : ''}`}></div>
                            <div className={`nv-strength-bar ${getPasswordScore(credential) >= 4 ? 'strong' : ''}`}></div>
                          </div>
                        </div>
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
                      No credentials found matching filter. Connect to Desktop via NexGrid to sync your logins!
                    </div>
                  ) : groupedVaultItems ? (
                    groupedVaultItems.map(grp => {
                      const isCollapsed = !!collapsedGroups[grp.key];
                      return (
                        <div className={`nv-group-card ${isCollapsed ? 'collapsed' : ''}`} key={grp.key}>
                          <div
                            className="nv-group-header"
                            onClick={() => setCollapsedGroups(prev => ({ ...prev, [grp.key]: !prev[grp.key] }))}
                            title="Tap to expand / collapse"
                          >
                            <div className="nv-group-title">
                              <span className="nv-group-chevron" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                              <span>📁</span>
                              <span>{grp.label}</span>
                            </div>
                            <span className="nv-badge" style={{ fontSize: '0.65rem' }}>
                              {grp.items.length} {grp.items.length === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                          {!isCollapsed && (
                            <div className="nv-group-items">
                              {grp.items.map(v => (
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
                                      style={copiedKey === `pass-${v.service}` ? { background: 'rgba(16, 185, 129, 0.25)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : {}}
                                      onClick={() => copyPassword(v.service)}
                                      title="Copy password"
                                    >
                                      {copiedKey === `pass-${v.service}` ? '✓ Copied' : '⚡ Pass'}
                                    </button>
                                    {v.username && (
                                      <button
                                        className="nv-btn nv-btn-ghost nv-btn-sm"
                                        style={copiedKey === `user-${v.username}` ? { background: 'rgba(16, 185, 129, 0.25)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : {}}
                                        onClick={() => copyUsername(v.username!)}
                                        title="Copy username"
                                      >
                                        {copiedKey === `user-${v.username}` ? '✓ User' : '👤 User'}
                                      </button>
                                    )}
                                    <button
                                      className="nv-btn-icon"
                                      onClick={() => editPassword(v.service)}
                                      title="Edit credential"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      className="nv-btn-icon"
                                      style={{ color: 'var(--nv-danger)' }}
                                      onClick={() => deletePassword(v.service)}
                                      title="Delete credential"
                                    >
                                      🗑
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
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
                            style={copiedKey === `pass-${v.service}` ? { background: 'rgba(16, 185, 129, 0.25)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : {}}
                            onClick={() => copyPassword(v.service)}
                            title="Copy password"
                          >
                            {copiedKey === `pass-${v.service}` ? '✓ Copied' : '⚡ Pass'}
                          </button>
                          {v.username && (
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              style={copiedKey === `user-${v.username}` ? { background: 'rgba(16, 185, 129, 0.25)', borderColor: 'var(--nv-primary)', color: 'var(--nv-primary)' } : {}}
                              onClick={() => copyUsername(v.username!)}
                              title="Copy username"
                            >
                              {copiedKey === `user-${v.username}` ? '✓ User' : '👤 User'}
                            </button>
                          )}
                          <button
                            className="nv-btn-icon"
                            onClick={() => editPassword(v.service)}
                            title="Edit credential"
                          >
                            ✏️
                          </button>
                          <button
                            className="nv-btn-icon"
                            style={{ color: 'var(--nv-danger)' }}
                            onClick={() => deletePassword(v.service)}
                            title="Delete credential"
                          >
                            🗑
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CircularCountdown seconds={countdown} size={28} />
                      <div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Authenticator</div>
                        <span className="nv-badge" style={{ fontSize: '0.65rem' }}>Auto-refresh: {countdown}s</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
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

                  {/* Search Filter for 2FA Authenticators */}
                  <div className="nv-search-bar" style={{ marginBottom: '0.75rem' }}>
                    <span>🔍</span>
                    <input
                      placeholder="Search authenticators..."
                      value={otpSearch}
                      onChange={e => setOtpSearch(e.target.value)}
                    />
                    {otpSearch && (
                      <button
                        className="nv-btn nv-btn-ghost nv-btn-sm"
                        style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}
                        onClick={() => setOtpSearch('')}
                      >
                        ✕
                      </button>
                    )}
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

                  {(() => {
                    const filteredOtpList = otpItems.filter(o => !otpSearch || o.service.toLowerCase().includes(otpSearch.toLowerCase()));
                    if (filteredOtpList.length === 0) {
                      return <div className="nv-empty">{otpItems.length === 0 ? 'No TOTP authenticators added yet.' : 'No authenticators match your search.'}</div>;
                    }
                    return filteredOtpList.map(o => {
                      const codeClean = (o.code || '').replace(/\s+/g, '');
                      const displayCode = codeClean.length === 6
                        ? `${codeClean.slice(0, 3)} ${codeClean.slice(3)}`
                        : (o.code || '------');
                      const isCopied = copiedKey === `otp-${o.service}`;

                      return (
                        <div
                          className="nv-vault-item"
                          key={o.service}
                          style={{ cursor: 'pointer' }}
                          onClick={() => copyOTP(codeClean || o.code, o.service)}
                        >
                          <div className="nv-vault-left">
                            <div className="nv-avatar-monogram" style={{ background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(16, 185, 129, 0.25))', borderColor: 'rgba(14, 165, 233, 0.35)' }}>
                              {(o.service.charAt(0) || '2').toUpperCase()}
                            </div>
                            <div className="nv-vault-info">
                              <span className="nv-vault-service">{o.service}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <span style={{
                                  fontSize: '1.35rem',
                                  fontFamily: 'var(--nv-font-mono)',
                                  fontWeight: 700,
                                  color: 'var(--nv-primary)',
                                  letterSpacing: '2.5px'
                                }}>
                                  {displayCode}
                                </span>
                                <CircularCountdown seconds={countdown} size={24} />
                              </div>
                            </div>
                          </div>
                          <div className="nv-vault-actions" onClick={e => e.stopPropagation()}>
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
                    });
                  })()}
                </div>
              )}

              {/* PAGE 3: NEXGRID */}
              {activeTab === 'grid' && (
                <div>
                  {/* Neural Mesh Topology & Motion Design Visualizer */}
                  <MobileMeshVisualizer
                    trustedDevices={trustedDevices}
                    onExtendPeer={onGrantPeerExtension}
                    showToast={showToast}
                  />

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
                            padding: '0.65rem 0.75rem',
                            background: 'var(--nv-bg-2)',
                            border: '1px solid var(--nv-border)',
                            borderRadius: 'var(--nv-radius-sm)',
                            marginBottom: '0.45rem',
                            fontSize: '0.75rem',
                            flexWrap: 'wrap',
                            gap: '0.5rem'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span className="nv-pulse-dot" style={{ width: '6px', height: '6px' }} />
                              <span>{d.deviceName || 'Desktop Node'}</span>
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--nv-muted)', fontFamily: 'var(--nv-font-mono)' }}>{d.deviceId}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                            <button
                              className="nv-btn nv-btn-sm"
                              style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => onGrantPeerExtension(d.deviceId, '1week')}
                              title="Extend peer safe window by 1 week"
                            >
                              ⚡ +1W
                            </button>
                            <button
                              className="nv-btn nv-btn-accent nv-btn-sm"
                              style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => onGrantPeerExtension(d.deviceId, '1month')}
                              title="Extend peer safe window by 1 month"
                            >
                              ⚡ +1M
                            </button>
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => onRequestPeerToExtend(d.deviceId, '1week')}
                              title="Prompt peer to extend safe period"
                            >
                              🔔
                            </button>
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              style={{ color: 'var(--nv-danger)', padding: '0.2rem 0.45rem', fontSize: '0.65rem' }}
                              onClick={() => onRevokeDevice(d.deviceId)}
                            >
                              Revoke
                            </button>
                          </div>
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

              {/* PAGE 4: SECURITY CENTER */}
              {activeTab === 'security' && (
                <div>
                  {/* Incoming Extension Grant from Peer Alert Card */}
                  {incomingExtensionGrant && (
                    <Card style={{ marginBottom: '1rem', borderColor: 'var(--nv-primary)', background: 'rgba(16, 185, 129, 0.12)', boxShadow: '0 0 16px rgba(16, 185, 129, 0.25)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="nv-pulse-dot" />
                          <span>Safe Period Extended by Peer!</span>
                        </div>
                        <span className="nv-badge success">{incomingExtensionGrant.duration}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem' }}>
                        Peer <strong>"{incomingExtensionGrant.granterDeviceName}"</strong> granted this device a safe period extension until <strong>{new Date(incomingExtensionGrant.newDeadline).toLocaleDateString()}</strong>.
                      </p>
                      <button className="nv-btn nv-btn-sm" onClick={() => setIncomingExtensionGrant(null)}>
                        Dismiss
                      </button>
                    </Card>
                  )}

                  {/* Incoming Extension Prompt from Peer Alert Card */}
                  {incomingExtensionPrompt && (
                    <Card style={{ marginBottom: '1rem', borderColor: 'var(--nv-accent)', background: 'rgba(14, 165, 233, 0.12)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🔔</span>
                          <span>Peer Requested Extension</span>
                        </div>
                        <span className="nv-badge" style={{ background: 'var(--nv-accent)', color: '#fff' }}>{incomingExtensionPrompt.duration}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem' }}>
                        Peer <strong>"{incomingExtensionPrompt.fromDeviceName}"</strong> requested that this device extend its safe period.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="nv-btn nv-btn-sm" onClick={() => {
                          onCheckInNow();
                          onRequestSecurityExtension(false);
                          setIncomingExtensionPrompt(null);
                        }}>
                          ✓ Accept &amp; Extend
                        </button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => setIncomingExtensionPrompt(null)}>
                          Dismiss
                        </button>
                      </div>
                    </Card>
                  )}

                  {/* Incoming Peer Extension Request Alert Card */}
                  {incomingExtensionRequest && (
                    <Card style={{ marginBottom: '1rem', borderColor: 'var(--nv-primary)', background: 'rgba(16, 185, 129, 0.08)', boxShadow: '0 0 15px rgba(16, 185, 129, 0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>🔔</span>
                          <span>Incoming Extension Request</span>
                        </div>
                        <span className="nv-badge success" style={{ textTransform: 'uppercase' }}>{incomingExtensionRequest.duration}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.75rem' }}>
                        Device <strong>"{incomingExtensionRequest.deviceName}"</strong> is requesting approval to extend its offline security deadline.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="nv-btn nv-btn-sm" onClick={onApprovePeerExtension}>
                          ✓ Approve Extension
                        </button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" style={{ color: 'var(--nv-danger)' }} onClick={onRejectPeerExtension}>
                          ✕ Decline
                        </button>
                      </div>
                    </Card>
                  )}

                  {/* Pending Local Extension Request Card */}
                  {pendingExtensionRequest && (
                    <Card style={{ marginBottom: '1rem', borderColor: 'var(--nv-accent)', background: 'rgba(14, 165, 233, 0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                          Awaiting Peer Approval
                        </div>
                        <span className="nv-badge" style={{ background: 'var(--nv-accent)', color: '#fff' }}>{pendingExtensionRequest.duration}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.75rem' }}>
                        Extension request was broadcasted across NexGrid. Please tap "Approve" on your desktop or secondary paired device.
                      </p>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => {
                        setPendingExtensionRequest(null);
                        try { localStorage.removeItem('nexvault_pending_extension_request'); } catch {}
                      }}>
                        Dismiss
                      </button>
                    </Card>
                  )}

                  {/* Mobile Security Policy Freedom Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🛡️</span>
                        <span>Device Security Policy</span>
                      </div>
                      <span className="nv-badge success" style={{ textTransform: 'uppercase' }}>
                        {securityPolicy.profile}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Configure policies that fit your mobile workflow. Relaxed policies avoid restrictive auto-locks, permit browser overlay autofill, and enable screen captures.
                    </p>

                    {/* Policy Preset Selector */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginBottom: '0.85rem' }}>
                      <button
                        className={`nv-btn nv-btn-sm ${securityPolicy.profile === 'permissive' ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                        style={{ fontSize: '0.72rem', padding: '0.4rem 0.2rem', textAlign: 'center', flexDirection: 'column', gap: '2px' }}
                        onClick={() => onUpdateSecurityPolicy({
                          profile: 'permissive',
                          allowBrowserAutofill: true,
                          allowScreenshots: true,
                          keepAutofillOnBackground: true,
                          relaxedOfflineCheckin: true,
                          offlineGraceDays: 90
                        })}
                      >
                        <span style={{ fontWeight: 700 }}>Mobile Freedom</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>90d / Relaxed</span>
                      </button>
                      <button
                        className={`nv-btn nv-btn-sm ${securityPolicy.profile === 'balanced' ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                        style={{ fontSize: '0.72rem', padding: '0.4rem 0.2rem', textAlign: 'center', flexDirection: 'column', gap: '2px' }}
                        onClick={() => onUpdateSecurityPolicy({
                          profile: 'balanced',
                          allowBrowserAutofill: true,
                          allowScreenshots: true,
                          keepAutofillOnBackground: true,
                          relaxedOfflineCheckin: true,
                          offlineGraceDays: 30
                        })}
                      >
                        <span style={{ fontWeight: 700 }}>Balanced</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>30d (Standard)</span>
                      </button>
                      <button
                        className={`nv-btn nv-btn-sm ${securityPolicy.profile === 'strict' ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                        style={{ fontSize: '0.72rem', padding: '0.4rem 0.2rem', textAlign: 'center', flexDirection: 'column', gap: '2px' }}
                        onClick={() => onUpdateSecurityPolicy({
                          profile: 'strict',
                          allowBrowserAutofill: true,
                          allowScreenshots: false,
                          keepAutofillOnBackground: false,
                          relaxedOfflineCheckin: false,
                          offlineGraceDays: 1
                        })}
                      >
                        <span style={{ fontWeight: 700 }}>Strict Airgap</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>24h / Block Media</span>
                      </button>
                    </div>

                    {/* Granular Policy Toggles */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--nv-bg-2)', padding: '0.75rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
                      {/* Toggle 1: Browser Autofill & Overlay */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff' }}>Browser Autofill &amp; Overlay</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--nv-muted)' }}>Operate floating autofill on Chrome, Brave &amp; Firefox</div>
                        </div>
                        <button
                          className={`nv-btn nv-btn-sm ${securityPolicy.allowBrowserAutofill ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                          style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => onUpdateSecurityPolicy({ allowBrowserAutofill: !securityPolicy.allowBrowserAutofill })}
                        >
                          {securityPolicy.allowBrowserAutofill ? 'Allowed' : 'Disabled'}
                        </button>
                      </div>

                      {/* Toggle 2: Allow Screenshots & Screen Capture */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.45rem' }}>
                        <div>
                          <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff' }}>Allow Screenshots &amp; Screen Sharing</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--nv-muted)' }}>Disable Android FLAG_SECURE window masking</div>
                        </div>
                        <button
                          className={`nv-btn nv-btn-sm ${securityPolicy.allowScreenshots ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                          style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => onUpdateSecurityPolicy({ allowScreenshots: !securityPolicy.allowScreenshots })}
                        >
                          {securityPolicy.allowScreenshots ? 'Allowed' : 'Blocked'}
                        </button>
                      </div>

                      {/* Toggle 3: Relaxed Offline Deadline */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.45rem' }}>
                        <div>
                          <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff' }}>Relaxed Offline Deadline ({securityPolicy.offlineGraceDays} Days)</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--nv-muted)' }}>Prevent accidental 24-hour lockout when traveling</div>
                        </div>
                        <button
                          className={`nv-btn nv-btn-sm ${securityPolicy.relaxedOfflineCheckin ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                          style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => onUpdateSecurityPolicy({ relaxedOfflineCheckin: !securityPolicy.relaxedOfflineCheckin })}
                        >
                          {securityPolicy.relaxedOfflineCheckin ? 'Active' : '24h Timer'}
                        </button>
                      </div>

                      {/* Toggle 4: Keep Keystore Primed */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.45rem' }}>
                        <div>
                          <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff' }}>Keep Native Keystore Primed</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--nv-muted)' }}>Retain hardware keystore cache for seamless autofill</div>
                        </div>
                        <button
                          className={`nv-btn nv-btn-sm ${securityPolicy.keepAutofillOnBackground ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                          style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => onUpdateSecurityPolicy({ keepAutofillOnBackground: !securityPolicy.keepAutofillOnBackground })}
                        >
                          {securityPolicy.keepAutofillOnBackground ? 'Active' : 'Purge'}
                        </button>
                      </div>
                    </div>
                  </Card>

                  {/* Dead Man's Switch Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Dead Man's Switch &amp; Security Window</div>
                      <span className="nv-badge success">
                        {securityPolicy.relaxedOfflineCheckin ? `${securityPolicy.offlineGraceDays}d Grace` : '24h Heartbeat'}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Periodic cryptographic check-in. If offline beyond this deadline without an authorized extension, keys zero out and vault locks.
                    </p>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      marginBottom: '0.85rem',
                      padding: '0.75rem 0.85rem',
                      background: 'var(--nv-bg-2)',
                      borderRadius: 'var(--nv-radius-sm)',
                      border: '1px solid var(--nv-border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ fontSize: '1.4rem' }}>⏳</div>
                        <div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--nv-muted)', textTransform: 'uppercase' }}>Security Window Remaining</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--nv-primary)', fontFamily: 'var(--nv-font-mono)' }}>
                            {formatRemainingCountdown(securityDeadlineStatus?.remainingSeconds)}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--nv-muted)' }}>
                            Deadline: {securityDeadlineStatus?.deadline ? new Date(securityDeadlineStatus.deadline).toLocaleDateString() : 'Calculating...'}
                          </div>
                        </div>
                      </div>
                      <button className="nv-btn nv-btn-sm" onClick={onCheckInNow} title="Reset 24h timer">
                        Check In
                      </button>
                    </div>

                    {/* Mesh Extension Controls */}
                    <div style={{ padding: '0.75rem', background: 'var(--nv-surface-2)', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#fff', marginBottom: '0.25rem' }}>Request Offline Window Extension</div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--nv-muted)', margin: '0 0 0.65rem' }}>
                        Traveling offline? Broadcast an extension request to be authorized by your paired mesh nodes.
                      </p>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        {(['1week', '1month', '3months'] as const).map(d => (
                          <button
                            key={d}
                            className={`nv-btn nv-btn-sm ${selectedExtension === d ? 'nv-btn-accent' : 'nv-btn-ghost'}`}
                            onClick={() => setSelectedExtension(d)}
                            style={{ fontSize: '0.72rem', padding: '0.35rem 0.65rem' }}
                          >
                            {d === '1week' ? '1 Week' : d === '1month' ? '1 Month' : '3 Months (Quorum)'}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={() => onRequestSecurityExtension(false)}>
                          🌐 Request Mesh Peer Approval
                        </button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => onRequestSecurityExtension(true)} title="Single device grace extension">
                          Standalone Grace
                        </button>
                      </div>
                    </div>

                    {/* Grant Peer Extension Directly From Mobile */}
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(16, 185, 129, 0.06)', borderRadius: 'var(--nv-radius-sm)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#fff', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="nv-pulse-dot" style={{ width: '6px', height: '6px' }} />
                        <span>Grant Safe Period to Peer Device</span>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem' }}>
                        Extend the safe operating window of another device in your mesh without requiring that device to initiate it.
                      </p>
                      {trustedDevices.length === 0 ? (
                        <div style={{ fontSize: '0.7rem', color: 'var(--nv-muted)' }}>No paired peers enrolled yet. Pair a peer in the Mesh tab first.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {trustedDevices.map(d => (
                            <div key={d.deviceId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.5rem', background: 'var(--nv-bg-2)', borderRadius: 'var(--nv-radius-sm)', fontSize: '0.72rem' }}>
                              <span style={{ fontWeight: 600, color: '#fff' }}>{d.deviceName || 'Peer Node'}</span>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <button className="nv-btn nv-btn-sm" style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }} onClick={() => onGrantPeerExtension(d.deviceId, '1week')}>
                                  ⚡ +1W
                                </button>
                                <button className="nv-btn nv-btn-accent nv-btn-sm" style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }} onClick={() => onGrantPeerExtension(d.deviceId, '1month')}>
                                  ⚡ +1M
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Cryptographic Protection Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Cryptographic Memory Shield</div>
                      <span className="nv-badge success">Active</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.5rem' }}>
                      Hardware-backed Android KeyStore AES-256-GCM encryption. Keys are evicted and zeroed upon auto-lock or app backgrounding. Android FLAG_SECURE blocks screenshots.
                    </p>
                  </Card>

                  {/* Danger Zone: Emergency Nuke */}
                  <Card style={{ borderColor: 'rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.04)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--nv-danger)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>⚠️</span>
                      <span>Emergency Cryptographic Destruction</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Self-destruct protocol: Immediately purges all credentials, 2FA tokens, Android hardware keystore autofill cache, and local encryption keys from this device.
                    </p>
                    <button className="nv-btn nv-btn-danger nv-btn-sm" onClick={onEmergencyNuke}>
                      ☠️ Emergency Cryptographic Nuke
                    </button>
                  </Card>
                </div>
              )}

              {/* PAGE 5: SETTINGS */}
              {activeTab === 'settings' && (
                <div>
                  {/* Browser & System Autofill Card with Chrome Guide */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Android &amp; Google Chrome Autofill</div>
                      <span className="nv-badge success">Active</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      NextVault provides dual-engine autofill: a resilient floating overlay for Google Chrome, Brave, Firefox &amp; Edge, plus standard Android system autofill.
                    </p>

                    {/* Section 1: Accessibility Overlay (Bitdefender/Bitwarden-style floating pill) */}
                    <div style={{ background: 'var(--nv-bg-2)', padding: '0.75rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff' }}>🛡️ Chrome &amp; Browser Overlay Service:</div>
                        <span className={`nv-badge ${a11yEnabled ? 'success' : 'warning'}`}>
                          {a11yEnabled ? 'Active' : 'Setup Required'}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem', lineHeight: '1.45' }}>
                        Operates on top of Google Chrome and all mobile browsers. When focusing a login textbox, a floating glassmorphic NexVault pill appears to fill credentials in one tap.
                      </p>
                      <div style={{ fontSize: '0.70rem', color: '#00ff9d', marginBottom: '0.6rem' }}>
                        🔒 <strong>Strict Field Filter:</strong> Only detects username, email, and password textboxes. Addresses, zip codes, and search bars are strictly excluded.
                      </div>
                      {/* Android 13/14+ Restricted Settings Callout */}
                      {!a11yEnabled && (
                        <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: 'var(--nv-radius-sm)', padding: '0.65rem 0.75rem', margin: '0.65rem 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#facc15', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                            <span>⚠️</span>
                            <span>Android 13 / 14 "Restricted Setting" Fix:</span>
                          </div>
                          <p style={{ fontSize: '0.70rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem', lineHeight: '1.4' }}>
                            If Android shows <em>"For your security, this setting is currently unavailable"</em> when trying to enable the overlay, Google restricts sideloaded APKs until unlocked in App Info.
                          </p>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              className="nv-btn nv-btn-sm"
                              style={{ background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
                              onClick={async () => {
                                await openAppDetailsSettings();
                                showToast('Tap (⋮) top-right -> "Allow restricted settings"');
                              }}
                            >
                              🔓 1. Open App Info to Allow Restricted Settings
                            </button>
                            <button
                              className="nv-btn nv-btn-ghost nv-btn-sm"
                              style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
                              onClick={() => setShowRestrictedGuide(true)}
                            >
                              📖 Step-by-Step Guide
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        <button className="nv-btn nv-btn-accent nv-btn-sm" onClick={async () => {
                          await openAccessibilitySettings();
                          showToast('Enable "NexVault Autofill Overlay" under Downloaded Apps');
                        }}>
                          ⚙️ {a11yEnabled ? 'Configure Accessibility Service' : '2. Enable Overlay in Accessibility'}
                        </button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => setShowRestrictedGuide(true)}>
                          🔓 Fix Restricted Setting
                        </button>
                      </div>
                    </div>
                    
                    {/* Section 2: Standard Android Autofill Framework */}
                    <div style={{ background: 'var(--nv-bg-2)', padding: '0.75rem', borderRadius: 'var(--nv-radius-sm)', border: '1px solid var(--nv-border)', marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff', marginBottom: '0.35rem' }}>📱 Standard Android Autofill Framework:</div>
                      <ol style={{ fontSize: '0.72rem', color: 'var(--nv-text-secondary)', margin: '0 0 0.5rem', paddingLeft: '1.2rem', lineHeight: '1.5' }}>
                        <li>Tap <strong>"Open Autofill Settings"</strong> below and set NexVault as default autofill service.</li>
                        <li>Tap <strong>"Sync Vault to Native Keystore"</strong> below to prime stored logins into Android KeyStore.</li>
                      </ol>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={openAutofillSettings}>
                          ⚙️ Open Android Autofill Settings
                        </button>
                        <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={async () => {
                          const st = (window as any).nexVault?.loadVault?.();
                          if (st) {
                            await syncAutofillCredentials(st.passwords);
                            showToast('Synced vault credentials to Android native keystore!');
                          }
                        }}>
                          🔄 Sync Vault to Native Keystore
                        </button>
                      </div>
                    </div>
                  </Card>

                  {/* Inactivity Auto-Lock Setting Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Inactivity Auto-Lock</div>
                      <span className="nv-badge success">
                        {autoLockMinutes === 'never' ? 'Disabled' : `${autoLockMinutes} Min`}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Lock mobile vault and purge decryption keys from memory when device is idle.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="nv-label" style={{ marginBottom: 0, fontSize: '0.75rem' }}>Timeout:</label>
                      <select
                        className="nv-input"
                        style={{ maxWidth: '160px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                        value={String(autoLockMinutes)}
                        onChange={e => onChangeAutoLock(e.target.value)}
                      >
                        <option value="1">1 Minute</option>
                        <option value="2">2 Minutes</option>
                        <option value="5">5 Minutes</option>
                        <option value="15">15 Minutes</option>
                        <option value="30">30 Minutes</option>
                        <option value="never">Never (Disabled)</option>
                      </select>
                    </div>
                  </Card>

                  {/* Data & Migration Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.35rem' }}>Data &amp; Migration</div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Bulk import passwords and 2FA accounts from Chrome, Bitwarden, 1Password, or standard CSV/JSON files.
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

                  {/* Application Updates Card */}
                  <Card style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>Application Updates</div>
                      <span className="nv-badge">v{CURRENT_VERSION}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Check GitHub releases for seamless in-place APK updates.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={() => checkMobileUpdates(true)}>
                        Check for Updates
                      </button>
                      {updateInfo && updateInfo.hasUpdate && (
                        <>
                          <button
                            className="nv-btn nv-btn-accent nv-btn-sm"
                            disabled={isUpdating}
                            onClick={onApplyMobileUpdate}
                          >
                            {isUpdating
                              ? (updateProgress !== null && updateProgress > 0 ? `Downloading ${updateProgress}%...` : 'Verifying...')
                              : `Install v${updateInfo.latestVersion}`}
                          </button>
                          <button
                            className="nv-btn nv-btn-ghost nv-btn-sm"
                            onClick={onDownloadApkInBrowser}
                            title="Directly download the APK file in browser"
                          >
                            Browser Download
                          </button>
                        </>
                      )}
                    </div>
                  </Card>

                  {/* Vault Identity & Token Card */}
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

                  {/* Session Card */}
                  <Card style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.35rem' }}>Session</div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--nv-muted)', margin: '0 0 0.75rem' }}>
                      Lock your vault to encrypt passwords and keys in memory.
                    </p>
                    <button className="nv-btn nv-btn-ghost nv-btn-sm" onClick={onLockVault}>
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
              className={`nv-nav-button ${activeTab === 'security' ? 'active' : ''}`}
              onClick={() => setActiveTab('security')}
              style={{ position: 'relative' }}
            >
              <span className="nav-icon">
                <Shield size={18} />
              </span>
              <span>Security</span>
              {incomingExtensionRequest && (
                <span style={{ position: 'absolute', top: 6, right: '25%', width: 7, height: 7, borderRadius: '50%', background: 'var(--nv-primary)', boxShadow: '0 0 6px var(--nv-primary)' }} />
              )}
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

        {/* Android 13/14+ Restricted Settings Unlock Modal */}
        {showRestrictedGuide && (
          <RestrictedSettingsGuideModal
            onClose={() => setShowRestrictedGuide(false)}
            showToast={showToast}
            diagStatus={diagStatus}
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
