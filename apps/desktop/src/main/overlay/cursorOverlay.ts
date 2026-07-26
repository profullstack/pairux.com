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

let overlay: BrowserWindow | null = null;

/** Escape hatch, in case a compositor mishandles a click-through window. */
function isDisabled(): boolean {
  return process.env.PAIRUX_DISABLE_CURSOR_OVERLAY === '1';
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
