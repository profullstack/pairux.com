import { ipcMain } from 'electron';
import { getCaptureSources } from '../capture/sources';
import { registerAuthHandlers } from './auth';
import { registerSessionHandlers } from './session';
import { registerChatHandlers } from './chat';
import { registerInputHandlers } from './input';
import { registerPermissionHandlers } from './permissions';
import { registerRecordingHandlers } from './recording';
import { registerStreamingHandlers } from './streaming';
import { registerTrayHandlers } from './tray';
import { registerPlatformHandlers } from './platform';
import type { CaptureSource } from '@pairux/shared-types';

export function registerIpcHandlers(): void {
  console.log('[IPC] Registering IPC handlers');

  // Register auth handlers
  registerAuthHandlers();

  // Register session handlers
  registerSessionHandlers();

  // Register chat handlers
  registerChatHandlers();

  // Register input injection handlers
  registerInputHandlers();

  // Register permission handlers
  registerPermissionHandlers();

  // Register recording handlers
  registerRecordingHandlers();

  // Register streaming handlers
  registerStreamingHandlers();

  // Register tray handlers
  registerTrayHandlers();

  // Register platform handlers
  registerPlatformHandlers();

  // Capture handlers
  ipcMain.handle(
    'capture:getSources',
    async (_event, args: { types: ('screen' | 'window')[] }): Promise<CaptureSource[]> => {
      console.log('[IPC] capture:getSources called with types:', args.types);
      return getCaptureSources(args.types);
    }
  );

  console.log('[IPC] IPC handlers registered');
}
