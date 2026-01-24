/**
 * Screen recording module for local file recording
 * Uses MediaRecorder in renderer process with IPC for file operations
 */

import { app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// Recording state
let isRecording = false;
let isPaused = false;
let recordingPath: string | null = null;
let recordingStartTime: number | null = null;
let pausedDuration = 0; // Time spent paused
let pauseStartTime: number | null = null;
let fileHandle: fs.WriteStream | null = null;

/**
 * Get default recordings directory
 */
export function getRecordingsDirectory(): string {
  const videosDir = app.getPath('videos');
  const recordingsDir = path.join(videosDir, 'PairUX Recordings');

  // Ensure directory exists
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  return recordingsDir;
}

/**
 * Generate recording filename with timestamp
 */
function generateFilename(extension = 'webm'): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `PairUX-Recording-${timestamp}.${extension}`;
}

/**
 * Start a new recording session
 */
export function startRecording(options?: { customPath?: string; format?: 'webm' | 'mp4' }): {
  success: boolean;
  path?: string;
  error?: string;
} {
  if (isRecording) {
    return { success: false, error: 'Recording already in progress' };
  }

  try {
    const format = options?.format ?? 'webm';
    let savePath: string;

    if (options?.customPath) {
      savePath = options.customPath;
    } else {
      const recordingsDir = getRecordingsDirectory();
      savePath = path.join(recordingsDir, generateFilename(format));
    }

    // Create write stream
    fileHandle = fs.createWriteStream(savePath);

    recordingPath = savePath;
    recordingStartTime = Date.now();
    isRecording = true;

    console.log(`[Recording] Started recording to: ${savePath}`);
    return { success: true, path: savePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Recording] Failed to start recording:', error);
    return { success: false, error: message };
  }
}

/**
 * Write recording data chunk
 */
export function writeRecordingChunk(chunk: Buffer): boolean {
  if (!isRecording || !fileHandle) {
    return false;
  }

  try {
    fileHandle.write(chunk);
    return true;
  } catch (error) {
    console.error('[Recording] Failed to write chunk:', error);
    return false;
  }
}

/**
 * Stop the current recording
 */
export async function stopRecording(): Promise<{
  success: boolean;
  path?: string;
  duration?: number;
  error?: string;
}> {
  if (!isRecording) {
    return { success: false, error: 'No recording in progress' };
  }

  try {
    const duration = recordingStartTime ? Date.now() - recordingStartTime : 0;
    const savedPath = recordingPath;

    // Close file handle
    if (fileHandle) {
      const handle = fileHandle;
      await new Promise<void>((resolve, reject) => {
        handle.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
      fileHandle = null;
    }

    isRecording = false;
    isPaused = false;
    recordingPath = null;
    recordingStartTime = null;
    pausedDuration = 0;
    pauseStartTime = null;

    console.log(`[Recording] Stopped recording. Duration: ${String(Math.round(duration / 1000))}s`);
    return {
      success: true,
      path: savedPath ?? undefined,
      duration,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Recording] Failed to stop recording:', error);
    return { success: false, error: message };
  }
}

/**
 * Pause the current recording
 */
export function pauseRecording(): { success: boolean; error?: string } {
  if (!isRecording) {
    return { success: false, error: 'No recording in progress' };
  }

  if (isPaused) {
    return { success: false, error: 'Recording already paused' };
  }

  isPaused = true;
  pauseStartTime = Date.now();
  console.log('[Recording] Paused');
  return { success: true };
}

/**
 * Resume a paused recording
 */
export function resumeRecording(): { success: boolean; error?: string } {
  if (!isRecording) {
    return { success: false, error: 'No recording in progress' };
  }

  if (!isPaused) {
    return { success: false, error: 'Recording is not paused' };
  }

  // Add paused duration
  if (pauseStartTime) {
    pausedDuration += Date.now() - pauseStartTime;
  }
  isPaused = false;
  pauseStartTime = null;
  console.log('[Recording] Resumed');
  return { success: true };
}

/**
 * Get current recording status
 */
export function getRecordingStatus(): {
  isRecording: boolean;
  isPaused: boolean;
  path: string | null;
  duration: number | null;
} {
  let duration: number | null = null;
  if (recordingStartTime) {
    duration = Date.now() - recordingStartTime - pausedDuration;
    // If currently paused, subtract the current pause duration
    if (isPaused && pauseStartTime) {
      duration -= Date.now() - pauseStartTime;
    }
  }

  return {
    isRecording,
    isPaused,
    path: recordingPath,
    duration,
  };
}

/**
 * Show save dialog for custom recording path
 */
export async function showSaveDialog(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Save Recording',
    defaultPath: path.join(getRecordingsDirectory(), generateFilename()),
    filters: [
      { name: 'WebM Video', extensions: ['webm'] },
      { name: 'MP4 Video', extensions: ['mp4'] },
    ],
  });

  return result.canceled ? null : (result.filePath as string | null);
}

/**
 * Get available disk space for recordings directory
 */
export function getAvailableDiskSpace(): number {
  try {
    const recordingsDir = getRecordingsDirectory();
    const stats = fs.statfsSync(recordingsDir);
    return stats.bavail * stats.bsize;
  } catch {
    return -1; // Unknown
  }
}

/**
 * Open recordings folder in file manager
 */
export function openRecordingsFolder(): void {
  void shell.openPath(getRecordingsDirectory());
}
