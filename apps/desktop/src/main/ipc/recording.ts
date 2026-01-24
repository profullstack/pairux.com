/**
 * IPC handlers for screen recording
 */

import { ipcMain } from 'electron';
import {
  startRecording,
  stopRecording,
  writeRecordingChunk,
  getRecordingStatus,
  showSaveDialog,
  getRecordingsDirectory,
  getAvailableDiskSpace,
  openRecordingsFolder,
  pauseRecording,
  resumeRecording,
} from '../recording';

/**
 * Register all recording-related IPC handlers
 */
export function registerRecordingHandlers(): void {
  console.log('[IPC:Recording] Registering recording handlers');

  // Start recording
  ipcMain.handle(
    'recording:start',
    (_event, args?: { customPath?: string; format?: 'webm' | 'mp4' }) => {
      return startRecording(args);
    }
  );

  // Stop recording
  ipcMain.handle('recording:stop', async () => {
    return stopRecording();
  });

  // Write recording chunk (from renderer's MediaRecorder)
  ipcMain.handle('recording:writeChunk', (_event, chunk: ArrayBuffer) => {
    const buffer = Buffer.from(chunk);
    const success = writeRecordingChunk(buffer);
    return { success };
  });

  // Get recording status
  ipcMain.handle('recording:status', () => {
    return getRecordingStatus();
  });

  // Show save dialog
  ipcMain.handle('recording:showSaveDialog', async () => {
    const path = await showSaveDialog();
    return { path };
  });

  // Get recordings directory
  ipcMain.handle('recording:getDirectory', () => {
    return { path: getRecordingsDirectory() };
  });

  // Get available disk space
  ipcMain.handle('recording:getAvailableSpace', () => {
    const bytes = getAvailableDiskSpace();
    return { bytes, gb: bytes > 0 ? Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10 : -1 };
  });

  // Open recordings folder
  ipcMain.handle('recording:openFolder', () => {
    openRecordingsFolder();
    return { success: true };
  });

  // Pause recording
  ipcMain.handle('recording:pause', () => {
    return pauseRecording();
  });

  // Resume recording
  ipcMain.handle('recording:resume', () => {
    return resumeRecording();
  });

  console.log('[IPC:Recording] Recording handlers registered');
}
