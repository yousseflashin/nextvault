/**
 * apps/desktop/src/linuxIntegration.js
 * 
 * Provides native Linux desktop environment integration for NexVault:
 * - Automatically registers ~/.local/share/applications/nexvault.desktop
 * - Installs high-resolution icons to ~/.local/share/icons/hicolor/...
 * - Integrates with KDE Plasma, GNOME, XFCE app menus, docks, and search
 * - Supports AppImage dynamic path updating and URL schemes
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

function setupLinuxDesktopIntegration() {
  if (process.platform !== 'linux') return;

  try {
    const homeDir = os.homedir();
    const appDir = path.join(homeDir, '.local', 'share', 'applications');
    const iconsBaseDir = path.join(homeDir, '.local', 'share', 'icons', 'hicolor');
    const desktopFilePath = path.join(appDir, 'nexvault.desktop');

    // Ensure target directories exist
    fs.mkdirSync(appDir, { recursive: true });

    // Install icons across standard hicolor sizes
    const sizes = [16, 32, 48, 64, 128, 256, 512];
    for (const s of sizes) {
      const sizeDir = path.join(iconsBaseDir, `${s}x${s}`, 'apps');
      const targetIcon = path.join(sizeDir, 'nexvault.png');
      const srcIcon = path.join(__dirname, '..', 'build', 'icons', `${s}x${s}.png`);
      const fallbackIcon = path.join(__dirname, 'assets', 'icon.png');

      fs.mkdirSync(sizeDir, { recursive: true });
      try {
        if (fs.existsSync(srcIcon)) {
          fs.copyFileSync(srcIcon, targetIcon);
        } else if (fs.existsSync(fallbackIcon) && !fs.existsSync(targetIcon)) {
          fs.copyFileSync(fallbackIcon, targetIcon);
        }
      } catch {}
    }

    // Determine executable command
    // If running from an AppImage, process.env.APPIMAGE contains the full path to the .AppImage
    const appImagePath = process.env.APPIMAGE;
    let execCmd = '';
    if (appImagePath && fs.existsSync(appImagePath)) {
      execCmd = `"${appImagePath}" %U`;
    } else {
      execCmd = `"${process.execPath}" "${path.join(__dirname, '..')}" %U`;
    }

    const desktopContent = [
      '[Desktop Entry]',
      'Version=1.0',
      'Type=Application',
      'Name=NexVault',
      'GenericName=Encrypted Vault & Authenticator',
      'Comment=Local-First Encrypted Vault & P2P Mesh',
      `Exec=${execCmd}`,
      'Icon=nexvault',
      'Terminal=false',
      'Categories=Utility;Security;',
      'StartupWMClass=nexvault',
      'MimeType=x-scheme-handler/nexvault;',
      'Keywords=password;vault;security;authenticator;totp;crypto;nexvault;',
      'StartupNotify=true',
      '',
      'Actions=Lock;',
      '',
      '[Desktop Action Lock]',
      'Name=Lock Vault',
      `Exec=${execCmd} --lock`,
      ''
    ].join('\n');

    let shouldWrite = true;
    if (fs.existsSync(desktopFilePath)) {
      const existing = fs.readFileSync(desktopFilePath, 'utf8');
      if (existing === desktopContent) {
        shouldWrite = false;
      }
    }

    if (shouldWrite) {
      fs.writeFileSync(desktopFilePath, desktopContent, 'utf8');
      try {
        fs.chmodSync(desktopFilePath, 0o755);
      } catch {}

      // Refresh desktop icon and menu databases in KDE/GNOME
      exec('update-desktop-database ' + appDir, () => {});
      exec('kbuildsycoca6 2>/dev/null || kbuildsycoca5 2>/dev/null', () => {});
      console.log('[Linux] Registered NexVault in desktop menu:', desktopFilePath);
    }
  } catch (err) {
    console.warn('[Linux] Desktop integration notice:', err.message);
  }
}

module.exports = { setupLinuxDesktopIntegration };
