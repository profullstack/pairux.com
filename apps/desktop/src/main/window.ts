import { BrowserWindow, shell, session, desktopCapturer } from 'electron';
import { join } from 'path';

const isDev = process.env.NODE_ENV === 'development';

export async function createMainWindow(): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#1a1a1a',
            symbolColor: '#ffffff',
            height: 32,
          }
        : undefined,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, // Required for screen capture
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Handle display media (screen capture) permission requests
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    console.log('[Main] Display media request received');

    // Get available sources
    desktopCapturer
      .getSources({
        types: ['screen', 'window'],
      })
      .then((sources) => {
        if (sources.length > 0) {
          // For now, automatically grant access to the first screen
          // In production, you might want to show a picker
          console.log('[Main] Granting access to source:', sources[0].name);
          callback({ video: sources[0] });
        } else {
          console.log('[Main] No sources available');
          callback({});
        }
      })
      .catch((err: unknown) => {
        console.error('[Main] Failed to get sources:', err);
        callback({});
      });
  });

  // Handle permission requests
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowedPermissions = [
        'media',
        'display-capture',
        'mediaKeySystem',
        'geolocation',
        'notifications',
        'fullscreen',
      ];

      if (allowedPermissions.includes(permission)) {
        console.log('[Main] Permission granted:', permission);
        callback(true);
      } else {
        console.log('[Main] Permission denied:', permission);
        callback(false);
      }
    }
  );

  // Show window when ready to prevent visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    console.log('[Main] Main window ready');
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the app
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}
