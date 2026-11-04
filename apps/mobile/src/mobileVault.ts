/**
 * mobileVault.ts - Standalone mobile & browser vault adapter for NexVault Mobile.
 * Provides the window.nexVault API with real peer-to-peer NexGrid signaling,
 * X25519 sealed-box encryption via TweetNaCl, automatic device pairing, and vault sync.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { registerPlugin } from '@capacitor/core';

const AutofillBridge = registerPlugin<{
  syncCredentials(options: { credentialsJson: string }): Promise<void>;
    readCredentials(): Promise<{ credentialsJson: string }>;
  clearCredentials(): Promise<void>;
  openSettings(): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
}>('AutofillBridge');

export interface StoredCredential {
  service: string;
  credential: string;
  username?: string;
  createdAt: string;
  updatedAt?: number;
}

export interface StoredOTP {
  service: string;
  secret: string;
  createdAt: string;
  updatedAt?: number;
  code?: string;
}

export function normalizeDomain(service: string): string {
  if (!service) return '';
  return String(service).trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
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
  deletedRecords?: { service: string; type: 'password' | 'otp'; deletedAt: number }[];
}

export const CURRENT_VERSION = '0.1.28';
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

export interface PeerExtensionRequest {
  requestId: string;
  from: string;
  deviceName: string;
  duration: string;
  newDeadline: string;
  requestedAt: string;
}

export interface GridCallbacks {
  onLog?: (msg: string) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'paired') => void;
  onPeerDiscovered?: (peer: { deviceId: string; publicKey: string; deviceName: string }) => void;
  onPairApproved?: (peer: { deviceId: string; deviceName: string }) => void;
  onIncomingPairRequest?: (request: { from: string; deviceName: string; publicKey: string; code?: string }) => void;
  onVaultSynced?: (count: number) => void;
  onIncomingExtensionRequest?: (request: PeerExtensionRequest) => void;
  onExtensionApproved?: (response: { duration: string; expiresAt: string; approverName: string }) => void;
  onExtensionRejected?: (response: { reason: string }) => void;
}

const STORAGE_KEY = 'nexvault_mobile_vault_v3';
let activeSocket: WebSocket | null = null;
let currentCallbacks: GridCallbacks | null = null;
const remotePeerKeys = new Map<string, string>();
const pendingIncomingRequests = new Map<string, { from: string; deviceName: string; publicKey: string; code?: string }>();
let activeMobilePairingCode: { code: string; expiresAt: number } | null = null;
let isManuallyStopped = false;

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

const LEGACY_STORAGE_KEY = 'nexvault_mobile_vault_v2';
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

interface VaultProfile {
  username: string;
  tokenId: string;
  publicKey: string;
  signature: string;
  expiresAt: string;
}

interface VaultEnvelope {
  v: 3;
  iter: number;
  salt: string;
  nonce: string;
  box: string;
  profile: VaultProfile;
}

// Decrypted state and key live only in memory and are wiped on lock.
let cachedState: MobileVaultState | null = null;
let sessionKey: Uint8Array | null = null;
let sessionSalt: Uint8Array | null = null;
let sessionIter = PBKDF2_ITERATIONS;

async function pbkdf2Bytes(password: string, salt: Uint8Array | string, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: typeof salt === 'string' ? enc.encode(salt) : (salt as BufferSource), iterations, hash: 'SHA-256' },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

// Legacy (v2) password check value; only used to verify the password while migrating.
async function legacyDeriveKey(password: string, salt: string): Promise<string> {
  return btoa(String.fromCharCode(...(await pbkdf2Bytes(password, salt, LEGACY_PBKDF2_ITERATIONS))));
}

function readEnvelope(): VaultEnvelope | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const env = raw ? JSON.parse(raw) : null;
    return env && env.v === 3 ? env : null;
  } catch {
    return null;
  }
}

function readLegacyVault(): MobileVaultState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function profileOf(state: MobileVaultState): VaultProfile {
  return {
    username: state.username,
    tokenId: state.tokenId,
    publicKey: state.publicKey,
    signature: state.signature,
    expiresAt: state.expiresAt
  };
}

function persistEncrypted(state: MobileVaultState) {
  if (!sessionKey || !sessionSalt) return;
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(naclUtil.decodeUTF8(JSON.stringify(state)), nonce, sessionKey);
  const envelope: VaultEnvelope = {
    v: 3,
    iter: sessionIter,
    salt: naclUtil.encodeBase64(sessionSalt),
    nonce: naclUtil.encodeBase64(nonce),
    box: naclUtil.encodeBase64(box),
    profile: profileOf(state)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

/** Creates a fresh encryption session (new random salt) for the given password. */
async function startSession(password: string, state: MobileVaultState) {
  sessionSalt = nacl.randomBytes(16);
  sessionIter = PBKDF2_ITERATIONS;
  sessionKey = await pbkdf2Bytes(password, sessionSalt, sessionIter);
  cachedState = state;
  persistEncrypted(state);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  touchOfflineHeartbeat();
}

/** Decrypts the stored vault; throws 'Invalid master password' on failure. */
async function unlockEnvelope(password: string, env: VaultEnvelope): Promise<MobileVaultState> {
  const salt = naclUtil.decodeBase64(env.salt);
  const key = await pbkdf2Bytes(password, salt, env.iter);
  const plain = nacl.secretbox.open(naclUtil.decodeBase64(env.box), naclUtil.decodeBase64(env.nonce), key);
  if (!plain) throw new Error('Invalid master password');
  sessionKey = key;
  sessionSalt = salt;
  sessionIter = env.iter;
  cachedState = JSON.parse(naclUtil.encodeUTF8(plain));
  touchOfflineHeartbeat();
  return cachedState as MobileVaultState;
}

export function isVaultUnlocked(): boolean {
  return cachedState !== null;
}

