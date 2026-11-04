/**
 * mobileVault.ts - Standalone mobile & browser vault adapter for NexVault Mobile.
 * Provides the window.nexVault API with real peer-to-peer NexGrid signaling,
 * X25519 sealed-box encryption via TweetNaCl, automatic device pairing, and vault sync.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

export interface StoredCredential {
  service: string;
  credential: string;
  username?: string;
  createdAt: string;
}

export interface StoredOTP {
  service: string;
  secret: string;
  createdAt: string;
  code?: string;
}

export interface TrustedPeerInfo {
  deviceId: string;
  publicKey?: string;
  deviceName?: string;
  pairedAt?: string;
}

export interface MobileVaultState {
  username: string;
  derivedKeyHash: string;
  tokenId: string;
  publicKey: string;       // Root token authority public key (ed25519 base64)
  signature: string;       // Root token signature (base64)
  expiresAt: string;
  devicePublicKey: string; // Mobile's unique device ID / public key
  deviceSecretKey: string; // Mobile's ed25519 secret key
  x25519PublicKey: string; // Mobile's X25519 public key (base64)
  x25519SecretKey: string; // Mobile's X25519 secret key (base64)
  relayUrl: string;
  trustedPeers: (string | TrustedPeerInfo)[];
  passwords: StoredCredential[];
  otps: StoredOTP[];
}

export const CURRENT_VERSION = '0.1.13';
export const GITHUB_REPO = 'yousseflashin/nextvault';

export function parseOtpAuthUri(uri: string): { service: string; account: string; secret: string; algorithm?: string; digits?: number; period?: number } | null {
  if (!uri || typeof uri !== 'string') return null;
  const clean = uri.trim();
  if (!clean.startsWith('otpauth://')) return null;

  try {
    const url = new URL(clean);
    let label = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let service = label;
    let account = '';

    if (label.includes(':')) {
      const parts = label.split(':');
      service = parts[0].trim();
      account = parts.slice(1).join(':').trim();
    }

    const secret = url.searchParams.get('secret');
    const issuer = url.searchParams.get('issuer');
    if (issuer) service = issuer.trim();

    if (!secret) return null;

    return {
      service: service || '2FA Service',
      account,
      secret: secret.replace(/\s+/g, '').toUpperCase(),
      algorithm: url.searchParams.get('algorithm') || 'SHA1',
      digits: parseInt(url.searchParams.get('digits') || '6', 10),
      period: parseInt(url.searchParams.get('period') || '30', 10)
    };
  } catch {
    return null;
  }
}

export function parseCsvRows(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push('');
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      if (row.length > 1 || row[0] !== '') {
        lines.push(row);
      }
      row = [''];
    } else {
      row[row.length - 1] += ch;
    }
  }

  if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    lines.push(row);
  }

  return lines;
}

function cleanServiceUrl(service: string): string {
  if (!service) return 'Service';
  let s = String(service).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      return u.hostname.replace(/^www\./, '') || s;
    } catch {
      return s;
    }
  }
  return s;
}

export function parseBulkImport(rawContent: string): { passwords: { service: string; username: string; credential: string }[]; otps: { service: string; secret: string }[]; totalCount: number } {
  if (!rawContent || typeof rawContent !== 'string') {
    return { passwords: [], otps: [], totalCount: 0 };
  }

  const trimmed = rawContent.trim();
  const passwords: { service: string; username: string; credential: string }[] = [];
  const otps: { service: string; secret: string }[] = [];

  // 1. JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const items = Array.isArray(data)
        ? data
        : (data.items || data.passwords || data.credentials || data.logins || []);

      for (const item of items) {
        if (item.login) {
          const serviceName = item.name || (item.login.uris && item.login.uris[0]?.uri) || 'Service';
          const service = cleanServiceUrl(serviceName);
          if (item.login.password) {
            passwords.push({
              service,
              username: item.login.username || '',
              credential: item.login.password
            });
          }
          if (item.login.totp) {
            const parsedUri = parseOtpAuthUri(item.login.totp);
            const secret = parsedUri ? parsedUri.secret : item.login.totp.replace(/\s+/g, '').toUpperCase();
            otps.push({ service, secret });
          }
          continue;
        }

        const serviceRaw = item.service || item.name || item.title || item.url || item.website || '';
        const service = cleanServiceUrl(serviceRaw);
        const username = item.username || item.user || item.login || item.email || '';
        const credential = item.credential || item.password || item.pass || '';
        const otpRaw = item.secret || item.totp || item.otp || item.otpSecret || '';

        if (service && credential) passwords.push({ service, username, credential });
        if (service && otpRaw) {
          const parsed = parseOtpAuthUri(otpRaw);
          const secret = parsed ? parsed.secret : otpRaw.replace(/\s+/g, '').toUpperCase();
          otps.push({ service, secret });
        }
      }

      if (passwords.length > 0 || otps.length > 0) {
        return { passwords, otps, totalCount: passwords.length + otps.length };
      }
    } catch {}
  }

  // 2. Lines of otpauth:// URIs
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  const uriMatches = lines.filter(l => l.startsWith('otpauth://'));
  if (uriMatches.length > 0 && uriMatches.length >= lines.length / 2) {
    for (const uri of uriMatches) {
      const parsed = parseOtpAuthUri(uri);
      if (parsed) otps.push({ service: parsed.service, secret: parsed.secret });
    }
    return { passwords, otps, totalCount: otps.length };
  }

  // 3. CSV
  const rows = parseCsvRows(trimmed);
  if (rows.length >= 2) {
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const serviceIdx = headers.findIndex(h =>
      ['service', 'name', 'title', 'url', 'website', 'login_uri'].includes(h)
    );
    const userIdx = headers.findIndex(h =>
      ['username', 'user', 'login', 'email', 'login_username'].includes(h)
    );
    const passIdx = headers.findIndex(h =>
      ['password', 'pass', 'credential', 'login_password'].includes(h)
    );
    const totpIdx = headers.findIndex(h =>
      ['totp', 'otp', '2fa', 'secret', 'login_totp'].includes(h)
    );

    if (passIdx >= 0 || totpIdx >= 0 || (serviceIdx >= 0 && userIdx >= 0)) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(cell => !cell.trim())) continue;

        let service = (serviceIdx >= 0 && r[serviceIdx]) ? r[serviceIdx].trim() : `Entry ${i}`;
        service = cleanServiceUrl(service);

        const username = (userIdx >= 0 && r[userIdx]) ? r[userIdx].trim() : '';
        const credential = (passIdx >= 0 && r[passIdx]) ? r[passIdx].trim() : '';
        const totpRaw = (totpIdx >= 0 && r[totpIdx]) ? r[totpIdx].trim() : '';

        if (credential) passwords.push({ service, username, credential });
        if (totpRaw) {
          const parsed = parseOtpAuthUri(totpRaw);
          const secret = parsed ? parsed.secret : totpRaw.replace(/\s+/g, '').toUpperCase();
          otps.push({ service, secret });
        }
      }
      return { passwords, otps, totalCount: passwords.length + otps.length };
    }
  }

  return { passwords, otps, totalCount: passwords.length + otps.length };
}

export function isPeerTrusted(peerId: string, state: MobileVaultState): boolean {
  if (!state.trustedPeers) return false;
  return state.trustedPeers.some((p: any) => {
    if (typeof p === 'string') return p === peerId;
    return p && p.deviceId === peerId;
  });
}

export function addTrustedPeer(peer: { deviceId: string; publicKey?: string; deviceName?: string }, state: MobileVaultState) {
  if (!state.trustedPeers) state.trustedPeers = [];
  const existingIdx = state.trustedPeers.findIndex((p: any) => {
    if (typeof p === 'string') return p === peer.deviceId;
    return p && p.deviceId === peer.deviceId;
  });
  const entry: TrustedPeerInfo = {
    deviceId: peer.deviceId,
    publicKey: peer.publicKey || '',
    deviceName: peer.deviceName || 'Desktop Device',
    pairedAt: new Date().toISOString()
  };
  if (existingIdx >= 0) {
    state.trustedPeers[existingIdx] = entry;
  } else {
    state.trustedPeers.push(entry);
  }
  saveVault(state);
}

export function removeTrustedPeer(peerId: string, state: MobileVaultState) {
  if (!state.trustedPeers) return;
  state.trustedPeers = state.trustedPeers.filter((p: any) => {
    if (typeof p === 'string') return p !== peerId;
    return p && p.deviceId !== peerId;
  });
  saveVault(state);
}

function compareVersions(v1: string, v2: string): number {
  const p1 = (v1 || '').replace(/^v/, '').split('.').map(Number);
  const p2 = (v2 || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export interface GridCallbacks {
  onLog?: (msg: string) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'paired') => void;
  onPeerDiscovered?: (peer: { deviceId: string; publicKey: string; deviceName: string }) => void;
  onPairApproved?: (peer: { deviceId: string; deviceName: string }) => void;
  onIncomingPairRequest?: (request: { from: string; deviceName: string; publicKey: string; code?: string }) => void;
  onVaultSynced?: (count: number) => void;
}

const STORAGE_KEY = 'nexvault_mobile_vault_v2';
let activeSocket: WebSocket | null = null;
let currentCallbacks: GridCallbacks | null = null;
const remotePeerKeys = new Map<string, string>();
const pendingIncomingRequests = new Map<string, { from: string; deviceName: string; publicKey: string; code?: string }>();
let activeMobilePairingCode: { code: string; expiresAt: number } | null = null;

export function getDefaultRelayUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:46123';
  const hostname = window.location.hostname;
  // If running in Android emulator or local dev
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://127.0.0.1:46123';
  }
  return `ws://${hostname}:46123`;
}

export function getSavedRelayUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('nexvault_relay_url');
      if (saved && saved.trim()) return saved.trim();
    } catch {}
  }
  return getDefaultRelayUrl();
}

async function deriveKey(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    256
  );

  return btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
}

export function loadVault(): MobileVaultState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveVault(state: MobileVaultState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Sealed box encryption (X25519)
function encryptBox(messageStr: string, recipientPublicKeyBase64: string) {
  const messageBytes = naclUtil.decodeUTF8(messageStr);
  const recipientPublicKey = naclUtil.decodeBase64(recipientPublicKeyBase64);
  const ephemeralKeyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeralKeyPair.secretKey);
  if (!encrypted) throw new Error('Encryption failed');
  return {
    ciphertext: naclUtil.encodeBase64(encrypted),
    nonce: naclUtil.encodeBase64(nonce),
    ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey)
  };
}

function decryptBox(encryptedData: any, recipientSecretKeyBytes: Uint8Array): string {
  const ciphertext = naclUtil.decodeBase64(encryptedData.ciphertext);
  const nonce = naclUtil.decodeBase64(encryptedData.nonce);
  const ephemeralPublicKey = naclUtil.decodeBase64(encryptedData.ephemeralPublicKey);
  const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipientSecretKeyBytes);
  if (!decrypted) throw new Error('Decryption failed');
  return naclUtil.encodeUTF8(decrypted);
}

// RFC 6238 TOTP in browser Web Crypto API
function base32Decode(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of clean) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

export async function calculateTotpCode(secret: string, period = 30, digits = 6): Promise<string> {
  try {
    const keyBytes = base32Decode(secret);
    if (!keyBytes.length) return '000000';
    const counter = Math.floor(Date.now() / 1000 / period);
    const counterBytes = new Uint8Array(8);
    const view = new DataView(counterBytes.buffer);
    view.setBigUint64(0, BigInt(counter));

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
    const sigBytes = new Uint8Array(signature);
    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary =
      ((sigBytes[offset] & 0x7f) << 24) |
      ((sigBytes[offset + 1] & 0xff) << 16) |
      ((sigBytes[offset + 2] & 0xff) << 8) |
      (sigBytes[offset + 3] & 0xff);

    const otp = binary % 10 ** digits;
    return otp.toString().padStart(digits, '0');
  } catch {
    return '000000';
  }
}

function handleIncomingMobileSignal(from: string, payload: any, state: MobileVaultState, socket: WebSocket, callbacks?: GridCallbacks) {
  if (!payload || typeof payload !== 'object') return;

  // 1. Direct encrypted tunnel message
  if (payload.type === 'encrypted') {
    try {
      const mySecretKey = naclUtil.decodeBase64(state.x25519SecretKey);
      const decryptedStr = decryptBox(payload.payload, mySecretKey);
      const decrypted = JSON.parse(decryptedStr);
      if (decrypted.type === 'vault-sync') {
        applyVaultSync(decrypted.vaultData, state, callbacks);
      }
      return;
    } catch (err: any) {
      console.error('[MobileGrid] Error decrypting signal:', err);
      return;
    }
  }

  // 2. Pairing approved by peer!
  if (payload.type === 'pair-approved') {
    addTrustedPeer({
      deviceId: from,
      publicKey: payload.publicKey,
      deviceName: payload.fromDeviceName || payload.deviceName || from
    }, state);
    if (payload.publicKey) {
      remotePeerKeys.set(from, payload.publicKey);
    }
    callbacks?.onLog?.(`✅ PAIRING APPROVED by "${payload.fromDeviceName || payload.deviceName || from}"!`);
    callbacks?.onStatusChange?.('paired');
    callbacks?.onPairApproved?.({ deviceId: from, deviceName: payload.fromDeviceName || payload.deviceName || from });

    // Request full vault synchronization from approved peer
    callbacks?.onLog?.('Requesting initial vault sync from mesh peer...');
    socket.send(JSON.stringify({
      type: 'signal',
      to: from,
      payload: {
        type: 'vault-sync-request',
        fromDeviceId: state.devicePublicKey,
        publicKey: state.x25519PublicKey
      }
    }));
    // Bidirectional sync: also send our vault entries to the peer
    broadcastVaultToPeer(from, state, socket);
    return;
  }

  // 3. Pairing rejected
  if (payload.type === 'pair-rejected') {
    callbacks?.onLog?.(`❌ Pairing declined by peer: ${payload.reason || 'Declined'}`);
    return;
  }

  // 4. Incoming pair request from another device
  if (payload.type === 'pair-request') {
    if (payload.publicKey) {
      remotePeerKeys.set(from, payload.publicKey);
    }

    // A. Check if the incoming request matches active pairing code generated on this mobile node
    if (activeMobilePairingCode && activeMobilePairingCode.code && payload.code === activeMobilePairingCode.code) {
      if (Date.now() < activeMobilePairingCode.expiresAt) {
        activeMobilePairingCode = null;
        callbacks?.onLog?.(`✨ Valid pairing code matched from "${payload.fromDeviceName || from}". Auto-approving & syncing.`);
        saveTrustedDevice({
          deviceId: from,
          publicKey: payload.publicKey,
          deviceName: payload.fromDeviceName || from
        }, state);
        socket.send(JSON.stringify({
          type: 'signal',
          to: from,
          payload: {
            type: 'pair-approved',
            fromDeviceId: state.devicePublicKey,
            fromDeviceName: 'NextVault Mobile Mesh Node',
            publicKey: state.x25519PublicKey
          }
        }));
        broadcastVaultToPeer(from, state, socket);
        callbacks?.onStatusChange?.('paired');
        callbacks?.onPairApproved?.({ deviceId: from, deviceName: payload.fromDeviceName || from, publicKey: payload.publicKey });
        return;
      }
    }

    // B. Check if peer is already trusted
    if (isPeerTrusted(from, state)) {
      callbacks?.onLog?.(`Mesh peer "${payload.fromDeviceName || from}" is already trusted. Auto-accepting.`);
      socket.send(JSON.stringify({
        type: 'signal',
        to: from,
        payload: {
          type: 'pair-approved',
          fromDeviceId: state.devicePublicKey,
          fromDeviceName: 'NextVault Mobile Mesh Node',
          publicKey: state.x25519PublicKey
        }
      }));
      broadcastVaultToPeer(from, state, socket);
      return;
    }

    pendingIncomingRequests.set(from, {
      from,
      deviceName: payload.fromDeviceName || from,
      publicKey: payload.publicKey,
      code: payload.code
    });
    callbacks?.onLog?.(`🔔 Incoming pairing request from "${payload.fromDeviceName || from}"`);
    callbacks?.onIncomingPairRequest?.({
      from,
      deviceName: payload.fromDeviceName || from,
      publicKey: payload.publicKey,
      code: payload.code
    });
    return;
  }

  // 5. Plain vault-sync payload
  if (payload.type === 'vault-sync') {
    applyVaultSync(payload.vaultData, state, callbacks);
    return;
  }

  // 6. Peer requested vault sync from us
  if (payload.type === 'vault-sync-request') {
    broadcastVaultToPeer(from, state, socket);
  }
}

const vaultUpdatedListeners: (() => void)[] = [];
function notifyVaultUpdated() {
  vaultUpdatedListeners.forEach(fn => {
    try { fn(); } catch (err) { console.error('[MobileGrid] Error in onVaultUpdated listener:', err); }
  });
}

function applyVaultSync(vaultData: any, state: MobileVaultState, callbacks?: GridCallbacks) {
  if (!vaultData) return;
  let importedPasswords = 0;
  let importedOTPs = 0;

  if (Array.isArray(vaultData.passwords)) {
    for (const p of vaultData.passwords) {
      if (!p.service || !p.credential) continue;
      const idx = state.passwords.findIndex(x => x.service.toLowerCase() === p.service.toLowerCase());
      const entry: StoredCredential = {
        service: p.service,
        credential: p.credential,
        username: p.username || '',
        createdAt: p.createdAt || new Date().toISOString()
      };
      if (idx >= 0) state.passwords[idx] = entry;
      else state.passwords.push(entry);
      importedPasswords++;
    }
  }

  if (Array.isArray(vaultData.otps)) {
    for (const o of vaultData.otps) {
      if (!o.service || !o.secret) continue;
      const idx = state.otps.findIndex(x => x.service.toLowerCase() === o.service.toLowerCase());
      const entry: StoredOTP = {
        service: o.service,
        secret: o.secret,
        createdAt: o.createdAt || new Date().toISOString()
      };
      if (idx >= 0) state.otps[idx] = entry;
      else state.otps.push(entry);
      importedOTPs++;
    }
  }

  saveVault(state);
  const cb = callbacks || currentCallbacks;
  cb?.onLog?.(`🔄 Vault synchronized from peer: ${importedPasswords} passwords, ${importedOTPs} OTPs loaded!`);
  cb?.onVaultSynced?.(importedPasswords + importedOTPs);
  notifyVaultUpdated();
}

function broadcastVaultToPeer(peerId: string, state: MobileVaultState, socket: WebSocket) {
  const remotePubKey = remotePeerKeys.get(peerId);
  const payloadData = {
    type: 'vault-sync',
    vaultData: {
      passwords: state.passwords,
      otps: state.otps,
      timestamp: Date.now()
    }
  };

  if (remotePubKey) {
    const encrypted = encryptBox(JSON.stringify(payloadData), remotePubKey);
    socket.send(JSON.stringify({
      type: 'signal',
      to: peerId,
      payload: { type: 'encrypted', payload: encrypted }
    }));
  } else {
    socket.send(JSON.stringify({
      type: 'signal',
      to: peerId,
      payload: payloadData
    }));
  }
}

export function initMobileVault() {
  if (typeof window === 'undefined') return;
  if ((window as any).nexVault && (window as any).nexVault.__isMobileReady) return;

  (window as any).nexVault = {
    __isMobileReady: true,

    async getVaultProfile() {
      const state = loadVault();
      if (!state) return { hasUser: false };
      return {
        hasUser: true,
        username: state.username,
        tokenId: state.tokenId,
        bootstrapToken: {
          tokenId: state.tokenId,
          publicKey: state.publicKey,
          signature: state.signature,
          expiresAt: state.expiresAt
        }
      };
    },

    async initializeNewUser(username: string, password: string) {
      // 1. Root authority keypair (ed25519)
      const authorityKeys = nacl.sign.keyPair();
      const authorityPub = naclUtil.encodeBase64(authorityKeys.publicKey);

      // 2. Token generation & signing
      const tokenId = 'nexvault-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
      const signature = naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(tokenId), authorityKeys.secretKey));
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // 3. Local unique device keypairs (ed25519 and X25519)
      const deviceEdKeys = nacl.sign.keyPair();
      const deviceXKeys = nacl.box.keyPair();
      const devicePublicKey = 'mobile-' + naclUtil.encodeBase64(deviceEdKeys.publicKey).slice(0, 16).replace(/[/+=]/g, '');

      const derivedKeyHash = await deriveKey(password, authorityPub);

      const state: MobileVaultState = {
        username,
        derivedKeyHash,
        tokenId,
        publicKey: authorityPub,
        signature,
        expiresAt,
        devicePublicKey,
        deviceSecretKey: naclUtil.encodeBase64(deviceEdKeys.secretKey),
        x25519PublicKey: naclUtil.encodeBase64(deviceXKeys.publicKey),
        x25519SecretKey: naclUtil.encodeBase64(deviceXKeys.secretKey),
        relayUrl: getDefaultRelayUrl(),
        trustedPeers: [],
        passwords: [],
        otps: []
      };

      saveVault(state);

      const bootstrapToken = {
        tokenId,
        publicKey: authorityPub,
        signature,
        expiresAt
      };

      return {
        success: true,
        tokenId,
        publicKey: authorityPub,
        bootstrapToken
      };
    },

    async initializeExistingUser(
      tokenId: string,
      publicKey: string,
      signature: string,
      password: string,
      expiresAt: string
    ) {
      if (!tokenId || !publicKey || !signature) {
        throw new Error('Incomplete bootstrap token');
      }

      // Verify ed25519 token signature
      const isValid = nacl.sign.detached.verify(
        naclUtil.decodeUTF8(tokenId),
        naclUtil.decodeBase64(signature),
        naclUtil.decodeBase64(publicKey)
      );

      if (!isValid) {
        throw new Error('Invalid bootstrap token signature');
      }

      if (expiresAt && Date.now() >= new Date(expiresAt).getTime()) {
        throw new Error('Bootstrap token is expired');
      }

      const derivedKeyHash = await deriveKey(password, publicKey);
      let state = loadVault();

      if (!state) {
        const deviceEdKeys = nacl.sign.keyPair();
        const deviceXKeys = nacl.box.keyPair();
        const devicePublicKey = 'mobile-' + naclUtil.encodeBase64(deviceEdKeys.publicKey).slice(0, 16).replace(/[/+=]/g, '');

        state = {
          username: `mobile-${tokenId.slice(-6)}`,
          derivedKeyHash,
          tokenId,
          publicKey,
          signature,
          expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          devicePublicKey,
          deviceSecretKey: naclUtil.encodeBase64(deviceEdKeys.secretKey),
          x25519PublicKey: naclUtil.encodeBase64(deviceXKeys.publicKey),
          x25519SecretKey: naclUtil.encodeBase64(deviceXKeys.secretKey),
          relayUrl: getDefaultRelayUrl(),
          trustedPeers: [],
          passwords: [],
          otps: []
        };
      } else {
        if (state.derivedKeyHash !== derivedKeyHash) {
          throw new Error('Invalid master password');
        }
      }

      saveVault(state);
      return { success: true, tokenId };
    },

    async startNexGrid(options?: { relayUrl?: string }, callbacks?: GridCallbacks) {
      currentCallbacks = callbacks || null;
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        callbacks?.onLog?.('NexGrid is already running.');
        return { success: true, peers: [] };
      }

      const relayUrl = options?.relayUrl?.trim() || getSavedRelayUrl() || state.relayUrl || getDefaultRelayUrl();
      state.relayUrl = relayUrl;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('nexvault_relay_url', relayUrl);
        }
      } catch {}
      saveVault(state);

      callbacks?.onLog?.(`Connecting to relay: ${relayUrl}...`);
      callbacks?.onStatusChange?.('connecting');

      return new Promise((resolve) => {
        let resolved = false;
        try {
          const socket = new WebSocket(relayUrl);
          activeSocket = socket;

          const connTimeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              callbacks?.onLog?.('Relay connection timed out. Check network or server URL.');
              callbacks?.onStatusChange?.('disconnected');
              resolve({ success: false, error: 'Connection timed out' });
            }
          }, 6000);

          socket.onopen = () => {
            callbacks?.onLog?.('Connected to relay. Authenticating with account token...');
            callbacks?.onStatusChange?.('connected');

            socket.send(JSON.stringify({
              type: 'device-auth',
              token: {
                tokenId: state.tokenId,
                publicKey: state.publicKey,
                signature: state.signature,
                expiresAt: state.expiresAt
              },
              deviceId: state.devicePublicKey,
              publicKey: state.x25519PublicKey,
              deviceName: 'NextVault Mobile Mesh Node'
            }));
          };

          socket.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);

              if (message.type === 'peer-list') {
                clearTimeout(connTimeout);
                if (!resolved) {
                  resolved = true;
                  resolve({ success: true, peers: message.peers });
                }
                const peers = message.peers || [];
                callbacks?.onLog?.(`📡 Discovered ${peers.length} peer(s) in network.`);

                for (const peer of peers) {
                  if (peer.publicKey) remotePeerKeys.set(peer.deviceId, peer.publicKey);
                  callbacks?.onPeerDiscovered?.(peer);

                  if (isPeerTrusted(peer.deviceId, state)) {
                    callbacks?.onLog?.(`✨ Reconnected with paired device: "${peer.deviceName || peer.deviceId}". Syncing...`);
                    callbacks?.onStatusChange?.('paired');
                    callbacks?.onPairApproved?.({ deviceId: peer.deviceId, deviceName: peer.deviceName || peer.deviceId });
                    socket.send(JSON.stringify({
                      type: 'signal',
                      to: peer.deviceId,
                      payload: {
                        type: 'vault-sync-request',
                        fromDeviceId: state.devicePublicKey,
                        publicKey: state.x25519PublicKey
                      }
                    }));
                  } else {
                    callbacks?.onLog?.(`Initiating automatic pairing with ${peer.deviceName || peer.deviceId}...`);
                    socket.send(JSON.stringify({
                      type: 'signal',
                      to: peer.deviceId,
                      payload: {
                        type: 'pair-request',
                        fromDeviceId: state.devicePublicKey,
                        fromDeviceName: 'NextVault Mobile Mesh Node',
                        publicKey: state.x25519PublicKey,
                        timestamp: Date.now()
                      }
                    }));
                    callbacks?.onLog?.(`Pair request sent to ${peer.deviceName || peer.deviceId}. Awaiting approval...`);
                  }
                }
              } else if (message.type === 'peer-joined') {
                const peer = message.peer;
                if (peer.publicKey) remotePeerKeys.set(peer.deviceId, peer.publicKey);
                callbacks?.onPeerDiscovered?.(peer);

                if (isPeerTrusted(peer.deviceId, state)) {
                  callbacks?.onLog?.(`✨ Paired peer rejoined: "${peer.deviceName || peer.deviceId}". Syncing...`);
                  callbacks?.onStatusChange?.('paired');
                  callbacks?.onPairApproved?.({ deviceId: peer.deviceId, deviceName: peer.deviceName || peer.deviceId });
                  socket.send(JSON.stringify({
                    type: 'signal',
                    to: peer.deviceId,
                    payload: {
                      type: 'vault-sync-request',
                      fromDeviceId: state.devicePublicKey,
                      publicKey: state.x25519PublicKey
                    }
                  }));
                } else {
                  callbacks?.onLog?.(`📡 New peer joined network: ${peer.deviceName || peer.deviceId}`);
                  callbacks?.onLog?.(`Sending pairing request to ${peer.deviceName || peer.deviceId}...`);
                  socket.send(JSON.stringify({
                    type: 'signal',
                    to: peer.deviceId,
                    payload: {
                      type: 'pair-request',
                      fromDeviceId: state.devicePublicKey,
                      fromDeviceName: 'NextVault Mobile Mesh Node',
                      publicKey: state.x25519PublicKey,
                      timestamp: Date.now()
                    }
                  }));
                }
              } else if (message.type === 'signal') {
                handleIncomingMobileSignal(message.from, message.payload, state, socket, callbacks);
              }
            } catch (err: any) {
              console.error('[MobileGrid] Error parsing message:', err);
            }
          };

          socket.onerror = () => {
            clearTimeout(connTimeout);
            callbacks?.onLog?.('Relay connection error.');
            callbacks?.onStatusChange?.('disconnected');
            if (!resolved) {
              resolved = true;
              resolve({ success: false, error: 'Connection error' });
            }
          };

          socket.onclose = () => {
            clearTimeout(connTimeout);
            callbacks?.onLog?.('Disconnected from relay.');
            callbacks?.onStatusChange?.('disconnected');
            activeSocket = null;
          };
        } catch (err: any) {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: err.message });
          }
        }
      });
    },

    async stopNexGrid() {
      if (activeSocket) {
        activeSocket.close();
        activeSocket = null;
      }
      currentCallbacks?.onStatusChange?.('disconnected');
      currentCallbacks?.onLog?.('NexGrid stopped.');
      return { success: true };
    },

    async pairWithCode(code: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        throw new Error('NexGrid is not connected. Start NexGrid first.');
      }

      currentCallbacks?.onLog?.(`Announcing pair request with code ${code}...`);
      activeSocket.send(JSON.stringify({
        type: 'signal',
        to: '*',
        payload: {
          type: 'pair-request',
          code: code.trim(),
          fromDeviceId: state.devicePublicKey,
          fromDeviceName: 'NextVault Mobile Mesh Node',
          publicKey: state.x25519PublicKey,
          timestamp: Date.now()
        }
      }));
      return { success: true };
    },

    async requestPairingCode() {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      activeMobilePairingCode = {
        code,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      return { success: true, code, expiresAt: activeMobilePairingCode.expiresAt };
    },

    async approvePairRequest(peerId: string) {
      const state = loadVault();
      if (!state || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        throw new Error('Not connected');
      }
      const req = pendingIncomingRequests.get(peerId);
      if (!state.trustedPeers.includes(peerId)) {
        state.trustedPeers.push(peerId);
        saveVault(state);
      }
      activeSocket.send(JSON.stringify({
        type: 'signal',
        to: peerId,
        payload: {
          type: 'pair-approved',
          fromDeviceId: state.devicePublicKey,
          fromDeviceName: 'NextVault Mobile Mesh Node',
          publicKey: state.x25519PublicKey
        }
      }));
      broadcastVaultToPeer(peerId, state, activeSocket);
      pendingIncomingRequests.delete(peerId);
      currentCallbacks?.onLog?.(`Approved pair request for ${req?.deviceName || peerId}. Synchronizing vault...`);
      return { success: true };
    },

    async rejectPairRequest(peerId: string) {
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify({
          type: 'signal',
          to: peerId,
          payload: { type: 'pair-rejected', reason: 'Declined by mesh peer' }
        }));
      }
      pendingIncomingRequests.delete(peerId);
      return { success: true };
    },

    async addPassword(service: string, credential: string, username = '') {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');

      const existingIdx = state.passwords.findIndex(p => p.service.toLowerCase() === service.toLowerCase());
      const entry: StoredCredential = {
        service,
        credential,
        username,
        createdAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        state.passwords[existingIdx] = entry;
      } else {
        state.passwords.push(entry);
      }

      saveVault(state);

      // Broadcast update to all trusted peers if connected
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }

      return { success: true };
    },

    async listPasswords() {
      const state = loadVault();
      if (!state) return { success: true, entries: [] };
      return {
        success: true,
        entries: state.passwords.map(p => ({ service: p.service, username: p.username || '', createdAt: p.createdAt }))
      };
    },

    async getPassword(service: string) {
      const state = loadVault();
      if (!state) return { success: false, error: 'Vault is locked' };
      const entry = state.passwords.find(p => p.service.toLowerCase() === service.toLowerCase());
      if (!entry) return { success: false, error: 'Not found' };
      return { success: true, password: entry.credential, username: entry.username || '' };
    },

    async deletePassword(service: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      state.passwords = state.passwords.filter(p => p.service.toLowerCase() !== service.toLowerCase());
      saveVault(state);
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }
      return { success: true };
    },

    async addOTP(service: string, secret: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');

      const existingIdx = state.otps.findIndex(o => o.service.toLowerCase() === service.toLowerCase());
      const entry: StoredOTP = {
        service,
        secret,
        createdAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        state.otps[existingIdx] = entry;
      } else {
        state.otps.push(entry);
      }

      saveVault(state);

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }

      return { success: true };
    },

    async listOTPs() {
      const state = loadVault();
      if (!state) return { success: true, entries: [] };
      const entriesWithCodes = await Promise.all(
        state.otps.map(async o => ({
          service: o.service,
          createdAt: o.createdAt,
          code: await calculateTotpCode(o.secret)
        }))
      );
      return {
        success: true,
        entries: entriesWithCodes
      };
    },

    async getOTP(service: string) {
      const state = loadVault();
      if (!state) return { success: false, error: 'Vault is locked' };
      const entry = state.otps.find(o => o.service.toLowerCase() === service.toLowerCase());
      if (!entry) return { success: false, error: 'Not found' };
      const code = await calculateTotpCode(entry.secret);
      return { success: true, code };
    },

    async deleteOTP(service: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      state.otps = state.otps.filter(o => o.service.toLowerCase() !== service.toLowerCase());
      saveVault(state);
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }
      return { success: true };
    },

    async bulkImportPasswords(items: { service: string; credential: string; username?: string }[]) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');
      if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

      let imported = 0;
      for (const item of items) {
        if (!item.service || !item.credential) continue;
        const cleanService = item.service.trim();
        const existingIdx = state.passwords.findIndex(p => p.service.toLowerCase() === cleanService.toLowerCase());
        const entry: StoredCredential = {
          service: cleanService,
          credential: item.credential,
          username: (item.username || '').trim(),
          createdAt: new Date().toISOString()
        };
        if (existingIdx >= 0) {
          state.passwords[existingIdx] = entry;
        } else {
          state.passwords.push(entry);
        }
        imported++;
      }

      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }

      return { success: true, count: imported };
    },

    async bulkImportOTPs(items: { service: string; secret: string }[]) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');
      if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

      let imported = 0;
      for (const item of items) {
        if (!item.service || !item.secret) continue;
        const cleanService = item.service.trim();
        const cleanSecret = item.secret.replace(/\s+/g, '').toUpperCase();
        const existingIdx = state.otps.findIndex(o => o.service.toLowerCase() === cleanService.toLowerCase());
        const entry: StoredOTP = {
          service: cleanService,
          secret: cleanSecret,
          createdAt: new Date().toISOString()
        };
        if (existingIdx >= 0) {
          state.otps[existingIdx] = entry;
        } else {
          state.otps.push(entry);
        }
        imported++;
      }

      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          broadcastVaultToPeer(peerId, state, activeSocket);
        }
      }

      return { success: true, count: imported };
    },

    async syncWithPeers() {
      const state = loadVault();
      if (!state) return { success: false, error: 'Vault is locked' };
      let sentCount = 0;
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN && state.trustedPeers && state.trustedPeers.length) {
        for (const p of state.trustedPeers) {
          const peerId = typeof p === 'string' ? p : p.deviceId;
          activeSocket.send(JSON.stringify({
            type: 'signal',
            to: peerId,
            payload: {
              type: 'vault-sync-request',
              fromDeviceId: state.devicePublicKey,
              publicKey: state.x25519PublicKey
            }
          }));
          sentCount++;
        }
      }
      return {
        success: true,
        peersContacted: sentCount,
        passwordsCount: state.passwords.length,
        otpsCount: state.otps.length
      };
    },

    async checkForUpdates() {
      try {
        const token = (typeof localStorage !== 'undefined' && localStorage.getItem('nexvault_github_token')) || (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers
        });
        if (resp.status === 404) {
          return {
            success: false,
            statusCode: 404,
            currentVersion: CURRENT_VERSION,
            latestVersion: CURRENT_VERSION,
            hasUpdate: false,
            message: `GitHub returned 404 (Not Found). If repository '${GITHUB_REPO}' is private, please make it public on GitHub.`
          };
        }
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const latestTag = data.tag_name || CURRENT_VERSION;
        const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;
        const assets = data.assets || [];
        const apkAsset = assets.find((a: any) => /\.apk$/i.test(a.name));
        const cleanTag = latestTag.replace(/^v/, '');
        const downloadUrl = apkAsset ? apkAsset.browser_download_url : `https://github.com/${GITHUB_REPO}/releases/download/${latestTag}/NexVault-mobile-app-debug.apk`;
        return {
          success: true,
          currentVersion: CURRENT_VERSION,
          latestVersion: latestTag,
          hasUpdate,
          downloadUrl,
          releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
          releaseName: data.name || latestTag,
          notes: data.body || '',
          publishedAt: data.published_at
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          currentVersion: CURRENT_VERSION,
          hasUpdate: false
        };
      }
    },

    async getTrustedDevices() {
      const state = loadVault();
      if (!state) return { success: true, devices: [] };
      return { success: true, devices: state.trustedPeers || [] };
    },

    async applyUpdate(downloadUrl?: string) {
      try {
        if (!downloadUrl) {
          const info = await (window as any).nexVault.checkForUpdates();
          downloadUrl = info.downloadUrl;
        }
        if (!downloadUrl) throw new Error('No update URL found');

        const cap = (window as any).Capacitor;
        if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
          const plugins = cap.Plugins;
          if (plugins && plugins.AppUpdater && typeof plugins.AppUpdater.installApk === 'function') {
            const res = await plugins.AppUpdater.installApk({ url: downloadUrl });
            return { success: true, message: res?.message || 'Package installer launched' };
          }
        }

        window.open(downloadUrl, '_blank');
        return { success: true, message: 'Opening download link...' };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async removeTrustedDevice(deviceId: string) {
      const state = loadVault();
      if (!state) return { success: false };
      removeTrustedPeer(deviceId, state);
      return { success: true };
    },

    async getRelayUrl() {
      return { success: true, relayUrl: getSavedRelayUrl() };
    },

    async setRelayUrl(url: string) {
      if (url && url.trim()) {
        const clean = url.trim();
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('nexvault_relay_url', clean);
          const state = loadVault();
          if (state) {
            state.relayUrl = clean;
            saveVault(state);
          }
        } catch {}
        return { success: true, relayUrl: clean };
      }
      return { success: false, error: 'Invalid URL' };
    },

    onVaultUpdated(callback: () => void) {
      if (typeof callback === 'function' && !vaultUpdatedListeners.includes(callback)) {
        vaultUpdatedListeners.push(callback);
      }
    },

    parseBulkImport(content: string) {
      return parseBulkImport(content);
    },

    parseOtpAuthUri(uri: string) {
      return parseOtpAuthUri(uri);
    }
  };
}

initMobileVault();
