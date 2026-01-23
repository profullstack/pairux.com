import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';

// Detect display server (X11 vs Wayland)
const isWayland =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY !== undefined);

console.log(
  `[Main] Display server: ${isWayland ? 'Wayland' : process.platform === 'linux' ? 'X11' : 'N/A'}`
);

// Enable features for screen capture on Linux
if (process.platform === 'linux') {
  // Disable SUID sandbox in development (avoids permission issues)
  if (process.env.NODE_ENV === 'development') {
    app.commandLine.appendSwitch('no-sandbox');
  }

  // Enable PipeWire for Wayland screen capture
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

  // Use Wayland backend if available
  if (isWayland) {
    app.commandLine.appendSwitch('ozone-platform', 'wayland');
    // Enable Wayland IME support
    app.commandLine.appendSwitch('enable-wayland-ime');
  }

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
  mainWindow = await createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
void app.whenReady().then(async () => {
  console.log('[Main] App starting...');

  // Register IPC handlers before creating window
  registerIpcHandlers();

  await createWindow();

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