export function hasStoredVault(): boolean {
  return readEnvelope() !== null || readLegacyVault() !== null;
}

export function getStoredProfile(): VaultProfile | null {
  const env = readEnvelope();
  if (env) return env.profile;
  const legacy = readLegacyVault();
  return legacy ? profileOf(legacy) : null;
}

export function lockVault() {
  isManuallyStopped = true;
  try { activeSocket?.close(); } catch {}
  activeSocket = null;
  remotePeerKeys.clear();
  pendingIncomingRequests.clear();
  if (sessionKey) sessionKey.fill(0);
  sessionKey = null;
  sessionSalt = null;
  cachedState = null;
}

export function loadVault(): MobileVaultState | null {
  return cachedState;
}

export function saveVault(state: MobileVaultState) {
  if (!sessionKey) return; // locked: never persist
  cachedState = state;
  persistEncrypted(state);
  syncAutofillCredentials(state);
}

export function syncAutofillCredentials(state = loadVault()) {
  if (!state || typeof window === 'undefined' || (window as any).Capacitor?.getPlatform?.() !== 'android') return;
  const credentials = state.passwords.map(entry => ({
    service: normalizeDomain(entry.service),
    username: entry.username || '',
    password: entry.credential
  }));
  AutofillBridge.syncCredentials({ credentialsJson: JSON.stringify(credentials) }).catch(() => {});
}

export function clearAutofillCredentials() {
  if (typeof window === 'undefined' || (window as any).Capacitor?.getPlatform?.() !== 'android') return;
  AutofillBridge.clearCredentials().catch(() => {});
}

const DEFAULT_OFFLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getOfflineSecurityDeadline(): number {
  if (typeof localStorage === 'undefined') return Date.now() + DEFAULT_OFFLINE_WINDOW_MS;
  const stored = localStorage.getItem('nexvault_offline_deadline');
  if (stored) {
    const time = new Date(stored).getTime();
    if (!isNaN(time)) return time;
  }
  const defaultDeadline = Date.now() + DEFAULT_OFFLINE_WINDOW_MS;
  localStorage.setItem('nexvault_offline_deadline', new Date(defaultDeadline).toISOString());
  return defaultDeadline;
}

export function touchOfflineHeartbeat() {
  if (typeof localStorage === 'undefined') return;
  const stored = localStorage.getItem('nexvault_offline_deadline');
  if (!stored) {
    const newDeadline = Date.now() + DEFAULT_OFFLINE_WINDOW_MS;
    localStorage.setItem('nexvault_offline_deadline', new Date(newDeadline).toISOString());
  }
}

export function getSecurityWindowStatus() {
  const deadline = getOfflineSecurityDeadline();
  const now = Date.now();
  const remainingSeconds = Math.max(0, Math.floor((deadline - now) / 1000));
  return {
    isWithinWindow: remainingSeconds > 0,
    deadline: new Date(deadline).toISOString(),
    remainingSeconds,
    isExpired: remainingSeconds <= 0
  };
}

export function extendOfflineSecurityWindow(duration: string): { success: boolean; duration: string; expiresAt: string } {
  const durations: Record<string, number> = {
    '1week': 7 * 24 * 60 * 60 * 1000,
    '1month': 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000
  };
  const ms = durations[duration] || durations['1week'];
  const newDeadline = Date.now() + ms;
  const expiresAt = new Date(newDeadline).toISOString();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('nexvault_offline_deadline', expiresAt);
  }
  return { success: true, duration, expiresAt };
}

export function requestPeerSecurityExtension(duration: string): { success: boolean; pendingApproval: boolean; requestId: string; duration: string; expiresAt: string; peersCount: number } {
  const durations: Record<string, number> = {
    '1week': 7 * 24 * 60 * 60 * 1000,
    '1month': 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000
  };
  const ms = durations[duration] || durations['1week'];
  const newDeadline = Date.now() + ms;
  const expiresAt = new Date(newDeadline).toISOString();
  const state = loadVault();

  const requestId = 'ext-req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const payload = {
    type: 'extension-approval-request',
    requestId,
    fromDeviceId: state?.devicePublicKey || 'mobile-node',
    fromDeviceName: 'NexVault Mobile (Android)',
    duration,
    newDeadline: expiresAt,
    requestedAt: new Date().toISOString()
  };

  let sentCount = 0;
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN && state) {
    const peers = getKnownPeerIds(state);
    for (const peerId of peers) {
      try {
        sendPeerMessage(peerId, payload, state, activeSocket);
        sentCount++;
      } catch {}
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('nexvault_pending_extension_request', JSON.stringify({
      requestId,
      duration,
      expiresAt,
      requestedAt: new Date().toISOString()
    }));
  }

  return {
    success: true,
    pendingApproval: true,
    requestId,
    duration,
    expiresAt,
    peersCount: sentCount
  };
}

export function respondToPeerSecurityExtension(peerId: string, requestId: string, duration: string, approved: boolean, reason?: string) {
  const state = loadVault();
  if (!state || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
    return { success: false, error: 'Mesh relay socket is not active' };
  }

  const durations: Record<string, number> = {
    '1week': 7 * 24 * 60 * 60 * 1000,
    '1month': 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000
  };
  const ms = durations[duration] || durations['1week'];
  const newDeadline = new Date(Date.now() + ms).toISOString();

  const responsePayload = {
    type: 'extension-approval-response',
    requestId,
    approved: Boolean(approved),
    reason: reason || (approved ? '' : 'Declined by mobile user'),
    approverDeviceId: state.devicePublicKey,
    approverDeviceName: 'NexVault Mobile',
    approverPublicKey: state.x25519PublicKey,
    duration,
    newDeadline,
    timestamp: new Date().toISOString()
  };

  sendPeerMessage(peerId, responsePayload, state, activeSocket);
  return { success: true };
}

