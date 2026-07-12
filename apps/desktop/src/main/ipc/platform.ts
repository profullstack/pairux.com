/**
 * IPC handlers for platform-specific features
 */

import { ipcMain, app, shell, BrowserWindow } from 'electron';
import {
  getPlatformInfo,
  checkPipeWireAvailable,
  checkXTESTAvailable,
  getLinuxDistro,
  requestWindowsElevation,
  checkWindowsDefenderExclusion,
  showWindowsDefenderHelp,
  openMacOSSystemPreferences,
  isAppleSilicon,
  isElevated,
} from '../platform';

/** True if semver `a` is strictly newer than `b` (major.minor.patch). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Register platform-specific IPC handlers
 */
export function registerPlatformHandlers(): void {
  // Get platform information
  ipcMain.handle('platform:info', () => {
    return getPlatformInfo();
  });

  // Check GitHub for a newer desktop release than the running one.
  ipcMain.handle('app:check-update', async () => {
    const current = app.getVersion();
    try {
      const res = await fetch(
        'https://api.github.com/repos/profullstack/pairux.com/releases/latest',
        {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pairux-desktop' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) return { updateAvailable: false, current, latest: null };
      const data = (await res.json()) as { tag_name?: string };
      const latest = (data.tag_name ?? '').replace(/^v/, '');
      return {
        updateAvailable: latest !== '' && isNewer(latest, current),
        current,
        latest: latest || null,
      };
    } catch {
      return { updateAvailable: false, current, latest: null };
    }
  });

  // Get detailed Linux info
  ipcMain.handle('platform:linux-info', () => {
    if (process.platform !== 'linux') {
      return null;
    }

    return {
      distro: getLinuxDistro(),
      hasPipeWire: checkPipeWireAvailable(),
      hasXTEST: checkXTESTAvailable(),
      displayServer: process.env.XDG_SESSION_TYPE ?? 'unknown',
      waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
      x11Display: process.env.DISPLAY ?? null,
    };
  });

  // Check elevation status
  ipcMain.handle('platform:is-elevated', () => {
    return isElevated();
  });

  // Request Windows elevation
  ipcMain.handle('platform:request-elevation', async (_event, reason: string) => {
    return requestWindowsElevation(reason);
  });

  // Windows Defender exclusion check
  ipcMain.handle('platform:check-defender-exclusion', () => {
    return checkWindowsDefenderExclusion();
  });

  // Show Windows Defender help
  ipcMain.handle('platform:show-defender-help', async () => {
    await showWindowsDefenderHelp();
    return { success: true };
  });

  // Open macOS System Preferences
  ipcMain.handle('platform:open-macos-preferences', async (_event, pane: string) => {
    await openMacOSSystemPreferences(pane);
    return { success: true };
  });

  // Check Apple Silicon
  ipcMain.handle('platform:is-apple-silicon', () => {
    return isAppleSilicon();
  });

  // Get app paths
  ipcMain.handle('platform:get-paths', () => {
    return {
      exe: app.getPath('exe'),
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      temp: app.getPath('temp'),
    };
  });

  // Open external URL
  ipcMain.handle('platform:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // Open path in file manager
  ipcMain.handle('platform:show-in-folder', (_event, path: string) => {
    shell.showItemInFolder(path);
    return { success: true };
  });

  // Toggle DevTools for the focused window (available in production for support/debugging)
  ipcMain.handle('platform:toggle-devtools', () => {
    const windows = BrowserWindow.getAllWindows();
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? windows.at(0);
    if (!focusedWindow) {
      return { success: false, error: 'No window available' };
    }

    if (focusedWindow.webContents.isDevToolsOpened()) {
      focusedWindow.webContents.closeDevTools();
    } else {
      focusedWindow.webContents.openDevTools({ mode: 'detach' });
    }

    return { success: true, isOpen: focusedWindow.webContents.isDevToolsOpened() };
  });

  console.log('[IPC] Platform handlers registered');
}
