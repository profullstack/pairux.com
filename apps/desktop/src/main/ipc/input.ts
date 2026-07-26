/**
 * IPC handlers for input injection
 */

import { ipcMain, globalShortcut, app } from 'electron';
import type { InputEvent } from '@pairux/shared-types';
import {
  initInputInjector,
  injectInput,
  enableInjection,
  disableInjection,
  getInjectionDiagnostics,
  updateScreenSize,
  emergencyStop,
  disposeInputInjector,
} from '../input/injector';

// Track if emergency shortcut is registered
let emergencyShortcutRegistered = false;

/**
 * Register emergency revoke hotkey (Ctrl+Shift+Escape)
 */
function registerEmergencyShortcut(): void {
  if (emergencyShortcutRegistered) return;

  const registered = globalShortcut.register('CommandOrControl+Shift+Escape', () => {
    console.log('[IPC:Input] Emergency revoke hotkey triggered');
    void (async () => {
      await emergencyStop();
      // Notify renderer
      const { BrowserWindow } = await import('electron');
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('input:emergency-stop');
      }
    })();
  });

  if (registered) {
    emergencyShortcutRegistered = true;
    console.log('[IPC:Input] Emergency shortcut registered (Ctrl+Shift+Escape)');
  } else {
    console.warn('[IPC:Input] Failed to register emergency shortcut');
  }
}

/**
 * Unregister emergency shortcut
 */
function unregisterEmergencyShortcut(): void {
  if (!emergencyShortcutRegistered) return;
  globalShortcut.unregister('CommandOrControl+Shift+Escape');
  emergencyShortcutRegistered = false;
  console.log('[IPC:Input] Emergency shortcut unregistered');
}

/**
 * Register all input-related IPC handlers
 */
export function registerInputHandlers(): void {
  console.log('[IPC:Input] Registering input handlers');

  // Initialize input injector
  ipcMain.handle('input:init', async () => {
    await initInputInjector();
    return { success: true };
  });

  // Enable input injection (when control is granted to a viewer)
  ipcMain.handle('input:enable', () => {
    enableInjection();
    registerEmergencyShortcut();
    const diagnostics = getInjectionDiagnostics();
    return { success: true, ...diagnostics };
  });

  // Disable input injection (when control is revoked)
  ipcMain.handle('input:disable', () => {
    disableInjection();
    // Keep emergency shortcut registered while app is running
    return { success: true, enabled: false };
  });

  // Check if injection is enabled
  ipcMain.handle('input:status', () => {
    return getInjectionDiagnostics();
  });

  // Update screen size (when capture source changes)
  ipcMain.handle('input:updateScreenSize', (_event, args: { width: number; height: number }) => {
    updateScreenSize(args.width, args.height);
    return { success: true };
  });

  // Inject input event - this is the main handler called frequently
  ipcMain.handle('input:inject', async (_event, args: { event: InputEvent }) => {
    await injectInput(args.event);
    return { success: true };
  });

  // Batch inject multiple events (for better performance)
  ipcMain.handle('input:injectBatch', async (_event, args: { events: InputEvent[] }) => {
    for (const event of args.events) {
      await injectInput(event);
    }
    return { success: true, count: args.events.length };
  });

  // Emergency stop - release all keys/buttons and disable injection
  ipcMain.handle('input:emergencyStop', async () => {
    await emergencyStop();
    return { success: true };
  });

  // Cleanup on app quit
  app.on('will-quit', () => {
    unregisterEmergencyShortcut();
    void disposeInputInjector();
  });

  console.log('[IPC:Input] Input handlers registered');
}