export function emergencyNukeVault() {
  try {
    clearAutofillCredentials();
  } catch {}
  lockVault();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem('nexvault_mobile_vault');
    localStorage.removeItem('nexvault_mobile_token');
    localStorage.removeItem('nexvault_relay_url');
    localStorage.removeItem('nexvault_offline_deadline');
    localStorage.removeItem('nexvault_autolock_minutes');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
  return { success: true };
}

export async function mergeNativeAutofillCredentials() {
  if (typeof window === 'undefined' || (window as any).Capacitor?.getPlatform?.() !== 'android') return;
  const result = await AutofillBridge.readCredentials();
  const nativeCredentials = JSON.parse(result.credentialsJson || '[]');
  const state = loadVault();
  if (!state || !Array.isArray(nativeCredentials)) return;

  let changed = false;
  for (const nativeCredential of nativeCredentials) {
    const service = String(nativeCredential.service || '').trim();
    const password = String(nativeCredential.password || '');
    if (!service || !password) continue;
    const target = normalizeDomain(service);
    const existing = state.passwords.find(entry => normalizeDomain(entry.service) === target);
    if (existing && existing.credential === password && (existing.username || '') === (nativeCredential.username || '')) continue;
    if (existing) {
      existing.credential = password;
      existing.username = nativeCredential.username || '';
      existing.updatedAt = Date.now();
    } else {
      state.passwords.push({
        service,
        credential: password,
        username: nativeCredential.username || '',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now()
      });
    }
    changed = true;
  }
  if (changed) saveVault(state);
}

export async function openAutofillSettings() {
  return AutofillBridge.openSettings();
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

function handleExtensionResponse(payload: any, callbacks?: GridCallbacks) {
  if (payload.approved) {
    const expiresAt = payload.newDeadline || payload.expiresAt;
    const duration = payload.duration || '1month';
    const approverName = payload.approverDeviceName || payload.deviceName || 'Mesh Peer';
    if (expiresAt && typeof localStorage !== 'undefined') {
      localStorage.setItem('nexvault_offline_deadline', expiresAt);
      localStorage.setItem('nexvault_extension_info', JSON.stringify({
        duration,
        expiresAt,
        approverName,
        approvedAt: new Date().toISOString()
      }));
      localStorage.removeItem('nexvault_pending_extension_request');
    }
    callbacks?.onLog?.(`🎉 Security window extended (${duration}) by ${approverName}!`);
    callbacks?.onExtensionApproved?.({ duration, expiresAt, approverName });
  } else {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('nexvault_pending_extension_request');
    }
    callbacks?.onLog?.(`❌ Security window extension was declined: ${payload.reason || 'Declined'}`);
    callbacks?.onExtensionRejected?.({ reason: payload.reason || 'Declined by peer' });
  }
}

function handleIncomingMobileSignal(from: string, payload: any, socketOrState: any, socketOrCallbacks?: any, maybeCallbacks?: any) {
  if (!payload || typeof payload !== 'object') return;

  const state = loadVault();
  if (!state) return;

  let socket: WebSocket | null = null;
  let callbacks: GridCallbacks | undefined;

  if (socketOrState && typeof socketOrState.send === 'function') {
    socket = socketOrState;
    callbacks = socketOrCallbacks;
  } else {
    socket = socketOrCallbacks;
    callbacks = maybeCallbacks;
  }

  // 1. Direct encrypted tunnel message
  if (payload.type === 'encrypted') {
    try {
      const mySecretKey = naclUtil.decodeBase64(state.x25519SecretKey);
      const decryptedStr = decryptBox(payload.payload, mySecretKey);
      const decrypted = JSON.parse(decryptedStr);
      if (decrypted.type === 'vault-sync') {
        applyVaultSync(decrypted.vaultData, callbacks, from, socket || undefined);
      } else if (decrypted.type === 'credential-deleted') {
        handleCredentialDeleted(decrypted);
      } else if (decrypted.type === 'extension-approval-request') {
        const req: PeerExtensionRequest = {
          requestId: decrypted.requestId,
          from,
          deviceName: decrypted.fromDeviceName || decrypted.deviceName || 'Mesh Peer',
          duration: decrypted.duration || '1month',
          newDeadline: decrypted.newDeadline || '',
          requestedAt: decrypted.requestedAt || new Date().toISOString()
        };
        callbacks?.onLog?.(`🔔 Extension request received from "${req.deviceName}" (${req.duration})`);
        callbacks?.onIncomingExtensionRequest?.(req);
      } else if (decrypted.type === 'extension-approval-response' || decrypted.type === 'extension-approval') {
        handleExtensionResponse(decrypted, callbacks);
      }
      return;
    } catch (err: any) {
      console.error('[MobileGrid] Error decrypting signal:', err);
      return;
    }
  }

  // 1b. Plain credential-deleted message
  if (payload.type === 'credential-deleted') {
    handleCredentialDeleted(payload);
    return;
  }

  // 1c. Plain extension requests & responses
  if (payload.type === 'extension-approval-request') {
    const req: PeerExtensionRequest = {
      requestId: payload.requestId,
      from,
      deviceName: payload.fromDeviceName || payload.deviceName || 'Mesh Peer',
      duration: payload.duration || '1month',
      newDeadline: payload.newDeadline || '',
      requestedAt: payload.requestedAt || new Date().toISOString()
    };
    callbacks?.onLog?.(`🔔 Extension request received from "${req.deviceName}" (${req.duration})`);
    callbacks?.onIncomingExtensionRequest?.(req);
    return;
  }

  if (payload.type === 'extension-approval-response' || payload.type === 'extension-approval') {
    handleExtensionResponse(payload, callbacks);
    return;
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

    // Send our vault entries to the peer so both nodes are fully synced
    callbacks?.onLog?.('Synchronizing initial vault with mesh peer...');
    if (socket) {
      broadcastVaultToPeer(from, socket, false);
    }
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
        addTrustedPeer({
          deviceId: from,
          publicKey: payload.publicKey,
          deviceName: payload.fromDeviceName || from
        }, state);
        if (socket) {
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
          broadcastVaultToPeer(from, socket, false);
        }
        callbacks?.onStatusChange?.('paired');
        callbacks?.onPairApproved?.({ deviceId: from, deviceName: payload.fromDeviceName || from, publicKey: payload.publicKey });
        return;
      }
    }

    // B. Check if peer is already trusted
    if (isPeerTrusted(from, state)) {
      callbacks?.onLog?.(`Mesh peer "${payload.fromDeviceName || from}" is already trusted. Auto-accepting.`);
      if (socket) {
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
        broadcastVaultToPeer(from, socket, false);
      }
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
    applyVaultSync(payload.vaultData, callbacks, from, socket || undefined);
    return;
  }

  // 6. Peer requested vault sync from us
  if (payload.type === 'vault-sync-request' && socket) {
    broadcastVaultToPeer(from, socket, false);
  }
}

