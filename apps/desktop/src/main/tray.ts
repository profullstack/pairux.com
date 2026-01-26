import type { MenuItemConstructorOptions } from 'electron';
import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

export type TrayStatus = 'idle' | 'active' | 'paused' | 'error';

export interface SessionInfo {
  id: string;
  joinCode: string;
  participantCount: number;
  status: 'created' | 'active' | 'paused' | 'ended';
  role: 'host' | 'viewer';
}

interface TrayCallbacks {
  onShowWindow: () => void;
  onEndSession: () => void;
  onTogglePause: () => void;
  onCopyJoinCode: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let currentStatus: TrayStatus = 'idle';
let currentSession: SessionInfo | null = null;
let callbacks: TrayCallbacks | null = null;

/**
 * Create a simple colored circle icon for the tray
 * Uses nativeImage to create platform-appropriate icons
 */
function createTrayIcon(status: TrayStatus): Electron.NativeImage {
  // Try to load custom icons from resources first
  const resourcePath = app.isPackaged
    ? join(process.resourcesPath, 'icons')
    : join(__dirname, '../../resources/icons');

  const iconMap: Record<TrayStatus, string> = {
    idle: 'tray-idle.png',
    active: 'tray-active.png',
    paused: 'tray-paused.png',
    error: 'tray-error.png',
  };

  const iconPath = join(resourcePath, iconMap[status]);

  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }

  // Fallback: create simple colored circle icons programmatically
  const size = process.platform === 'darwin' ? 22 : 16;
  const colors: Record<TrayStatus, string> = {
    idle: '#6b7280', // Gray
    active: '#22c55e', // Green
    paused: '#f59e0b', // Amber
    error: '#ef4444', // Red
  };

  const color = colors[status];

  // Create a simple SVG circle
  const cx = String(size / 2);
  const cy = String(size / 2);
  const outerR = String(size / 2 - 1);
  const innerR = String(size / 4);
  const svg = `
    <svg width="${String(size)}" height="${String(size)}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${color}"/>
      <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="white"/>
    </svg>
  `;

  const buffer = Buffer.from(svg);
  return nativeImage.createFromBuffer(buffer);
}

/**
 * Build the context menu based on current state
 */
function buildContextMenu(): Menu {
  const menuItems: MenuItemConstructorOptions[] = [];

  // App name header
  menuItems.push({
    label: 'PairUX',
    enabled: false,
  });

  menuItems.push({ type: 'separator' });

  // Session status section
  if (currentSession) {
    const statusLabel =
      currentSession.status === 'active'
        ? '● Session Active'
        : currentSession.status === 'paused'
          ? '◐ Session Paused'
          : '○ Session Inactive';

    menuItems.push({
      label: statusLabel,
      enabled: false,
    });

    menuItems.push({
      label: `Join Code: ${currentSession.joinCode}`,
      click: () => callbacks?.onCopyJoinCode(),
      toolTip: 'Click to copy',
    });

    menuItems.push({
      label: `Participants: ${String(currentSession.participantCount)}`,
      enabled: false,
    });

    menuItems.push({
      label: `Role: ${currentSession.role === 'host' ? 'Host' : 'Viewer'}`,
      enabled: false,
    });

    menuItems.push({ type: 'separator' });

    // Session actions
    if (currentSession.role === 'host') {
      const isPaused = currentSession.status === 'paused';
      menuItems.push({
        label: isPaused ? 'Resume Session' : 'Pause Session',
        click: () => callbacks?.onTogglePause(),
      });

      menuItems.push({
        label: 'End Session',
        click: () => callbacks?.onEndSession(),
      });
    }

    menuItems.push({ type: 'separator' });
  } else {
    menuItems.push({
      label: 'No active session',
      enabled: false,
    });

    menuItems.push({ type: 'separator' });
  }

  // Window actions
  menuItems.push({
    label: 'Show Window',
    click: () => callbacks?.onShowWindow(),
  });

  menuItems.push({ type: 'separator' });

  // Quit
  menuItems.push({
    label: 'Quit PairUX',
    click: () => callbacks?.onQuit(),
  });

  return Menu.buildFromTemplate(menuItems);
}

/**
 * Update the tray tooltip based on current state
 */
function updateTooltip(): void {
  if (!tray) return;

  let tooltip = 'PairUX';

  if (currentSession) {
    const statusText =
      currentSession.status === 'active'
        ? 'Active'
        : currentSession.status === 'paused'
          ? 'Paused'
          : currentSession.status;

    tooltip = `PairUX - Session ${statusText} (${String(currentSession.participantCount)} participant${currentSession.participantCount !== 1 ? 's' : ''})`;
  }

  tray.setToolTip(tooltip);
}

/**
 * Initialize the system tray
 */
export function initializeTray(trayCallbacks: TrayCallbacks): Tray {
  callbacks = trayCallbacks;

  const icon = createTrayIcon('idle');
  tray = new Tray(icon);

  tray.setContextMenu(buildContextMenu());
  updateTooltip();

  // Double-click to show window (Windows/Linux)
  tray.on('double-click', () => {
    callbacks?.onShowWindow();
  });

  console.log('[Tray] System tray initialized');

  return tray;
}

/**
 * Update the tray status indicator
 */
export function setTrayStatus(status: TrayStatus): void {
  if (!tray) return;

  currentStatus = status;
  const icon = createTrayIcon(status);
  tray.setImage(icon);

  console.log(`[Tray] Status updated to: ${status}`);
}

/**
 * Update the session information displayed in the tray
 */
export function setTraySession(session: SessionInfo | null): void {
  currentSession = session;

  // Update status based on session
  if (!session) {
    setTrayStatus('idle');
  } else if (session.status === 'active') {
    setTrayStatus('active');
  } else if (session.status === 'paused') {
    setTrayStatus('paused');
  } else {
    setTrayStatus('idle');
  }

  // Rebuild context menu
  if (tray) {
    tray.setContextMenu(buildContextMenu());
    updateTooltip();
  }

  console.log(`[Tray] Session updated:`, session ? `${session.id} (${session.status})` : 'null');
}

/**
 * Get the current tray status
 */
export function getTrayStatus(): TrayStatus {
  return currentStatus;
}

/**
 * Get the current session info
 */
export function getTraySession(): SessionInfo | null {
  return currentSession;
}

/**
 * Destroy the tray icon and reset state
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('[Tray] System tray destroyed');
  }
  // Reset state
  currentStatus = 'idle';
  currentSession = null;
  callbacks = null;
}

/**
 * Check if tray is initialized
 */
export function isTrayInitialized(): boolean {
  return tray !== null;
}

/**
 * Show a balloon notification (Windows only)
 */
export function showTrayNotification(title: string, content: string): void {
  if (!tray) return;

  // Balloon notifications only work on Windows
  if (process.platform === 'win32') {
    tray.displayBalloon({
      title,
      content,
      iconType: 'info',
    });
  }
}

/**
 * Flash the tray icon to get user attention
 */
export function flashTrayIcon(): void {
  if (!tray) return;

  // Flash between current status and idle
  const originalStatus = currentStatus;
  let flashCount = 0;
  const maxFlashes = 6;

  const flashInterval = setInterval(() => {
    if (flashCount >= maxFlashes) {
      clearInterval(flashInterval);
      setTrayStatus(originalStatus);
      return;
    }

    setTrayStatus(flashCount % 2 === 0 ? 'idle' : originalStatus);
    flashCount++;
  }, 300);
}
