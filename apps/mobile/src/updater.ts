/**
 * updater.ts — in-app update checks for the Android build.
 *
 * Source of truth is the release manifest (release-info.json) attached to the
 * latest GitHub release; the GitHub REST API is the fallback. Every update must
 * carry a SHA-256 checksum, which the native AppUpdater plugin verifies (along
 * with host allowlist, size, package name, versionCode and signing key) before
 * the APK is handed to the Android installer.
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

export const GITHUB_REPO = 'yousseflashin/nextvault';
export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
const LATEST_MANIFEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/release-info.json`;
const GITHUB_API_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** Build-time version (vite define). The native versionName is preferred when available. */
export const BUILD_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

interface AppUpdaterPlugin {
  getAppInfo(): Promise<{ packageName: string; versionName: string; versionCode: number }>;
  installApk(options: { url: string; sha256: string; size: number }): Promise<{
    success: boolean;
    message?: string;
    needPermission?: boolean;
    signatureMismatch?: boolean;
  }>;
  addListener(
    event: 'downloadProgress',
    cb: (p: { percent: number; downloadedBytes: number; totalBytes: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export interface UpdateAsset {
  filename: string;
  url: string;
  size: number;
  sha256: string;
  versionCode?: number;
}

export interface UpdateCheckResult {
  success: boolean;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  downloadUrl?: string;
  size?: number;
  sha256?: string;
  releaseUrl?: string;
  releaseName?: string;
  notes?: string;
  publishedAt?: string;
  source?: 'manifest' | 'github-api';
  message?: string;
  error?: string;
}

let lastCheck: { version: string; asset: UpdateAsset } | null = null;

export function compareVersions(a: string, b: string): number {
  const pa = String(a || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

const isNative = () => Capacitor.isNativePlatform();

export async function getCurrentVersion(): Promise<string> {
  if (isNative()) {
    try {
      const info = await AppUpdater.getAppInfo();
      if (info?.versionName) return info.versionName;
    } catch {
      /* fall through to build version */
    }
  }
  return BUILD_VERSION;
}

/** GET JSON. Uses native HTTP on device (github.com download URLs do not send CORS headers). */
async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  if (isNative()) {
    const res = await CapacitorHttp.get({ url, headers, responseType: 'json', connectTimeout: 10000, readTimeout: 15000 });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isSha256 = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);

async function latestFromManifest() {
  const m = await getJson(LATEST_MANIFEST_URL);
  const a = m?.mobile;
  if (m?.schemaVersion !== 2 || !m.version || !a?.url || !isSha256(a.sha256) || !(a.size > 0)) {
    throw new Error('Release manifest is incomplete');
  }
  return {
    version: String(m.version),
    asset: { filename: a.filename, url: a.url, size: a.size, sha256: a.sha256.toLowerCase(), versionCode: a.versionCode } as UpdateAsset,
    releaseUrl: m.releaseUrl as string,
    releaseName: `NexVault ${m.tag}`,
    notes: '',
    publishedAt: m.publishedAt as string,
    source: 'manifest' as const
  };
}

async function latestFromGithubApi() {
  const data = await getJson(GITHUB_API_LATEST, { Accept: 'application/vnd.github+json' });
  const apk = (data?.assets || []).find((a: any) => /\.apk$/i.test(a.name));
  if (!data?.tag_name || !apk) throw new Error('Latest GitHub release has no APK');
  const sha256 = String(apk.digest || '').replace(/^sha256:/, '');
  return {
    version: String(data.tag_name).replace(/^v/, ''),
    asset: { filename: apk.name, url: apk.browser_download_url, size: apk.size, sha256: isSha256(sha256) ? sha256.toLowerCase() : '' } as UpdateAsset,
    releaseUrl: data.html_url as string,
    releaseName: (data.name || data.tag_name) as string,
    notes: (data.body || '') as string,
    publishedAt: data.published_at as string,
    source: 'github-api' as const
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentVersion();
  let latest;
  const errors: string[] = [];
  for (const source of [latestFromManifest, latestFromGithubApi]) {
    try {
      latest = await source();
      break;
    } catch (err: any) {
      errors.push(err?.message || String(err));
    }
  }
  if (!latest) {
    return {
      success: false,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      error: errors.join('; '),
      message: 'Unable to reach GitHub Releases. Check your connection and try again.'
    };
  }

  const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
  lastCheck = hasUpdate ? { version: latest.version, asset: latest.asset } : null;
  return {
    success: true,
    currentVersion,
    latestVersion: latest.version,
    hasUpdate,
    downloadUrl: latest.asset.url,
    size: latest.asset.size,
    sha256: latest.asset.sha256,
    releaseUrl: latest.releaseUrl,
    releaseName: latest.releaseName,
    notes: latest.notes,
    publishedAt: latest.publishedAt,
    source: latest.source,
    message: hasUpdate ? `Update available: v${latest.version}` : `NexVault is up to date (v${currentVersion})`
  };
}

/**
 * Downloads, verifies and launches the installer for the latest APK.
 * The asset always comes from the most recent update check — never from a
 * caller-supplied URL — so nothing in the WebView can redirect the download.
 */
export async function applyUpdate(onProgress?: (percent: number) => void) {
  try {
    if (!lastCheck) {
      const check = await checkForUpdates();
      if (!check.hasUpdate || !lastCheck) {
        return { success: false, message: check.message || 'No update available.' };
      }
    }
    const { asset } = lastCheck!;

    if (!isNative()) {
      window.open(asset.url, '_blank');
      return { success: true, message: 'Opening download in your browser...' };
    }
    if (!isSha256(asset.sha256)) {
      return {
        success: false,
        message: 'This release has no checksum, so it cannot be installed automatically. Download it from the website instead.'
      };
    }

    const listener = onProgress
      ? await AppUpdater.addListener('downloadProgress', (p) => onProgress(p.percent)).catch(() => null)
      : null;
    try {
      return await AppUpdater.installApk({ url: asset.url, sha256: asset.sha256, size: asset.size });
    } finally {
      await listener?.remove().catch(() => undefined);
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