const vaultUpdatedListeners: (() => void)[] = [];
function notifyVaultUpdated() {
  vaultUpdatedListeners.forEach(fn => {
    try { fn(); } catch (err) { console.error('[MobileGrid] Error in onVaultUpdated listener:', err); }
  });
}

function handleCredentialDeleted(data: { itemType: 'password' | 'otp'; service: string; deletedAt?: number; timestamp?: number }) {
  if (!data || !data.service) return;
  const state = loadVault();
  if (!state) return;

  const target = normalizeDomain(data.service);
  const deletedAt = Number(data.deletedAt) || Number(data.timestamp) || Date.now();
  if (!state.deletedRecords) state.deletedRecords = [];

  let stateChanged = false;

  if (data.itemType === 'otp') {
    const localIdx = state.otps.findIndex(o => normalizeDomain(o.service) === target);
    if (localIdx >= 0) {
      const localUpdatedAt = Number(state.otps[localIdx].updatedAt) || (state.otps[localIdx].createdAt ? new Date(state.otps[localIdx].createdAt).getTime() : 0);
      if (deletedAt >= localUpdatedAt) {
        state.otps.splice(localIdx, 1);
        stateChanged = true;
      }
    }
  } else {
    const localIdx = state.passwords.findIndex(p => normalizeDomain(p.service) === target);
    if (localIdx >= 0) {
      const localUpdatedAt = Number(state.passwords[localIdx].updatedAt) || (state.passwords[localIdx].createdAt ? new Date(state.passwords[localIdx].createdAt).getTime() : 0);
      if (deletedAt >= localUpdatedAt) {
        state.passwords.splice(localIdx, 1);
        stateChanged = true;
      }
    }
  }

  const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === data.itemType);
  if (existingTombIdx >= 0) {
    if (deletedAt > state.deletedRecords[existingTombIdx].deletedAt) {
      state.deletedRecords[existingTombIdx].deletedAt = deletedAt;
    }
  } else {
    state.deletedRecords.push({ service: data.service, type: data.itemType, deletedAt });
  }

  saveVault(state);
  console.log(`[MobileGrid] Processed remote deletion of ${data.itemType}: "${data.service}" (deletedAt=${deletedAt})`);
  if (stateChanged) {
    notifyVaultUpdated();
  }
}

