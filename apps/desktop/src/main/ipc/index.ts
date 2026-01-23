import { ipcMain } from 'electron';
import { getCaptureSources } from '../capture/sources';
import { registerAuthHandlers } from './auth';
import { registerSessionHandlers } from './session';
import { registerChatHandlers } from './chat';
import type { CaptureSource } from '@pairux/shared-types';

// Detect display server
const isWayland =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY !== undefined);

export function registerIpcHandlers(): void {
  console.log('[IPC] Registering IPC handlers');

  // Register auth handlers
  registerAuthHandlers();

  // Register session handlers
  registerSessionHandlers();

  // Register chat handlers
  registerChatHandlers();

  // Capture handlers
  ipcMain.handle(
    'capture:getSources',
    async (_event, args: { types: ('screen' | 'window')[] }): Promise<CaptureSource[]> => {
      console.log('[IPC] capture:getSources called with types:', args.types);
      return getCaptureSources(args.types);
    }
  );

  // Platform info including display server
  ipcMain.handle('platform:info', () => {
    let displayServer: 'x11' | 'wayland' | 'windows' | 'macos' = 'x11';
    if (process.platform === 'win32') {
      displayServer = 'windows';
    } else if (process.platform === 'darwin') {
      displayServer = 'macos';
    } else if (isWayland) {
      displayServer = 'wayland';
    }

    return {
      platform: process.platform,
      arch: process.arch,
      version: process.versions.electron,
      displayServer,
      isWayland,
    };
  });

  console.log('[IPC] IPC handlers registered');
}
