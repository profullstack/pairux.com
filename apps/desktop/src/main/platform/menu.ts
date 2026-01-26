/**
 * macOS Menu Bar Integration
 * Creates native application menu following macOS HIG
 */

import { app, Menu, shell, BrowserWindow } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { APP_URL } from '../../shared/config';

export interface MenuCallbacks {
  onAbout: () => void;
  onPreferences: () => void;
  onNewSession: () => void;
  onEndSession: () => void;
  onCheckForUpdates?: () => void;
}

let menuCallbacks: MenuCallbacks | null = null;

/**
 * Get the focused window or first available window
 */
function getFocusedWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;

  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Build the macOS application menu
 */
function buildMacOSMenu(): MenuItemConstructorOptions[] {
  const appName = app.getName();

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      {
        label: `About ${appName}`,
        role: 'about',
        click: () => menuCallbacks?.onAbout(),
      },
      { type: 'separator' },
      {
        label: 'Preferences...',
        accelerator: 'Cmd+,',
        click: () => menuCallbacks?.onPreferences(),
      },
      { type: 'separator' },
      {
        label: 'Services',
        role: 'services',
        submenu: [],
      },
      { type: 'separator' },
      {
        label: `Hide ${appName}`,
        role: 'hide',
      },
      {
        label: 'Hide Others',
        role: 'hideOthers',
      },
      {
        label: 'Show All',
        role: 'unhide',
      },
      { type: 'separator' },
      {
        label: `Quit ${appName}`,
        role: 'quit',
      },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Session',
        accelerator: 'Cmd+N',
        click: () => menuCallbacks?.onNewSession(),
      },
      { type: 'separator' },
      {
        label: 'End Session',
        accelerator: 'Cmd+W',
        click: () => menuCallbacks?.onEndSession(),
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select All', role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Reload', role: 'reload' },
      { label: 'Force Reload', role: 'forceReload' },
      { type: 'separator' },
      { label: 'Actual Size', role: 'resetZoom' },
      { label: 'Zoom In', role: 'zoomIn' },
      { label: 'Zoom Out', role: 'zoomOut' },
      { type: 'separator' },
      { label: 'Toggle Full Screen', role: 'togglefullscreen' },
    ],
  };

  // Add DevTools in development
  if (!app.isPackaged) {
    (viewMenu.submenu as MenuItemConstructorOptions[]).push(
      { type: 'separator' },
      { label: 'Toggle Developer Tools', role: 'toggleDevTools' }
    );
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { label: 'Minimize', role: 'minimize' },
      { label: 'Zoom', role: 'zoom' },
      { type: 'separator' },
      { label: 'Bring All to Front', role: 'front' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'PairUX Help',
        click: () => {
          void shell.openExternal(`${APP_URL}/docs`);
        },
      },
      {
        label: 'Report an Issue',
        click: () => {
          void shell.openExternal('https://github.com/pairux/pairux/issues');
        },
      },
      { type: 'separator' },
      {
        label: 'View License',
        click: () => {
          void shell.openExternal(`${APP_URL}/license`);
        },
      },
    ],
  };

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
}

/**
 * Build the Windows/Linux application menu
 */
function buildDefaultMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Session',
        accelerator: 'Ctrl+N',
        click: () => menuCallbacks?.onNewSession(),
      },
      { type: 'separator' },
      {
        label: 'Settings',
        accelerator: 'Ctrl+,',
        click: () => menuCallbacks?.onPreferences(),
      },
      { type: 'separator' },
      {
        label: 'Exit',
        role: 'quit',
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select All', role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Reload', role: 'reload' },
      { label: 'Force Reload', role: 'forceReload' },
      { type: 'separator' },
      { label: 'Actual Size', role: 'resetZoom' },
      { label: 'Zoom In', role: 'zoomIn' },
      { label: 'Zoom Out', role: 'zoomOut' },
      { type: 'separator' },
      { label: 'Toggle Full Screen', role: 'togglefullscreen' },
    ],
  };

  // Add DevTools in development
  if (!app.isPackaged) {
    (viewMenu.submenu as MenuItemConstructorOptions[]).push(
      { type: 'separator' },
      { label: 'Toggle Developer Tools', role: 'toggleDevTools' }
    );
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'About PairUX',
        click: () => menuCallbacks?.onAbout(),
      },
      { type: 'separator' },
      {
        label: 'Documentation',
        click: () => {
          void shell.openExternal(`${APP_URL}/docs`);
        },
      },
      {
        label: 'Report an Issue',
        click: () => {
          void shell.openExternal('https://github.com/pairux/pairux/issues');
        },
      },
    ],
  };

  return [fileMenu, editMenu, viewMenu, helpMenu];
}

/**
 * Initialize the application menu
 */
export function initializeMenu(callbacks: MenuCallbacks): void {
  menuCallbacks = callbacks;

  const template = process.platform === 'darwin' ? buildMacOSMenu() : buildDefaultMenu();

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  console.log(`[Menu] Application menu initialized for ${process.platform}`);
}

/**
 * Update menu items dynamically (e.g., enable/disable session-related items)
 */
export function updateMenuState(hasActiveSession: boolean): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  // Find and update the "End Session" item
  const fileMenu = menu.items.find((item) => item.label === 'File');
  if (fileMenu?.submenu) {
    const endSessionItem = fileMenu.submenu.items.find((item) => item.label === 'End Session');
    if (endSessionItem) {
      endSessionItem.enabled = hasActiveSession;
    }
  }
}

/**
 * Show the native About dialog (macOS)
 */
export function showAboutDialog(): void {
  if (process.platform === 'darwin') {
    app.showAboutPanel();
  } else {
    const window = getFocusedWindow();
    if (window) {
      // Navigate to settings/about section
      window.webContents.send('navigate', '/settings');
    }
  }
}