function applyVaultSync(vaultData: any, callbacks?: GridCallbacks, fromPeerId?: string, socket?: WebSocket) {
  if (!vaultData) return;
  const state = loadVault();
  if (!state) return;
  if (!state.deletedRecords) state.deletedRecords = [];

  let stateChanged = false;
  let importedPasswords = 0;
  let importedOTPs = 0;

  // 1. Process any incoming tombstones / deletions with timestamp
  if (Array.isArray(vaultData.deleted)) {
    for (const d of vaultData.deleted) {
      if (!d || !d.service) continue;
      const target = normalizeDomain(d.service);
      const remoteDeletedAt = Number(d.deletedAt) || Number(d.deleted_at) || Date.now();

      if (d.type === 'otp') {
        const localIdx = state.otps.findIndex(o => normalizeDomain(o.service) === target);
        if (localIdx >= 0) {
          const localUpdatedAt = Number(state.otps[localIdx].updatedAt) || (state.otps[localIdx].createdAt ? new Date(state.otps[localIdx].createdAt).getTime() : 0);
          if (remoteDeletedAt >= localUpdatedAt) {
            state.otps.splice(localIdx, 1);
            stateChanged = true;
          }
        }
      } else {
        const localIdx = state.passwords.findIndex(p => normalizeDomain(p.service) === target);
        if (localIdx >= 0) {
          const localUpdatedAt = Number(state.passwords[localIdx].updatedAt) || (state.passwords[localIdx].createdAt ? new Date(state.passwords[localIdx].createdAt).getTime() : 0);
          if (remoteDeletedAt >= localUpdatedAt) {
            state.passwords.splice(localIdx, 1);
            stateChanged = true;
          }
        }
      }

      const existingTombIdx = state.deletedRecords.findIndex(r => normalizeDomain(r.service) === target && r.type === d.type);
      if (existingTombIdx >= 0) {
        if (remoteDeletedAt > state.deletedRecords[existingTombIdx].deletedAt) {
          state.deletedRecords[existingTombIdx].deletedAt = remoteDeletedAt;
        }
      } else {
        state.deletedRecords.push({ service: d.service, type: d.type, deletedAt: remoteDeletedAt });
      }
    }
  }

  // 2. Reconcile passwords with LWW
  if (Array.isArray(vaultData.passwords)) {
    for (const p of vaultData.passwords) {
      if (!p.service || !p.credential) continue;
      const target = normalizeDomain(p.service);
      const remoteUpdatedAt = Number(p.updatedAt) || (p.createdAt ? new Date(p.createdAt).getTime() : Date.now());

      const tomb = state.deletedRecords.find(r => normalizeDomain(r.service) === target && r.type === 'password');
      if (tomb && Number(tomb.deletedAt) >= remoteUpdatedAt) {
        continue; // Tombstone is newer than incoming password
      }

      if (tomb && remoteUpdatedAt > tomb.deletedAt) {
        state.deletedRecords = state.deletedRecords.filter(r => !(normalizeDomain(r.service) === target && r.type === 'password'));
      }

      const existingIdx = state.passwords.findIndex(x => normalizeDomain(x.service) === target);
      if (existingIdx >= 0) {
        const localUpdatedAt = Number(state.passwords[existingIdx].updatedAt) || (state.passwords[existingIdx].createdAt ? new Date(state.passwords[existingIdx].createdAt).getTime() : 0);
        if (remoteUpdatedAt > localUpdatedAt) {
          state.passwords[existingIdx] = {
            service: p.service,
            credential: p.credential,
            username: p.username || '',
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: remoteUpdatedAt
          };
          stateChanged = true;
          importedPasswords++;
        }
      } else {
        state.passwords.push({
          service: p.service,
          credential: p.credential,
          username: p.username || '',
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: remoteUpdatedAt
        });
        stateChanged = true;
        importedPasswords++;
      }
    }
  }

  // 3. Reconcile OTPs with LWW
  if (Array.isArray(vaultData.otps)) {
    for (const o of vaultData.otps) {
      if (!o.service || !o.secret) continue;
      const target = normalizeDomain(o.service);
      const remoteUpdatedAt = Number(o.updatedAt) || (o.createdAt ? new Date(o.createdAt).getTime() : Date.now());

      const tomb = state.deletedRecords.find(r => normalizeDomain(r.service) === target && r.type === 'otp');
      if (tomb && Number(tomb.deletedAt) >= remoteUpdatedAt) {
        continue;
      }

      if (tomb && remoteUpdatedAt > tomb.deletedAt) {
        state.deletedRecords = state.deletedRecords.filter(r => !(normalizeDomain(r.service) === target && r.type === 'otp'));
      }

      const existingIdx = state.otps.findIndex(x => normalizeDomain(x.service) === target);
      if (existingIdx >= 0) {
        const localUpdatedAt = Number(state.otps[existingIdx].updatedAt) || (state.otps[existingIdx].createdAt ? new Date(state.otps[existingIdx].createdAt).getTime() : 0);
        if (remoteUpdatedAt > localUpdatedAt) {
          state.otps[existingIdx] = {
            service: o.service,
            secret: o.secret,
            createdAt: o.createdAt || new Date().toISOString(),
            updatedAt: remoteUpdatedAt
          };
          stateChanged = true;
          importedOTPs++;
        }
      } else {
        state.otps.push({
          service: o.service,
          secret: o.secret,
          createdAt: o.createdAt || new Date().toISOString(),
          updatedAt: remoteUpdatedAt
        });
        stateChanged = true;
        importedOTPs++;
      }
    }
  }

  saveVault(state);
  const cb = callbacks || currentCallbacks;
  if (stateChanged) {
    cb?.onLog?.(`🔄 Vault synchronized from peer: ${importedPasswords} passwords, ${importedOTPs} OTPs updated.`);
    cb?.onVaultSynced?.(importedPasswords + importedOTPs);
    notifyVaultUpdated();
  }

  // If this sync wasn't already a reply and from a specific peer, reply back with our reconciled state
  if (fromPeerId && fromPeerId !== '*' && socket && !vaultData.isReply) {
    broadcastVaultToPeer(fromPeerId, socket, true);
  }
}

function getActiveAndTrustedPeers(state: MobileVaultState): string[] {
  const ids = new Set<string>();
  if (state.trustedPeers) {
    for (const p of state.trustedPeers) {
      const pid = typeof p === 'string' ? p : p.deviceId;
      if (pid) ids.add(pid);
    }
  }
  for (const pid of remotePeerKeys.keys()) {
    if (pid && pid !== state.devicePublicKey) ids.add(pid);
  }
  return Array.from(ids);
}

function sendPeerMessage(peerId: string, payload: any, state: MobileVaultState, socket: WebSocket) {
  if (peerId === '*') {
    try {
      socket.send(JSON.stringify({
        type: 'signal',
        to: '*',
        payload
      }));
    } catch {}
    return;
  }

  // If recipient public key is registered, send encrypted tunnel envelope ONLY.
  // Otherwise send plaintext relay signal ONLY. No duplicate signals!
  const remotePubKey = remotePeerKeys.get(peerId);
  if (remotePubKey) {
    try {
      const encrypted = encryptBox(JSON.stringify(payload), remotePubKey);
      socket.send(JSON.stringify({
        type: 'signal',
        to: peerId,
        payload: { type: 'encrypted', payload: encrypted }
      }));
      return;
    } catch (err) {
      console.warn('[MobileGrid] Failed to encrypt message for peer, falling back to plaintext:', err);
    }
  }

  try {
    socket.send(JSON.stringify({
      type: 'signal',
      to: peerId,
      payload
    }));
  } catch {}
}

function broadcastVaultToPeer(peerId: string, arg2: any, arg3?: any, arg4?: any) {
  let socket: WebSocket | null = null;
  let isReply = false;
  let state: MobileVaultState | null = null;

  if (arg2 && typeof (arg2 as any).send === 'function') {
    // Called as: (peerId, socket, isReply)
    socket = arg2;
    isReply = Boolean(arg3);
    state = loadVault();
  } else {
    // Called as: (peerId, state, socket, isReply)
    state = loadVault() || arg2;
    socket = arg3;
    isReply = Boolean(arg4);
  }

  if (!state || !socket || socket.readyState !== WebSocket.OPEN) return;

  const payloadData = {
    type: 'vault-sync',
    vaultData: {
      passwords: (state.passwords || []).map(p => ({
        ...p,
        updatedAt: Number(p.updatedAt) || (p.createdAt ? new Date(p.createdAt).getTime() : Date.now())
      })),
      otps: (state.otps || []).map(o => ({
        ...o,
        updatedAt: Number(o.updatedAt) || (o.createdAt ? new Date(o.createdAt).getTime() : Date.now())
      })),
      deleted: state.deletedRecords || [],
      timestamp: Date.now(),
      isReply
    }
  };

  sendPeerMessage(peerId, payloadData, state, socket);
}

