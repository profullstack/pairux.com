/**
 * Platform-specific utilities and detection
 * Handles cross-platform differences for Windows, macOS, and Linux
 */

import { app, dialog, shell } from 'electron';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';

export { initializeMenu, updateMenuState, showAboutDialog } from './menu';
export type { MenuCallbacks } from './menu';

// ============================================================================
// Platform Detection
// ============================================================================

export type Platform = 'darwin' | 'win32' | 'linux';
export type DisplayServer = 'x11' | 'wayland' | 'unknown';

export interface PlatformInfo {
  platform: Platform;
  displayServer: DisplayServer;
  isWayland: boolean;
  isX11: boolean;
  arch: string;
  version: string;
  appVersion: string;
  isElevated: boolean;
  hasScreenCaptureSupport: boolean;
  hasInputInjectionSupport: boolean;
}

/**
 * Detect the Linux display server (X11 or Wayland)
 */
export function detectDisplayServer(): DisplayServer {
  if (process.platform !== 'linux') {
    return 'unknown';
  }

  // Check for Wayland first
  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY !== undefined) {
    return 'wayland';
  }

  // Check for X11
  if (process.env.DISPLAY !== undefined) {
    return 'x11';
  }

  return 'unknown';
}

/**
 * Check if running with elevated privileges
 */
export function isElevated(): boolean {
  if (process.platform === 'win32') {
    // Windows: check if running as Administrator
    try {
      execSync('net session', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === 'linux' || process.platform === 'darwin') {
    // Unix: check if running as root
    return process.getuid?.() === 0;
  }

  return false;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = process.platform as Platform;
  const displayServer = detectDisplayServer();

  return {
    platform,
    displayServer,
    isWayland: displayServer === 'wayland',
    isX11: displayServer === 'x11',
    arch: process.arch,
    version:
      typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : 'unknown',
    appVersion: app.getVersion(),
    isElevated: isElevated(),
    hasScreenCaptureSupport: checkScreenCaptureSupport(),
    hasInputInjectionSupport: checkInputInjectionSupport(),
  };
}

/**
 * Check if screen capture is supported on this platform
 */
function checkScreenCaptureSupport(): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return true;
  }

  if (process.platform === 'linux') {
    const displayServer = detectDisplayServer();

    if (displayServer === 'x11') {
      return true; // X11 always supports screen capture
    }

    if (displayServer === 'wayland') {
      // Wayland requires PipeWire for screen capture
      return checkPipeWireAvailable();
    }
  }

  return false;
}

/**
 * Check if input injection is supported on this platform
 */
function checkInputInjectionSupport(): boolean {
  if (process.platform === 'darwin') {
    // macOS requires Accessibility permission
    return true; // Support is available, permission may be needed
  }

  if (process.platform === 'win32') {
    return true; // Always supported on Windows
  }

  if (process.platform === 'linux') {
    const displayServer = detectDisplayServer();

    if (displayServer === 'x11') {
      // X11 supports input injection via XTEST extension
      return checkXTESTAvailable();
    }

    if (displayServer === 'wayland') {
      // Wayland has limited input injection support
      // Some compositors support wlr-virtual-pointer
      return false; // Very limited support
    }
  }

  return false;
}

// ============================================================================
// Linux-specific utilities
// ============================================================================

/**
 * Check if PipeWire is available for Wayland screen capture
 */
