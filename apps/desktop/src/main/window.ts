import { BrowserWindow, shell, session, desktopCapturer, nativeImage } from 'electron';
import { join } from 'path';

const isDev = process.env.NODE_ENV === 'development';

// Get the icon path based on environment
function getIconPath(): string {
  if (isDev) {
    // Development: use resources folder relative to dist/main
    return join(__dirname, '../../resources/icon.png');
  }
  // Production: icon is in the app's resources directory
  return join(process.resourcesPath, 'icon.png');
}

export async function createMainWindow(isWayland: boolean): Promise<BrowserWindow> {
  // Load the window icon
  const iconPath = getIconPath();
  const icon = nativeImage.createFromPath(iconPath);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: icon.isEmpty() ? undefined : icon,
    // macOS: hidden inset for native look with traffic lights
    // Windows: custom title bar overlay (no custom titlebar needed since renderer shows TitleBar)
    // Linux: native titlebar (renderer TitleBar is hidden on Linux to avoid double title bar)
    titleBarStyle:
      process.platform === 'darwin'
        ? 'hiddenInset'
        : process.platform === 'win32'
          ? 'hidden'
          : 'default',
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

  // Handle display media (screen capture) permission requests.
  // Electron requires setDisplayMediaRequestHandler — without it,
  // getDisplayMedia() fails with "Not supported in UI".
  // We run under XWayland (no ozone-platform=wayland), so
  // desktopCapturer.getSources() returns real screen content.
  console.log(
    `[Main] Window: isWayland=${String(isWayland)}, XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE ?? 'unset'}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? 'unset'}`
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      console.log('[Main] Display media request received');

      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
        })
        .then((sources) => {
          if (sources.length > 0) {
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
    },
    { useSystemPicker: true }
  );

  // Handle permission requests
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = [
      'media',
      'display-capture',
      'mediaKeySystem',
      'geolocation',
      'notifications',
      'fullscreen',
      'clipboard-sanitized-write',
      'clipboard-read',
    ];

    if (allowedPermissions.includes(permission)) {
      console.log('[Main] Permission granted:', permission);
      callback(true);
    } else {
      console.log('[Main] Permission denied:', permission);
      callback(false);
    }
  });

  // Show window when ready to prevent visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    console.log('[Main] Main window ready');
  });

  // Restrict WebRTC ICE candidate gathering to the default-route interface
  // (the machine's real internet connection). Without this, Chromium offers
  // candidates on EVERY adapter — including non-routable ones like a VPN tap or
  // SIM-card-hardware Ethernet — and ICE can pick a path that drops mid-stream
  // ("could not establish pc connection"). This auto-selects the right NIC; the
  // web platform has no API to pick one explicitly.
  mainWindow.webContents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces');

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
