/**
 * apps/website/src/useReleaseInfo.js
 *
 * Single source of truth for release metadata and client platform detection
 * across the NexVault website.
 *
 * - Deduplicates network requests across Navbar, Hero, and DownloadsSection.
 * - Normalizes both schema-v2 manifests (exact byte sizes + SHA-256 digests)
 *   and schema-v1 / GitHub REST API responses.
 * - Detects whether the visitor is on Android/Mobile vs Linux/Desktop so the
 *   UI can highlight the right binary and adapt mobile vs desktop layouts.
 */

import { useState, useEffect } from 'react';

export const GITHUB_REPO = 'yousseflashin/nextvault';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const GITHUB_ACTIONS_URL = `https://github.com/${GITHUB_REPO}/actions/workflows/release.yml`;
export const FALLBACK_VERSION = '0.1.30';

export function formatByteSize(bytes, fallback = '') {
  if (typeof bytes === 'string' && bytes.trim()) {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric)) return bytes.trim();
    bytes = numeric;
  }
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function formatExactBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString('en-US')} bytes`;
}

function normalizeAsset(raw, defaults) {
  if (!raw || typeof raw !== 'object') return defaults;
  const numericSize = typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : null;
  const sizeFormatted =
    raw.sizeFormatted ||
    (numericSize ? formatByteSize(numericSize) : typeof raw.size === 'string' ? raw.size : defaults.sizeFormatted);
  const sha256 =
    typeof raw.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(raw.sha256)
      ? raw.sha256.toLowerCase()
      : defaults.sha256;

  return {
    platform: raw.platform || defaults.platform,
    arch: raw.arch || defaults.arch,
    format: raw.format || defaults.format,
    filename: raw.filename || defaults.filename,
    url: raw.url || defaults.url,
    sizeBytes: numericSize,
    size: sizeFormatted,
    sizeExact: numericSize ? formatExactBytes(numericSize) : null,
    sha256,
    versionCode: raw.versionCode || defaults.versionCode || null,
    requirements: raw.requirements || defaults.requirements
  };
}

export function normalizeReleaseInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const version = String(raw.version || raw.tag || '')
    .replace(/^v/i, '')
    .trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;

  const tag = raw.tag || `v${version}`;
  const releaseUrl = raw.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;

  const desktopDefaults = {
    platform: 'linux-x86_64',
    arch: 'x86_64',
    format: 'AppImage',
    filename: `NexVault-${version}.AppImage`,
    url: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/NexVault-${version}.AppImage`,
    sizeFormatted: '',
    sha256: null,
    requirements: 'Linux x86_64 · glibc 2.35+ (Ubuntu 22.04+, Debian 12+, Fedora 36+)'
  };

  const mobileDefaults = {
    platform: 'android',
    arch: 'universal',
    format: 'APK',
    filename: `NexVault-${version}.apk`,
    url: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/NexVault-${version}.apk`,
    sizeFormatted: '',
    sha256: null,
    versionCode: null,
    requirements: 'Android 7.0+ (API 24+ · ARM64 / x86_64)'
  };

  return {
    schemaVersion: raw.schemaVersion || 2,
    version,
    tag,
    publishedAt: raw.publishedAt || null,
    releaseUrl,
    checksumsUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/SHA256SUMS.txt`,
    manifestUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/release-info.json`,
    desktop: normalizeAsset(raw.desktop, desktopDefaults),
    mobile: normalizeAsset(raw.mobile, mobileDefaults),
    isLoaded: true
  };
}

// Shared module-level cache so multiple components don't re-fetch simultaneously
let cachedReleaseInfo = null;
let inflightPromise = null;

async function loadReleaseInfoOnce() {
  if (cachedReleaseInfo) return cachedReleaseInfo;
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    // 1. Primary: /release-info.json served by the website (populated at build/release time)
    try {
      const res = await fetch('/release-info.json', {
        cache: 'no-cache',
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        const normalized = normalizeReleaseInfo(data);
        if (normalized) {
          cachedReleaseInfo = normalized;
          return normalized;
        }
      }
    } catch {
      // Fall back to GitHub Releases API
    }

    // 2. Fallback: GitHub Releases REST API
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        if (ghData && ghData.tag_name) {
          const tag = ghData.tag_name;
          const ver = tag.replace(/^v/i, '');
          const assets = ghData.assets || [];
          const dt = assets.find((a) => /\.AppImage$/i.test(a.name));
          const mb = assets.find((a) => /\.apk$/i.test(a.name));
          const cleanSha = (digest) => {
            const hex = String(digest || '').replace(/^sha256:/i, '');
            return /^[a-f0-9]{64}$/i.test(hex) ? hex.toLowerCase() : null;
          };

          const normalized = normalizeReleaseInfo({
            schemaVersion: 2,
            version: ver,
            tag,
            publishedAt: ghData.published_at || null,
            releaseUrl: ghData.html_url || `${GITHUB_RELEASES_URL}/tag/${tag}`,
            desktop: dt && {
              filename: dt.name,
              size: dt.size,
              sha256: cleanSha(dt.digest),
              url: dt.browser_download_url
            },
            mobile: mb && {
              filename: mb.name,
              size: mb.size,
              sha256: cleanSha(mb.digest),
              url: mb.browser_download_url
            }
          });
          if (normalized) {
            cachedReleaseInfo = normalized;
            return normalized;
          }
        }
      }
    } catch {
      // Keep fallback defaults
    }

    return normalizeReleaseInfo({
      version: FALLBACK_VERSION,
      tag: `v${FALLBACK_VERSION}`
    });
  })();

  return inflightPromise;
}

export function useReleaseInfo() {
  const [info, setInfo] = useState(
    () =>
      cachedReleaseInfo ||
      normalizeReleaseInfo({
        version: FALLBACK_VERSION,
        tag: `v${FALLBACK_VERSION}`
      })
  );

  useEffect(() => {
    let isMounted = true;
    loadReleaseInfoOnce().then((resolved) => {
      if (isMounted && resolved) {
        setInfo(resolved);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return info;
}

/**
 * Detects the visitor's OS & form factor so mobile visitors get Android-first
 * actions and desktop visitors get Linux AppImage-first actions, while allowing
 * either to switch platforms with one tap.
 */
export function detectClientPlatform() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      recommended: 'desktop',
      osLabel: 'Linux x86_64',
      isMobileDevice: false,
      isAndroid: false,
      isLinux: true
    };
  }

  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (
    navigator.userAgentData?.platform ||
    navigator.platform ||
    ''
  ).toLowerCase();

  const isAndroid = ua.includes('android') || platform.includes('android');
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMobileViewport =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches;
  const isMobileDevice = isAndroid || isIOS || /mobile|phone|tablet/.test(ua) || isMobileViewport;
  const isLinux = !isAndroid && (ua.includes('linux') || platform.includes('linux'));

  let osLabel = 'Desktop Workstation';
  if (isAndroid) osLabel = 'Android Mobile';
  else if (isIOS) osLabel = 'Mobile Device';
  else if (isLinux) osLabel = 'Linux x86_64';
  else if (ua.includes('mac')) osLabel = 'macOS Workstation';
  else if (ua.includes('win')) osLabel = 'Windows Workstation';

  return {
    recommended: isAndroid || isMobileDevice ? 'mobile' : 'desktop',
    osLabel,
    isMobileDevice,
    isAndroid,
    isLinux
  };
}

export function useClientPlatform() {
  const [client, setClient] = useState(() => detectClientPlatform());
  const [selectedPlatform, setSelectedPlatform] = useState(() => detectClientPlatform().recommended);

  useEffect(() => {
    const detected = detectClientPlatform();
    setClient(detected);
    setSelectedPlatform(detected.recommended);
  }, []);

  return {
    ...client,
    selectedPlatform,
    setSelectedPlatform
  };
}
