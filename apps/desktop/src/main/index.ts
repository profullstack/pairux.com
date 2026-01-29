import { config } from 'dotenv';
import { resolve } from 'path';
import { app, BrowserWindow, clipboard } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { initializeTray, destroyTray, getTraySession } from './tray';
import { initializeMenu, showAboutDialog } from './platform';
import { setMainWindow as setStreamingMainWindow } from './streaming';

// Set app name early — used as Wayland app-id for KDE/GNOME icon lookup.
// Must match the .desktop file name (pairux.desktop) and electron-builder executableName.
app.setName('pairux');

// Load environment variables from .env file in development only.
// In production, env vars are injected at build time by electron-vite.
if (!app.isPackaged) {
  config({ path: resolve(__dirname, '../../.env') });
}

// Detect display server (X11 vs Wayland)
const isWayland =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY !== undefined);

console.log(
  `[Main] Display server: ${isWayland ? 'Wayland' : process.platform === 'linux' ? 'X11' : 'N/A'}`
);

// Enable features for screen capture on Linux
if (process.platform === 'linux') {
  // Disable SUID sandbox for user-installed AppImages
  // The chrome-sandbox binary requires SUID root permissions which aren't
  // available in user space. This is safe for desktop apps.
  app.commandLine.appendSwitch('no-sandbox');

  // Enable PipeWire for Wayland screen capture
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

  // NOTE: ozone-platform and wayland-ime are passed as real CLI args
  // in the dev script (package.json) and AppImage wrapper, because
  // Chromium reads them during early init before Node.js runs.

  // Enable hardware acceleration
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.getName());
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const existingWindow = windows[0];
      if (existingWindow.isMinimized()) existingWindow.restore();
      existingWindow.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = await createMainWindow(isWayland);
  setStreamingMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    setStreamingMainWindow(null);
    mainWindow = null;
  });
}

// App lifecycle
void app.whenReady().then(async () => {
  console.log('[Main] App starting...');

  // Register IPC handlers before creating window
  registerIpcHandlers();

  await createWindow();

  // Initialize system tray
  initializeTray({
    onShowWindow: () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onEndSession: () => {
      // Send message to renderer to end session
      if (mainWindow) {
        mainWindow.webContents.send('tray:end-session');
      }
    },
    onTogglePause: () => {
      // Send message to renderer to toggle pause
      if (mainWindow) {
        mainWindow.webContents.send('tray:toggle-pause');
      }
    },
    onCopyJoinCode: () => {
      const session = getTraySession();
      if (session) {
        clipboard.writeText(session.joinCode);
      }
    },
    onQuit: () => {
      app.quit();
    },
  });

  // Initialize application menu (especially for macOS menu bar)
  initializeMenu({
    onAbout: () => {
      showAboutDialog();
    },
    onPreferences: () => {
      if (mainWindow) {
        mainWindow.webContents.send('navigate', '/settings');
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onNewSession: () => {
      if (mainWindow) {
        mainWindow.webContents.send('navigate', '/');
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onEndSession: () => {
      if (mainWindow) {
        mainWindow.webContents.send('tray:end-session');
      }
    },
  });

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Main] App quitting...');
  destroyTray();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

// Export for IPC handlers
export { isWayland };
