import { ipcMain, clipboard, BrowserWindow } from 'electron';
import {
  setTraySession,
  setTrayStatus,
  getTrayStatus,
  getTraySession,
  showTrayNotification,
  flashTrayIcon,
  type SessionInfo,
  type TrayStatus,
} from '../tray';

export function registerTrayHandlers(): void {
  console.log('[IPC] Registering tray handlers');

  // Update session info in tray
  ipcMain.handle(
    'tray:setSession',
    (_event, args: { session: SessionInfo | null }): { success: boolean } => {
      setTraySession(args.session);
      return { success: true };
    }
  );

  // Update tray status directly
  ipcMain.handle('tray:setStatus', (_event, args: { status: TrayStatus }): { success: boolean } => {
    setTrayStatus(args.status);
    return { success: true };
  });

  // Get current tray status
  ipcMain.handle('tray:getStatus', (): { status: TrayStatus; session: SessionInfo | null } => {
    return {
      status: getTrayStatus(),
      session: getTraySession(),
    };
  });

  // Copy join code to clipboard
  ipcMain.handle(
    'tray:copyJoinCode',
    (_event, args: { joinCode: string }): { success: boolean } => {
      clipboard.writeText(args.joinCode);
      return { success: true };
    }
  );

  // Show notification (Windows balloon or system notification)
  ipcMain.handle(
    'tray:notify',
    (_event, args: { title: string; content: string }): { success: boolean } => {
      showTrayNotification(args.title, args.content);
      return { success: true };
    }
  );

  // Flash tray icon to get attention
  ipcMain.handle('tray:flash', (): { success: boolean } => {
    flashTrayIcon();
    return { success: true };
  });

  // Minimize to tray
  ipcMain.handle('tray:minimize', (): { success: boolean } => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].hide();
    }
    return { success: true };
  });

  console.log('[IPC] Tray handlers registered');
}
