/**
 * Draws a remote participant's cursor on the host's actual desktop.
 *
 * The in-app overlay can only paint inside the PairUX window, so a guest's
 * cursor vanished the moment it left the video preview. This is a transparent,
 * click-through, always-on-top window covering the screen, so the second cursor
 * is visible wherever the guest points.
 *
 * SAFETY: a fullscreen always-on-top window that failed to be click-through
 * would lock the user out of their own desktop. So it is created hidden,
 * made click-through and non-focusable before it is ever shown, exists only
 * while a guest holds control, and is destroyed by emergency revoke.
 */

import { BrowserWindow, screen } from 'electron';
import { detectDisplayServer } from '../platform';

let overlay: BrowserWindow | null = null;

/**
 * Whether a desktop-wide overlay can be shown safely on this display server.
 *
 * False on Wayland, because Electron documents the operations this window is
 * built out of as unsupported there:
 *
 *   - `showInactive()` — "Not supported on Wayland (Linux)". This is the one
 *     that matters. It is how the overlay appears *without* taking focus; with
 *     it unavailable there is no way to put a fullscreen always-on-top window
 *     on screen and be sure it has not grabbed the user's input.
 *   - `setPosition()` — "Not supported on Wayland (Linux)", and `getBounds()`
 *     reports `{ x: 0, y: 0 }`, so the window cannot be reliably placed.
 *   - the `level` argument to `setAlwaysOnTop` is documented macOS/Windows only.
 *
 * More generally: "On Wayland (Linux) it is generally not possible to
 * programmatically resize windows after creation, or to position, move, focus,
 * or blur windows without user input."
 *
 * The failure mode if we show it anyway is the worst one this app has — a
 * fullscreen window over the host's desktop that takes input they cannot get
 * back. The in-app cursor still draws inside the PairUX window, so the guest's
 * pointer stays visible where the video is; only the desktop-wide overlay is
 * given up.
 *
 * https://www.electronjs.org/docs/latest/api/browser-window
 */
export function canShowDesktopOverlay(displayServer: string): boolean {
  return displayServer !== 'wayland';
}

/** Escape hatch, in case a compositor mishandles a click-through window. */
function isDisabled(): boolean {
  if (process.env.PAIRUX_DISABLE_CURSOR_OVERLAY === '1') return true;
  return !canShowDesktopOverlay(detectDisplayServer());
}

function buildHtml(): string {
  // Self-contained: no file to package, nothing to load over a protocol.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
        pointer-events: none;
      }
      #cursor {
        position: absolute;
        top: 0;
        left: 0;
        transform: translate(-9999px, -9999px);
        will-change: transform;
        pointer-events: none;
        display: flex;
        align-items: flex-start;
        gap: 4px;
      }
      #label {
        font: 12px system-ui, sans-serif;
        color: #fff;
        background: #f5b800;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        transform: translateY(14px);
      }
    </style>
  </head>
  <body>
    <div id="cursor">
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
        <path d="M2 1 L2 18 L7 13 L10 21 L13 20 L10 12 L17 12 Z"
              fill="#f5b800" stroke="#4a3600" stroke-width="1.5" />
      </svg>
      <div id="label"></div>
    </div>
    <script>
      const el = document.getElementById('cursor');
      const label = document.getElementById('label');
      window.addEventListener('message', (event) => {
        const d = event.data;
        if (!d || d.type !== 'cursor') return;
        if (!d.visible) {
          el.style.transform = 'translate(-9999px, -9999px)';
          return;
        }
        label.textContent = d.name || '';
        el.style.transform = 'translate(' + d.x + 'px, ' + d.y + 'px)';
      });
    </script>
  </body>
</html>`;
}

function create(): BrowserWindow | null {
  if (isDisabled()) return null;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    // Created hidden: nothing is shown until it is provably inert.
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    acceptFirstMouse: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // Before showing: never take a single click from the user.
  win.setIgnoreMouseEvents(true, { forward: false });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml())}`);

  win.on('closed', () => {
    overlay = null;
  });

  return win;
}

/**
 * Move the guest's cursor to a point on the host's screen.
 *
 * Coordinates are normalized 0-1 so callers never deal with display geometry.
 */
export function showRemoteCursor(x: number, y: number, name: string): void {
  if (isDisabled()) return;

  overlay ??= create();
  if (!overlay || overlay.isDestroyed()) return;

  const { width, height } = screen.getPrimaryDisplay().bounds;
  const px = Math.round(Math.min(1, Math.max(0, x)) * width);
  const py = Math.round(Math.min(1, Math.max(0, y)) * height);

  if (!overlay.isVisible()) {
    // showInactive: never steal focus from what the host is doing.
    overlay.showInactive();
  }

  overlay.webContents
    .executeJavaScript(
      `window.postMessage(${JSON.stringify({ type: 'cursor', visible: true, x: px, y: py, name })}, '*')`,
      true
    )
    .catch(() => {
      // The window can go away mid-flight; nothing to recover.
    });
}

export function hideRemoteCursor(): void {
  if (!overlay || overlay.isDestroyed()) return;

  overlay.webContents
    .executeJavaScript(
      `window.postMessage(${JSON.stringify({ type: 'cursor', visible: false })}, '*')`,
      true
    )
    .catch(() => {
      // Ignore — the window is being torn down.
    });
}

/** Remove the overlay entirely. Used when control ends and on revoke. */
export function destroyRemoteCursor(): void {
  if (overlay && !overlay.isDestroyed()) {
    overlay.destroy();
  }
  overlay = null;
}
