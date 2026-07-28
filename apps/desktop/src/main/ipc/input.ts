/**
 * IPC handlers for input injection
 */

import { ipcMain, globalShortcut, app } from 'electron';
import type { InputEvent } from '@pairux/shared-types';
import { showRemoteCursor, hideRemoteCursor, destroyRemoteCursor } from '../overlay/cursorOverlay';
import { reportDaemonState } from '../daemon';
import { getTailscaleState, checkTailnetPath } from '../daemon/tailscale';
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
      destroyRemoteCursor();
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
  // Paint the guest's cursor on the host's desktop, outside the app window.
  ipcMain.handle(
    'overlay:remoteCursor',
    (_event, args: { x: number; y: number; name: string; visible: boolean }) => {
      if (args.visible) showRemoteCursor(args.x, args.y, args.name);
      else hideRemoteCursor();
      return { success: true };
    }
  );

  // The renderer owns capture/session state; main mirrors it so the daemon's
  // HTTP endpoints can answer without a round trip.
  ipcMain.handle(
    'daemon:reportState',
    (
      _event,
      args: {
        sharing: boolean;
        sessionId: string | null;
        joinCode: string | null;
        url: string | null;
      }
    ) => {
      reportDaemonState(args);
      return { success: true };
    }
  );

  // M1 of "media over Tailscale": report only. Tells us whether a direct
  // WireGuard path between peers even exists before anything is changed about
  // how media is routed.
  // M2: offer tailnet candidates, but only while a session that can use them
  // is running. The restrictive default exists to stop a multi-homed host
  // offering candidates on a dead NIC, so the relaxation is scoped and undone.
  ipcMain.handle('webrtc:setIpPolicy', async (_event, args: { allowPrivate: boolean }) => {
    const { BrowserWindow } = await import('electron');
    const policy = args.allowPrivate
      ? 'default_public_and_private_interfaces'
      : 'default_public_interface_only';

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.setWebRTCIPHandlingPolicy(policy);
    }

    console.log('[WebRTC] IP handling policy set to', policy);
    return { success: true, policy };
  });

  ipcMain.handle('tailscale:info', async () => {
    const state = await getTailscaleState();
    return { connected: state.connected, ips: state.ips, reason: state.reason ?? null };
  });

  ipcMain.handle('tailscale:checkPath', async (_event, args: { ip: string }) => {
    return checkTailnetPath(args.ip);
  });

  ipcMain.handle('overlay:clearRemoteCursor', () => {
    destroyRemoteCursor();
    return { success: true };
  });

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
    destroyRemoteCursor();
    void disposeInputInjector();
  });

  console.log('[IPC:Input] Input handlers registered');
}
