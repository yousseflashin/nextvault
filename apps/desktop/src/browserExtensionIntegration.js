/**
 * apps/desktop/src/browserExtensionIntegration.js
 *
 * Automatically installs and registers the NextVault browser extension into
 * default and installed desktop browsers (Google Chrome, Chromium, Brave,
 * Microsoft Edge, Vivaldi, Mozilla Firefox).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const CHROME_EXTENSION_ID = 'ajnjodilfppgppkekhgmkahlnjngampj';
const FIREFOX_EXTENSION_ID = 'nexvault-extension@nexvault.local';

/**
 * Locate the extension source files.
 * Handles both development mode and packaged Electron applications.
 */
function findExtensionSourceDir() {
  const candidates = [
    path.join(__dirname, '..', '..', 'extension', 'src'),
    path.join(process.resourcesPath || '', 'extension'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'apps', 'extension', 'src'),
    path.join(__dirname, 'extension'),
    path.join(process.cwd(), 'apps', 'extension', 'src')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'manifest.json'))) {
      return c;
    }
  }
  return null;
}

/**
 * Ensures extension files exist in a persistent user directory
 * so browser can always read them even if app is in an AppImage/temp mount.
 */
function ensurePersistentExtensionDir() {
  const homeDir = os.homedir();
  const targetDir = path.join(homeDir, '.local', 'share', 'nexvault', 'extension');
  const sourceDir = findExtensionSourceDir();

  if (!sourceDir) {
    if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, 'manifest.json'))) {
      return targetDir;
    }
    return null;
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // Recursively copy source files to target
    copyFolderSync(sourceDir, targetDir);
    return targetDir;
  } catch (err) {
    console.warn('[ExtensionIntegration] Error copying extension to persistent storage:', err.message);
    return sourceDir;
  }
}

function copyFolderSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Automatically registers the extension into all detected Chromium-based browsers.
 */
function installChromiumExternalExtension(extDir) {
  const homeDir = os.homedir();
  const installedBrowsers = [];

  const browserConfigs = [
    { name: 'Google Chrome', dir: path.join(homeDir, '.config', 'google-chrome') },
    { name: 'Google Chrome Beta', dir: path.join(homeDir, '.config', 'google-chrome-beta') },
    { name: 'Google Chrome Dev', dir: path.join(homeDir, '.config', 'google-chrome-unstable') },
    { name: 'Chromium', dir: path.join(homeDir, '.config', 'chromium') },
    { name: 'Brave Browser', dir: path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser') },
    { name: 'Microsoft Edge', dir: path.join(homeDir, '.config', 'microsoft-edge') },
    { name: 'Microsoft Edge Beta', dir: path.join(homeDir, '.config', 'microsoft-edge-beta') },
    { name: 'Microsoft Edge Dev', dir: path.join(homeDir, '.config', 'microsoft-edge-dev') },
    { name: 'Vivaldi', dir: path.join(homeDir, '.config', 'vivaldi') }
  ];

  const payload = JSON.stringify({
    external_path: extDir
  }, null, 2);

  for (const b of browserConfigs) {
    try {
      if (!fs.existsSync(b.dir)) continue;
      const extFolder = path.join(b.dir, 'External Extensions');
      fs.mkdirSync(extFolder, { recursive: true });
      const targetFile = path.join(extFolder, `${CHROME_EXTENSION_ID}.json`);
      fs.writeFileSync(targetFile, payload, 'utf8');
      installedBrowsers.push(b.name);
      console.log(`[ExtensionIntegration] Registered extension for ${b.name} at: ${targetFile}`);
    } catch (err) {
      // Ignore browsers not present or unwritable
    }
  }

  // Windows Registry fallback
  if (process.platform === 'win32') {
    const regKeys = [
      `HKCU\\Software\\Google\\Chrome\\Extensions\\${CHROME_EXTENSION_ID}`,
      `HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\${CHROME_EXTENSION_ID}`,
      `HKCU\\Software\\Microsoft\\Edge\\Extensions\\${CHROME_EXTENSION_ID}`
    ];
    for (const key of regKeys) {
      exec(`reg add "${key}" /v path /t REG_SZ /d "${extDir}" /f`, () => {});
    }
  }

  // macOS standard Application Support directories
  if (process.platform === 'darwin') {
    const macConfigs = [
      path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'External Extensions'),
      path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'External Extensions'),
      path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge', 'External Extensions')
    ];
    for (const macDir of macConfigs) {
      try {
        fs.mkdirSync(macDir, { recursive: true });
        fs.writeFileSync(path.join(macDir, `${CHROME_EXTENSION_ID}.json`), payload, 'utf8');
        installedBrowsers.push('macOS Browser');
      } catch {}
    }
  }

  return installedBrowsers;
}

/**
 * Registers extension into Mozilla Firefox profiles.
 */
function installFirefoxExtension(extDir) {
  const homeDir = os.homedir();
  const installedProfiles = [];
  const firefoxDir = path.join(homeDir, '.mozilla', 'firefox');

  if (!fs.existsSync(firefoxDir)) return installedProfiles;

  try {
    const entries = fs.readdirSync(firefoxDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && (entry.name.includes('.default') || entry.name.includes('.default-release'))) {
        const profileExtDir = path.join(firefoxDir, entry.name, 'extensions');
        fs.mkdirSync(profileExtDir, { recursive: true });
        
        // Firefox proxy file: file named <id> containing path to extension
        const proxyFile = path.join(profileExtDir, FIREFOX_EXTENSION_ID);
        fs.writeFileSync(proxyFile, extDir.trim(), 'utf8');
        installedProfiles.push(`Firefox (${entry.name})`);
        console.log(`[ExtensionIntegration] Registered extension for Firefox profile: ${entry.name}`);
      }
    }
  } catch (err) {
    console.warn('[ExtensionIntegration] Error installing to Firefox:', err.message);
  }

  return installedProfiles;
}

/**
 * Main auto-integration entry point called during desktop startup.
 */
function setupBrowserExtensionIntegration() {
  try {
    const extDir = ensurePersistentExtensionDir();
    if (!extDir) {
      console.warn('[ExtensionIntegration] Extension source folder not found, skipping browser auto-registration.');
      return { success: false, error: 'Extension directory not found' };
    }

    const chromiumList = installChromiumExternalExtension(extDir);
    const firefoxList = installFirefoxExtension(extDir);

    const all = [...chromiumList, ...firefoxList];
    return {
      success: true,
      extensionPath: extDir,
      extensionId: CHROME_EXTENSION_ID,
      browsers: all
    };
  } catch (err) {
    console.error('[ExtensionIntegration] Error during browser integration:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  setupBrowserExtensionIntegration,
  findExtensionSourceDir
};
