/**
 * IPC handlers for input injection
 */

import { ipcMain, globalShortcut, app } from 'electron';
import type { InputEvent } from '@pairux/shared-types';
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
function registerEmergencyShortcut(): boolean {
  if (emergencyShortcutRegistered) return true;

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
    return true;
  } else {
    console.warn('[IPC:Input] Failed to register emergency shortcut');
    return false;
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
    const injectionEnabled = enableInjection();
    const emergencyStopReady = injectionEnabled && registerEmergencyShortcut();
    if (injectionEnabled && !emergencyStopReady) {
      // Direct control owns the host's real pointer. Never start it unless the
      // host has a verified, global way to stop a stuck guest input stream.
      disableInjection();
    }
    const diagnostics = getInjectionDiagnostics();
    const enabled = emergencyStopReady && diagnostics.enabled;
    return { success: enabled, ...diagnostics, enabled };
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

  // Cleanup on app quit.
  //
  // This must block. Releasing a held mouse button is asynchronous, and a
  // button still down when the process exits stays down for the whole OS
  // session — the host is left unable to click anything and has to reboot.
  // Fire-and-forget here loses that release every time.
  let quitCleanupStarted = false;
  app.on('will-quit', (event) => {
    if (quitCleanupStarted) return;
    quitCleanupStarted = true;
    event.preventDefault();

    unregisterEmergencyShortcut();
    // Bounded, so a wedged backend cannot make the app unquittable.
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    void Promise.race([disposeInputInjector(), deadline])
      .catch((error: unknown) => {
        console.error('[IPC:Input] Cleanup on quit failed', error);
      })
      .finally(() => {
        app.exit(0);
      });
  });

  console.log('[IPC:Input] Input handlers registered');
}
