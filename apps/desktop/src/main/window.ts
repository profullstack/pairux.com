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
  //
  // Do not assume XWayland here: on a Wayland session Chromium runs the native
  // ozone/wayland backend, and desktopCapturer.getSources() then goes through
  // the xdg-desktop-portal ScreenCast interface, which does not support
  // enumerating sources with thumbnails and fails ("ScreenCastPortal failed").
  // The renderer therefore skips its own picker on Wayland and calls
  // getDisplayMedia() so the portal shows its picker instead.
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

  // Restrict WebRTC ICE candidate gathering to ONLY the default-route interface
  // (the machine's real internet connection). Chromium otherwise enumerates
  // EVERY up adapter — including non-routable ones like a VPN tap or SIM-card
  // Ethernet (e.g. enp2s0 on 192.168.11.x with no default route) — and builds a
  // TURN/relay allocation per interface. If ICE selects an allocation sourced
  // from the dead NIC, packets egress a dead path (or are dropped for
  // source/route mismatch): the relay "connects" but DTLS never flows and the
  // publisher dies with "could not establish pc connection" a few seconds in.
  // 'default_public_and_private_interfaces' still gathered those private
  // candidates; 'default_public_interface_only' uses only the default-route
  // NIC, which is what we want for relayed SFU streaming. The web platform has
  // no API to pick a NIC explicitly.
  mainWindow.webContents.setWebRTCIPHandlingPolicy('default_public_interface_only');

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
