import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { resolve } from 'path';

/**
 * `pairux://` deep links.
 *
 * The web app hands a session off to this app rather than hosting it in the
 * browser: a browser tab cannot inject input, so "share my screen and let them
 * drive" only works here. The browser fires `pairux://host/<sessionId>` and
 * falls back to its own player when nothing answers, so every link it can send
 * has to resolve to a renderer route we can actually reach.
 */
export const PAIRUX_PROTOCOL = 'pairux';

/** An id we are willing to paste into a renderer route. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Turn a `pairux://` URL into a renderer (hash router) path.
 *
 * Accepts both `pairux://host/<id>` and the slashless `pairux:host/<id>` some
 * launchers hand over. Returns null for anything unrecognised — the link comes
 * from outside the app, so an unknown shape must not become a navigation.
 */
export function parseDeepLink(raw: string): string | null {
  const match = /^pairux:(?:\/\/)?(.*)$/i.exec(raw.trim());
  if (!match) return null;

  const [rawPath = ''] = match[1].split('?');
  let segments: string[];
  try {
    segments = rawPath
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    // Malformed percent-encoding.
    return null;
  }

  const [action, value] = segments;
  if (!action) return null;

  switch (action.toLowerCase()) {
    case 'host':
    case 'share': {
      // Host a session the web app already created: Home resumes it from this
      // query param.
      if (!value || !SAFE_ID.test(value)) return null;
      return `/?shareSessionId=${encodeURIComponent(value)}`;
    }
    case 'join': {
      if (!value) return null;
      const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) return null;
      return `/join?code=${code}`;
    }
    case 'view':
    case 'viewer': {
      if (!value || !SAFE_ID.test(value)) return null;
      return `/viewer/${encodeURIComponent(value)}`;
    }
    default:
      return null;
  }
}

/**
 * Pick the `pairux://` argument out of a process argv.
 *
 * Windows and Linux deliver deep links as a command-line argument — on a cold
 * start in our own argv, on a warm one in the `second-instance` payload.
 */
export function findDeepLinkArg(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (/^pairux:/i.test(arg)) return arg;
  }
  return null;
}

let pendingPath: string | null = null;
let targetWindow: BrowserWindow | null = null;

function send(path: string): boolean {
  if (!targetWindow || targetWindow.isDestroyed()) return false;
  if (targetWindow.webContents.isLoading()) return false;
  targetWindow.webContents.send('navigate', path);
  if (targetWindow.isMinimized()) targetWindow.restore();
  targetWindow.show();
  targetWindow.focus();
  return true;
}

/** Route a deep link now, or hold it until the renderer is up. */
export function handleDeepLink(url: string): void {
  const path = parseDeepLink(url);
  if (!path) {
    console.warn('[DeepLink] Ignoring unrecognised link:', url);
    return;
  }
  console.log('[DeepLink] ->', path);
  if (!send(path)) pendingPath = path;
}

/**
 * Attach the window that deep links navigate, and flush anything that arrived
 * before it existed — a cold start opens the app *and* the link at once, so the
 * link almost always lands first.
 */
export function setDeepLinkWindow(window: BrowserWindow | null): void {
  targetWindow = window;
  if (!window || pendingPath === null) return;

  const flush = (): void => {
    const path = pendingPath;
    pendingPath = null;
    if (path !== null) send(path);
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', flush);
  } else {
    flush();
  }
}

/**
 * Claim `pairux://` for this app.
 *
 * In development Electron runs as `electron <project>`, so the registration has
 * to repeat those arguments or the OS launches a bare Electron with no app.
 */
export function registerProtocolClient(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PAIRUX_PROTOCOL, process.execPath, [resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(PAIRUX_PROTOCOL);
    }
  } catch (error) {
    console.warn('[DeepLink] Could not register the pairux:// handler:', error);
  }
}