export function initMobileVault() {
  if (typeof window === 'undefined') return;
  if ((window as any).nexVault && (window as any).nexVault.__isMobileReady) return;

  (window as any).nexVault = {
    __isMobileReady: true,

    async getVaultProfile() {
      const prof = getStoredProfile();
      if (!prof) return { hasUser: false };
      return {
        hasUser: true,
        username: prof.username,
        tokenId: prof.tokenId,
        bootstrapToken: {
          tokenId: prof.tokenId,
          publicKey: prof.publicKey,
          signature: prof.signature,
          expiresAt: prof.expiresAt
        }
      };
    },

    isUnlocked() {
      return isVaultUnlocked();
    },

    lock() {
      lockVault();
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

      const state: MobileVaultState = {
        username,
        derivedKeyHash: '',
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

      lockVault();
      isManuallyStopped = false;
      await startSession(password, state);
      syncAutofillCredentials(state);

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

      lockVault();
      isManuallyStopped = false;
      const env = readEnvelope();
      const legacy = env ? null : readLegacyVault();

      if (env) {
        await unlockEnvelope(password, env);
        // Re-save so the envelope picks up any newer fields.
        persistEncrypted(cachedState as MobileVaultState);
      } else if (legacy) {
        // One-time migration of the old plaintext vault into the encrypted envelope.
        const check = await legacyDeriveKey(password, legacy.publicKey);
        if (legacy.derivedKeyHash !== check) throw new Error('Invalid master password');
        legacy.derivedKeyHash = '';
        await startSession(password, legacy);
      } else {
        const deviceEdKeys = nacl.sign.keyPair();
        const deviceXKeys = nacl.box.keyPair();
        const devicePublicKey = 'mobile-' + naclUtil.encodeBase64(deviceEdKeys.publicKey).slice(0, 16).replace(/[/+=]/g, '');

        await startSession(password, {
          username: `mobile-${tokenId.slice(-6)}`,
          derivedKeyHash: '',
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
        });
      }

      return { success: true, tokenId };
    },

    async startNexGrid(arg1?: any, arg2?: any) {
      let callbacks: GridCallbacks | undefined;
      let options: { relayUrl?: string } | undefined;
      if (arg1 && (typeof arg1.onLog === 'function' || typeof arg1.onStatusChange === 'function' || typeof arg1.onVaultSynced === 'function')) {
        callbacks = arg1;
        options = arg2;
      } else {
        options = arg1;
        callbacks = arg2;
      }
      currentCallbacks = callbacks || null;
      isManuallyStopped = false;
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

            const current = loadVault() || state;
            socket.send(JSON.stringify({
              type: 'device-auth',
              token: {
                tokenId: current.tokenId,
                publicKey: current.publicKey,
                signature: current.signature,
                expiresAt: current.expiresAt
              },
              deviceId: current.devicePublicKey,
              publicKey: current.x25519PublicKey,
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

                  const freshState = loadVault();
                  if (!freshState) continue;

                  if (isPeerTrusted(peer.deviceId, freshState)) {
                    callbacks?.onLog?.(`✨ Reconnected with paired device: "${peer.deviceName || peer.deviceId}". Syncing...`);
                    callbacks?.onStatusChange?.('paired');
                    callbacks?.onPairApproved?.({ deviceId: peer.deviceId, deviceName: peer.deviceName || peer.deviceId });
                    broadcastVaultToPeer(peer.deviceId, socket, false);
                  } else {
                    callbacks?.onLog?.(`Initiating automatic pairing with ${peer.deviceName || peer.deviceId}...`);
                    socket.send(JSON.stringify({
                      type: 'signal',
                      to: peer.deviceId,
                      payload: {
                        type: 'pair-request',
                        fromDeviceId: freshState.devicePublicKey,
                        fromDeviceName: 'NextVault Mobile Mesh Node',
                        publicKey: freshState.x25519PublicKey,
                        timestamp: Date.now()
                      }
                    }));
                    callbacks?.onLog?.(`Pair request sent to ${peer.deviceName || peer.deviceId}. Awaiting approval...`);
                  }
                }
              } else if (message.type === 'peer-joined') {
                const peer = message.peer || { deviceId: message.deviceId, deviceName: message.deviceName, publicKey: message.publicKey };
                if (peer.publicKey) remotePeerKeys.set(peer.deviceId, peer.publicKey);
                callbacks?.onPeerDiscovered?.(peer);

                const freshState = loadVault();
                if (!freshState) return;

                if (isPeerTrusted(peer.deviceId, freshState)) {
                  callbacks?.onLog?.(`✨ Paired peer rejoined: "${peer.deviceName || peer.deviceId}". Syncing...`);
                  callbacks?.onStatusChange?.('paired');
                  callbacks?.onPairApproved?.({ deviceId: peer.deviceId, deviceName: peer.deviceName || peer.deviceId });
                  broadcastVaultToPeer(peer.deviceId, socket, false);
                } else {
                  callbacks?.onLog?.(`📡 New peer joined network: ${peer.deviceName || peer.deviceId}`);
                  callbacks?.onLog?.(`Sending pairing request to ${peer.deviceName || peer.deviceId}...`);
                  socket.send(JSON.stringify({
                    type: 'signal',
                    to: peer.deviceId,
                    payload: {
                      type: 'pair-request',
                      fromDeviceId: freshState.devicePublicKey,
                      fromDeviceName: 'NextVault Mobile Mesh Node',
                      publicKey: freshState.x25519PublicKey,
                      timestamp: Date.now()
                    }
                  }));
                }
              } else if (message.type === 'signal') {
                handleIncomingMobileSignal(message.from, message.payload, socket, callbacks);
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
            if (!isManuallyStopped) {
              setTimeout(() => {
                if (!activeSocket && !isManuallyStopped) {
                  callbacks?.onLog?.('Attempting auto-reconnect to relay...');
                  (window as any).nexVault?.startNexGrid(options, callbacks).catch(() => {});
                }
              }, 3000);
            }
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
      isManuallyStopped = true;
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
      addTrustedPeer({
        deviceId: peerId,
        publicKey: req?.publicKey,
        deviceName: req?.deviceName || 'Mesh Peer'
      }, state);

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
      broadcastVaultToPeer(peerId, activeSocket, false);
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

      const cleanService = service.trim();
      const target = normalizeDomain(cleanService);
      const now = Date.now();
      const existingIdx = state.passwords.findIndex(p => normalizeDomain(p.service) === target);
      const entry: StoredCredential = {
        service: cleanService,
        credential,
        username: username.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: now
      };

      if (existingIdx >= 0) {
        state.passwords[existingIdx] = entry;
      } else {
        state.passwords.push(entry);
      }

      // Remove from tombstones if previously deleted
      if (state.deletedRecords) {
        state.deletedRecords = state.deletedRecords.filter(d => !(normalizeDomain(d.service) === target && d.type === 'password' && d.deletedAt <= now));
      }

      saveVault(state);
      notifyVaultUpdated();

      // Broadcast update to all active/trusted peers and room if connected
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
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
      const target = normalizeDomain(service);
      const entry = state.passwords.find(p => normalizeDomain(p.service) === target);
      if (!entry) return { success: false, error: 'Not found' };
      return { success: true, password: entry.credential, username: entry.username || '' };
    },

    async deletePassword(service: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      const target = normalizeDomain(service);
      const now = Date.now();
      state.passwords = state.passwords.filter(p => normalizeDomain(p.service) !== target);
      if (!state.deletedRecords) state.deletedRecords = [];
      const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'password');
      if (existingTombIdx >= 0) {
        state.deletedRecords[existingTombIdx].deletedAt = now;
      } else {
        state.deletedRecords.push({ service: service.trim(), type: 'password', deletedAt: now });
      }
      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        console.log(`[Mobile] Broadcasting password deletion of "${service}" to ${peers.length} peer(s):`, peers);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
          sendPeerMessage(peerId, {
            type: 'credential-deleted',
            itemType: 'password',
            service: service.trim(),
            deletedAt: now,
            timestamp: now
          }, state, activeSocket);
        }
        broadcastVaultToPeer('*', activeSocket, false);
        sendPeerMessage('*', {
          type: 'credential-deleted',
          itemType: 'password',
          service: service.trim(),
          deletedAt: now,
          timestamp: now
        }, state, activeSocket);
      }
      return { success: true };
    },

    async deleteAllPasswords() {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      const count = state.passwords.length;
      if (count === 0) return { success: true, count: 0 };
      const now = Date.now();
      if (!state.deletedRecords) state.deletedRecords = [];

      for (const p of state.passwords) {
        const target = normalizeDomain(p.service);
        const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'password');
        if (existingTombIdx >= 0) {
          state.deletedRecords[existingTombIdx].deletedAt = now;
        } else {
          state.deletedRecords.push({ service: p.service.trim(), type: 'password', deletedAt: now });
        }
      }
      state.passwords = [];
      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
      }
      return { success: true, count };
    },

    async addOTP(service: string, secret: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');

      const cleanService = service.trim();
      const target = normalizeDomain(cleanService);
      const now = Date.now();
      const existingIdx = state.otps.findIndex(o => normalizeDomain(o.service) === target);
      const entry: StoredOTP = {
        service: cleanService,
        secret,
        createdAt: new Date().toISOString(),
        updatedAt: now
      };

      if (existingIdx >= 0) {
        state.otps[existingIdx] = entry;
      } else {
        state.otps.push(entry);
      }

      // Remove from tombstones if previously deleted
      if (state.deletedRecords) {
        state.deletedRecords = state.deletedRecords.filter(d => !(normalizeDomain(d.service) === target && d.type === 'otp' && d.deletedAt <= now));
      }

      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
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
      const target = normalizeDomain(service);
      const entry = state.otps.find(o => normalizeDomain(o.service) === target);
      if (!entry) return { success: false, error: 'Not found' };
      const code = await calculateTotpCode(entry.secret);
      return { success: true, code };
    },

    async getOTPDetails(service: string) {
      const state = loadVault();
      if (!state) return { success: false, error: 'Vault is locked' };
      const target = normalizeDomain(service);
      const entry = state.otps.find(o => normalizeDomain(o.service) === target);
      if (!entry) return { success: false, error: 'Not found' };
      return { success: true, service: entry.service, secret: entry.secret };
    },

    async deleteOTP(service: string) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      const target = normalizeDomain(service);
      const now = Date.now();
      state.otps = state.otps.filter(o => normalizeDomain(o.service) !== target);
      if (!state.deletedRecords) state.deletedRecords = [];
      const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'otp');
      if (existingTombIdx >= 0) {
        state.deletedRecords[existingTombIdx].deletedAt = now;
      } else {
        state.deletedRecords.push({ service: service.trim(), type: 'otp', deletedAt: now });
      }
      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        console.log(`[Mobile] Broadcasting OTP deletion of "${service}" to ${peers.length} peer(s):`, peers);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
          sendPeerMessage(peerId, {
            type: 'credential-deleted',
            itemType: 'otp',
            service: service.trim(),
            deletedAt: now,
            timestamp: now
          }, state, activeSocket);
        }
        broadcastVaultToPeer('*', activeSocket, false);
        sendPeerMessage('*', {
          type: 'credential-deleted',
          itemType: 'otp',
          service: service.trim(),
          deletedAt: now,
          timestamp: now
        }, state, activeSocket);
      }
      return { success: true };
    },

    async deleteAllOTPs() {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      const count = state.otps.length;
      if (count === 0) return { success: true, count: 0 };
      const now = Date.now();
      if (!state.deletedRecords) state.deletedRecords = [];

      for (const o of state.otps) {
        const target = normalizeDomain(o.service);
        const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'otp');
        if (existingTombIdx >= 0) {
          state.deletedRecords[existingTombIdx].deletedAt = now;
        } else {
          state.deletedRecords.push({ service: o.service.trim(), type: 'otp', deletedAt: now });
        }
      }
      state.otps = [];
      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
      }
      return { success: true, count };
    },

    async deleteAllVault() {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked');
      const pwCount = state.passwords.length;
      const otpCount = state.otps.length;
      const now = Date.now();
      if (!state.deletedRecords) state.deletedRecords = [];

      for (const p of state.passwords) {
        const target = normalizeDomain(p.service);
        const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'password');
        if (existingTombIdx >= 0) {
          state.deletedRecords[existingTombIdx].deletedAt = now;
        } else {
          state.deletedRecords.push({ service: p.service.trim(), type: 'password', deletedAt: now });
        }
      }
      for (const o of state.otps) {
        const target = normalizeDomain(o.service);
        const existingTombIdx = state.deletedRecords.findIndex(d => normalizeDomain(d.service) === target && d.type === 'otp');
        if (existingTombIdx >= 0) {
          state.deletedRecords[existingTombIdx].deletedAt = now;
        } else {
          state.deletedRecords.push({ service: o.service.trim(), type: 'otp', deletedAt: now });
        }
      }
      state.passwords = [];
      state.otps = [];
      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
      }
      return { success: true, passwordsCount: pwCount, otpsCount: otpCount, totalCount: pwCount + otpCount };
    },

    async bulkImportPasswords(items: { service: string; credential: string; username?: string }[]) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');
      if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

      let imported = 0;
      const now = Date.now();
      for (const item of items) {
        if (!item.service || !item.credential) continue;
        const cleanService = item.service.trim();
        const target = normalizeDomain(cleanService);
        const existingIdx = state.passwords.findIndex(p => normalizeDomain(p.service) === target);
        const entry: StoredCredential = {
          service: cleanService,
          credential: item.credential,
          username: (item.username || '').trim(),
          createdAt: new Date().toISOString(),
          updatedAt: now
        };
        if (existingIdx >= 0) {
          state.passwords[existingIdx] = entry;
        } else {
          state.passwords.push(entry);
        }
        if (state.deletedRecords) {
          state.deletedRecords = state.deletedRecords.filter(d => !(normalizeDomain(d.service) === target && d.type === 'password' && d.deletedAt <= now));
        }
        imported++;
      }

      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
      }

      return { success: true, count: imported };
    },

    async bulkImportOTPs(items: { service: string; secret: string }[]) {
      const state = loadVault();
      if (!state) throw new Error('Vault is locked or uninitialized');
      if (!Array.isArray(items) || items.length === 0) return { success: true, count: 0 };

      let imported = 0;
      const now = Date.now();
      for (const item of items) {
        if (!item.service || !item.secret) continue;
        const cleanService = item.service.trim();
        const cleanSecret = item.secret.replace(/\s+/g, '').toUpperCase();
        const target = normalizeDomain(cleanService);
        const existingIdx = state.otps.findIndex(o => normalizeDomain(o.service) === target);
        const entry: StoredOTP = {
          service: cleanService,
          secret: cleanSecret,
          createdAt: new Date().toISOString(),
          updatedAt: now
        };
        if (existingIdx >= 0) {
          state.otps[existingIdx] = entry;
        } else {
          state.otps.push(entry);
        }
        if (state.deletedRecords) {
          state.deletedRecords = state.deletedRecords.filter(d => !(normalizeDomain(d.service) === target && d.type === 'otp' && d.deletedAt <= now));
        }
        imported++;
      }

      saveVault(state);
      notifyVaultUpdated();

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const peers = getActiveAndTrustedPeers(state);
        for (const peerId of peers) {
          broadcastVaultToPeer(peerId, activeSocket, false);
        }
        broadcastVaultToPeer('*', activeSocket, false);
      }

      return { success: true, count: imported };
    },

    async syncWithPeers() {
      const state = loadVault();
      if (!state) return { success: false, error: 'Vault is locked' };
      let sentCount = 0;
      const peers = getActiveAndTrustedPeers(state);
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN && peers.length > 0) {
        for (const peerId of peers) {
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
    },

    async triggerEmergencyNuke() {
      return emergencyNukeVault();
    },

    async getSecurityStatus() {
      return getSecurityWindowStatus();
    },

    async extendSecurityWindow(duration: string) {
      return extendOfflineSecurityWindow(duration);
    },

    async requestPeerSecurityExtension(duration: string) {
      return requestPeerSecurityExtension(duration);
    },

    async respondToPeerSecurityExtension(peerId: string, requestId: string, duration: string, approved: boolean, reason?: string) {
      return respondToPeerSecurityExtension(peerId, requestId, duration, approved, reason);
    },

    getAutoLockMinutes(): number | 'never' {
      if (typeof localStorage === 'undefined') return 5;
      const v = localStorage.getItem('nexvault_autolock_minutes');
      if (v === 'never') return 'never';
      const num = Number(v);
      return isNaN(num) || num <= 0 ? 5 : num;
    },

    setAutoLockMinutes(minutes: number | 'never') {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('nexvault_autolock_minutes', String(minutes));
    }
  };
}

initMobileVault();
