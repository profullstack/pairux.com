/**
 * IPC handlers for platform-specific features
 */

import { ipcMain, app, shell } from 'electron';
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

/**
 * Register platform-specific IPC handlers
 */
export function registerPlatformHandlers(): void {
  // Get platform information
  ipcMain.handle('platform:info', () => {
    return getPlatformInfo();
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

  console.log('[IPC] Platform handlers registered');
}
