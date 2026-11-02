/**
 * apps/website/src/useReleaseInfo.js
 * 
 * Dynamic release metadata hook.
 * Fetches latest release info from /release-info.json with cache-busting,
 * ensuring visitors always see the freshest downloadable versions and tag names.
 */

import { useState, useEffect } from 'react';
import staticReleaseInfo from './release-info.json';

const GITHUB_REPO = 'yousseflashin/nextvault';

export function useReleaseInfo() {
  const [info, setInfo] = useState(staticReleaseInfo);

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
          if (data && data.version && isMounted) {
            setInfo((prev) => ({ ...prev, ...data }));
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

            setInfo((prev) => ({
              ...prev,
              version: ver,
              tag: tag,
              desktop: {
                filename: dt?.name || `NexVault-${ver}.AppImage`,
                size: dt ? `${(dt.size / 1048576).toFixed(1)} MB` : prev.desktop?.size || '125.4 MB',
                url: dt?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases/download/${tag}/NexVault-${ver}.AppImage`
              },
              mobile: {
                filename: mb?.name || 'NexVault-mobile-app-debug.apk',
                size: mb ? `${(mb.size / 1048576).toFixed(1)} MB` : prev.mobile?.size || '4.0 MB',
                url: mb?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases/download/${tag}/NexVault-mobile-app-debug.apk`
              },
              publishedAt: ghData.published_at || prev.publishedAt
            }));
          }
        }
      } catch (err) {
        // Silent catch: staticReleaseInfo is already in place
      }
    }

    fetchFreshReleaseInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  return info;
}

