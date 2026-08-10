import { BrowserWindow, shell, session, desktopCapturer, nativeImage } from 'electron';
import { join } from 'path';
import { pickDisplayMediaSource, takePreferredDisplayMediaSource } from './capture/displayMedia';

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
      // A screen share must keep running while the user works in the window
      // they are sharing — which means this window is, by definition, in the
      // background almost the whole session.
      //
      // Chromium throttles a backgrounded renderer, and after about five
      // minutes escalates to intensive throttling that clamps timers to roughly
      // once a minute. That stalls requestAnimationFrame, which is what drives
      // the camera-bubble compositor canvas feeding captureStream() — so the
      // published video freezes on its last frame until the window is focused
      // again and the renderer un-throttles.
      backgroundThrottling: false,
    },
  });

  // Handle display media (screen capture) permission requests.
  // Electron requires setDisplayMediaRequestHandler — without it,
  // getDisplayMedia() fails with "Not supported in UI".
  //
  // Do not assume XWayland here: on a Wayland session Chromium runs the native
  // ozone/wayland backend, and desktopCapturer.getSources() then goes through
  // the xdg-desktop-portal ScreenCast interface. Enumerating with thumbnails
  // there is unreliable, and a second concurrent portal session conflicts with
  // the first, so the renderer skips its own picker on Wayland: only the
  // handler below enumerates, and the portal's own dialog does the choosing.
  console.log(
    `[Main] Window: isWayland=${String(isWayland)}, XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE ?? 'unset'}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? 'unset'}`
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // The request itself says nothing about which source the user chose —
      // `videoRequested` is just a boolean. The renderer records its pick over
      // `capture:setPreferredSource` when it has one; otherwise enumeration
      // decides, which on Wayland means the PipeWire portal's own picker.
      const preferredId = takePreferredDisplayMediaSource();
      console.log(
        `[Main] Display media request received (preferredSource=${preferredId ?? 'none'})`
      );

      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
        })
        .then((sources) => {
          const selected = pickDisplayMediaSource(sources, preferredId);

          if (!selected) {
            // Denying here is the only honest outcome: an empty `Streams`
            // grants nothing and getDisplayMedia() rejects in the renderer,
            // which surfaces as a "capture was canceled" message.
            console.warn('[Main] No capturable sources — denying display media request');
            callback({});
            return;
          }

          console.log('[Main] Granting access to source:', selected.name);
          callback({ video: selected });
        })
        .catch((err: unknown) => {
          console.error('[Main] Failed to get sources:', err);
          callback({});
        });
    },
    // Experimental and macOS 15+ only per Electron docs; where it applies the
    // handler above is not invoked at all. Every other platform still needs it.
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

  // Mirror renderer console output into the main process stdout.
  //
  // Session logic (WebRTC, control state, audio routing) all lives in the
  // renderer, so its logs are invisible to anyone running a packaged build
  // from a terminal — they only see main-process lines and can easily conclude
  // a subsystem never ran. Forwarding makes a pasted terminal log diagnosable.
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    // 0=verbose 1=info 2=warning 3=error
    const prefix = level >= 3 ? '[Renderer:error]' : level === 2 ? '[Renderer:warn]' : '[Renderer]';
    console.log(`${prefix} ${message}`);
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