export function checkPipeWireAvailable(): boolean {
  if (process.platform !== 'linux') return false;

  try {
    // Check if PipeWire is running
    execSync('systemctl --user is-active pipewire', { stdio: 'ignore' });
    return true;
  } catch {
    // Try alternative check
    try {
      execSync('pgrep -x pipewire', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check if XTEST extension is available for X11 input injection
 */
export function checkXTESTAvailable(): boolean {
  if (process.platform !== 'linux') return false;

  try {
    const result = execSync('xdpyinfo 2>/dev/null | grep -i xtest', {
      encoding: 'utf8',
    });
    return result.includes('XTEST');
  } catch {
    return true; // Assume available if we can't check
  }
}

/**
 * Get Linux distribution information
 */
export function getLinuxDistro(): { name: string; version: string } | null {
  if (process.platform !== 'linux') return null;

  try {
    // Try /etc/os-release first (standard)
    if (existsSync('/etc/os-release')) {
      const content = readFileSync('/etc/os-release', 'utf8');
      const lines = content.split('\n');
      const info: Record<string, string | undefined> = {};

      for (const line of lines) {
        const parts = line.split('=');
        const key = parts[0];
        const value = parts[1];
        if (key && value) {
          info[key] = value.replace(/"/g, '');
        }
      }

      const name = info.NAME ?? info.ID ?? 'Linux';
      const version = info.VERSION_ID ?? info.VERSION ?? 'unknown';
      return { name, version };
    }
  } catch {
    // Ignore errors
  }

  return { name: 'Linux', version: 'unknown' };
}

// ============================================================================
// Windows-specific utilities
// ============================================================================

/**
 * Request UAC elevation for Windows
 * Returns true if already elevated or elevation succeeded
 */
export async function requestWindowsElevation(reason: string): Promise<boolean> {
  if (process.platform !== 'win32') return true;

  if (isElevated()) {
    return true; // Already elevated
  }

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Administrator Privileges Required',
    message: 'PairUX needs administrator privileges',
    detail: `${reason}\n\nWould you like to restart PairUX with administrator privileges?`,
    buttons: ['Restart as Administrator', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    // Restart with elevation
    restartWithElevation();
    return false; // Will quit and restart
  }

  return false;
}

/**
 * Restart the application with elevated privileges (Windows)
 */
export function restartWithElevation(): void {
  if (process.platform !== 'win32') return;

  const exePath = app.getPath('exe');
  const args = process.argv.slice(1);

  // Use PowerShell to request elevation
  spawn(
    'powershell.exe',
    [
      '-Command',
      `Start-Process -FilePath "${exePath}" -ArgumentList "${args.join(' ')}" -Verb RunAs`,
    ],
    {
      detached: true,
      stdio: 'ignore',
    }
  ).unref();

  app.quit();
}

/**
 * Check if Windows Defender exclusion exists for the app
 */
export function checkWindowsDefenderExclusion(): boolean {
  if (process.platform !== 'win32') return true;

  try {
    const appPath = app.getPath('exe');
    const result = execSync(
      `powershell -Command "Get-MpPreference | Select-Object -ExpandProperty ExclusionPath"`,
      { encoding: 'utf8' }
    );
    return result.includes(appPath);
  } catch {
    return false; // Can't check, assume not excluded
  }
}

/**
 * Open Windows Security settings for adding exclusion
 */
export async function openWindowsDefenderSettings(): Promise<void> {
  if (process.platform !== 'win32') return;

  await shell.openExternal('windowsdefender://threat');
}

/**
 * Show instructions for adding Windows Defender exclusion
 */
export async function showWindowsDefenderHelp(): Promise<void> {
  if (process.platform !== 'win32') return;

  const appPath = app.getPath('exe');

  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Windows Defender Exclusion',
    message: 'Add PairUX to Windows Defender exclusions',
    detail: `To prevent Windows Defender from interfering with PairUX, you can add an exclusion:

1. Open Windows Security
2. Go to Virus & threat protection
3. Click "Manage settings" under Virus & threat protection settings
4. Scroll down to "Exclusions" and click "Add or remove exclusions"
5. Click "Add an exclusion" → "File"
6. Select: ${appPath}

Click "Open Settings" to open Windows Security.`,
    buttons: ['Open Settings', 'Copy Path', 'Close'],
    defaultId: 0,
  });

  if (result.response === 0) {
    await openWindowsDefenderSettings();
  } else if (result.response === 1) {
    const { clipboard } = await import('electron');
    clipboard.writeText(appPath);
  }
}

// ============================================================================
// macOS-specific utilities
// ============================================================================

/**
 * Check if running on Apple Silicon
 */
export function isAppleSilicon(): boolean {
  if (process.platform !== 'darwin') return false;
  return process.arch === 'arm64';
}

/**
 * Open macOS System Preferences to a specific pane
 */
export async function openMacOSSystemPreferences(pane: string): Promise<void> {
  if (process.platform !== 'darwin') return;

  const prefPanes: Record<string, string> = {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screenRecording:
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    security: 'x-apple.systempreferences:com.apple.preference.security',
  };

  const url = prefPanes[pane] ?? prefPanes.security;
  await shell.openExternal(url);
}

// ============================================================================
// Cross-platform utilities
// ============================================================================

/**
 * Open the platform-specific file manager at a path
 */
export function openInFileManager(path: string): void {
  shell.showItemInFolder(path);
}

/**
 * Get platform-specific keyboard modifier key name
 */
export function getModifierKeyName(): string {
  return process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
}

/**
 * Format a keyboard shortcut for display
 */
export function formatShortcut(shortcut: string): string {
  if (process.platform === 'darwin') {
    return shortcut
      .replace(/Ctrl\+/gi, '⌘')
      .replace(/Alt\+/gi, '⌥')
      .replace(/Shift\+/gi, '⇧');
  }
  return shortcut;
}
