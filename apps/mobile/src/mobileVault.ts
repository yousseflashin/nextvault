/**
 * mobileVault.ts - Standalone mobile & browser vault adapter for NexVault Mobile.
 * Provides the window.nexVault API using Web Crypto API and persistent local storage.
 */

interface StoredCredential {
  service: string;
  credential: string;
  username?: string;
  createdAt: string;
}

interface StoredOTP {
  service: string;
  secret: string;
  createdAt: string;
}

interface MobileVaultState {
  username: string;
  derivedKeyHash: string;
  tokenId: string;
  publicKey: string;
  signature: string;
  expiresAt: string;
  passwords: StoredCredential[];
  otps: StoredOTP[];
}

const STORAGE_KEY = 'nexvault_mobile_vault_v1';

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

function loadVault(): MobileVaultState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveVault(state: MobileVaultState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function initMobileVault() {
  if (typeof window === 'undefined') return;
  if ((window as any).nexVault) return; // Electron already injected preload

  (window as any).nexVault = {
    async initializeNewUser(username: string, password: string) {
      const tokenId = 'nexvault-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
      const rawPub = new Uint8Array(32);
      crypto.getRandomValues(rawPub);
      const publicKey = btoa(String.fromCharCode(...rawPub));
      
      const rawSig = new Uint8Array(64);
      crypto.getRandomValues(rawSig);
      const signature = btoa(String.fromCharCode(...rawSig));
      
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const derivedKeyHash = await deriveKey(password, publicKey);

      const state: MobileVaultState = {
        username,
        derivedKeyHash,
        tokenId,
        publicKey,
        signature,
        expiresAt,
        passwords: [],
        otps: []
      };

      saveVault(state);

      const bootstrapToken = {
        tokenId,
        publicKey,
        signature,
        expiresAt
      };

      return {
        success: true,
        tokenId,
        publicKey,
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

      const derivedKeyHash = await deriveKey(password, publicKey);
      let state = loadVault();

      if (!state) {
        state = {
          username: `mobile-${tokenId.slice(-6)}`,
          derivedKeyHash,
          tokenId,
          publicKey,
          signature,
          expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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

    async startNexGrid() {
      // Standalone grid initiation for mobile
      return { success: true, message: 'NexGrid mobile connection ready' };
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
      return { success: true };
    },

    async listOTPs() {
      const state = loadVault();
      if (!state) return { success: true, entries: [] };
      return {
        success: true,
        entries: state.otps.map(o => ({ service: o.service, createdAt: o.createdAt }))
      };
    }
  };
}

initMobileVault();
