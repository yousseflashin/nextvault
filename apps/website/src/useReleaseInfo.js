/**
 * apps/website/src/useReleaseInfo.js
 * 
 * Dynamic release metadata hook.
 * Fetches the single published release manifest and falls back to GitHub only
 * when the manifest is unavailable.
 */

import { useState, useEffect } from 'react';

const GITHUB_REPO = 'yousseflashin/nextvault';

export function useReleaseInfo() {
  const [info, setInfo] = useState({});

  useEffect(() => {
    let isMounted = true;

    async function fetchFreshReleaseInfo() {
      // 1. Fetch live /release-info.json with cache-busting query parameter
      try {
        const res = await fetch(`/release-info.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (isValidReleaseInfo(data) && isMounted) {
            setInfo(data);
            return;
          }
        }
      } catch (err) {
        // Fall back to GitHub Releases API if accessible
      }

      // 2. Fallback to GitHub Releases API
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          if (ghData && ghData.tag_name && isMounted) {
            const tag = ghData.tag_name;
            const ver = tag.replace(/^v/, '');
            const assets = ghData.assets || [];
            const dt = assets.find((a) => a.name.endsWith('.AppImage'));
            const mb = assets.find((a) => a.name.endsWith('.apk'));

            setInfo({
              version: ver,
              tag: tag,
              desktop: {
                filename: dt?.name || `NexVault-${ver}.AppImage`,
                size: dt ? `${(dt.size / 1048576).toFixed(1)} MB` : null,
                url: dt?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases`
              },
              mobile: {
                filename: mb?.name || 'NexVault-mobile-app-debug.apk',
                size: mb ? `${(mb.size / 1048576).toFixed(1)} MB` : null,
                url: mb?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases`
              },
              publishedAt: ghData.published_at || null
            });
          }
        }
      } catch (err) {
        // The UI remains usable with the release links disabled.
      }
    }

    fetchFreshReleaseInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  return info;
}

function isValidReleaseInfo(info) {
  return Boolean(
    info &&
    typeof info.version === 'string' &&
    /^\d+\.\d+\.\d+$/.test(info.version) &&
    typeof info.tag === 'string' &&
    info.desktop?.filename &&
    info.desktop?.url
  );
}

