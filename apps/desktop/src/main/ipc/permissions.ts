/**
 * IPC handlers for permission management
 */

import { ipcMain } from 'electron';
import {
  getPermissionStatus,
  requestAccessibilityPermission,
  requestScreenCapturePermission,
  requestAllPermissions,
} from '../permissions';

/**
 * Register permission-related IPC handlers
 */
export function registerPermissionHandlers(): void {
  console.log('[IPC:Permissions] Registering permission handlers');

  // Get current permission status
  ipcMain.handle('permissions:status', () => {
    return getPermissionStatus();
  });

  // Request accessibility permission
  ipcMain.handle('permissions:requestAccessibility', async () => {
    const granted = await requestAccessibilityPermission();
    return { granted };
  });

  // Request screen capture permission
  ipcMain.handle('permissions:requestScreenCapture', async () => {
    const granted = await requestScreenCapturePermission();
    return { granted };
  });

  // Request all permissions
  ipcMain.handle('permissions:requestAll', async () => {
    return await requestAllPermissions();
  });

  console.log('[IPC:Permissions] Permission handlers registered');
}
