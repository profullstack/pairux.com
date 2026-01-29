/**
 * RTMP streaming module - manages ffmpeg child processes for live streaming
 */

import { type ChildProcess, spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { app, type BrowserWindow } from 'electron';
import type { RTMPDestinationInfo, RTMPStreamState, EncoderSettings } from '../../preload/api';

// undefined = not resolved yet, null = resolved but not found, string = path
let _ffmpegPath: string | null | undefined = undefined;

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY = 2000;

interface ActiveStream {
  process: ChildProcess;
  state: RTMPStreamState;
  destination: RTMPDestinationInfo;
  streamKey: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  statsBuffer: string;
  stableTimer: ReturnType<typeof setTimeout> | null;
  intentionallyStopped: boolean;
}

const activeStreams = new Map<string, ActiveStream>();
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

function sendEvent(event: string, data: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(event, data);
  }
}

/**
 * Resolve ffmpeg binary path using a cascade:
 * 1. Installer-provisioned: ~/.pairux/bin/ffmpeg (or %LOCALAPPDATA%\PairUX\bin\ffmpeg.exe)
 * 2. System PATH: which ffmpeg / where ffmpeg
 * 3. Dev-only fallback: @ffmpeg-installer/ffmpeg npm package
 * Returns null if ffmpeg is not available.
 */
export function getFFmpegPath(): string | null {
  if (_ffmpegPath !== undefined) {
    return _ffmpegPath;
  }

  // 1. Check installer-provisioned path
  const installerPath =
    process.platform === 'win32'
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
          'PairUX',
          'bin',
          'ffmpeg.exe'
        )
      : join(homedir(), '.pairux', 'bin', 'ffmpeg');

  if (existsSync(installerPath)) {
    _ffmpegPath = installerPath;
    console.log(`[Streaming] Using installer ffmpeg: ${installerPath}`);
    return _ffmpegPath;
  }

  // 2. Check system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
    if (result && existsSync(result)) {
      _ffmpegPath = result;
      console.log(`[Streaming] Using system ffmpeg: ${result}`);
      return _ffmpegPath;
    }
  } catch {
    // Not found in PATH
  }

  // 3. Dev-only fallback: @ffmpeg-installer/ffmpeg npm package
  if (!app.isPackaged) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string };
      _ffmpegPath = ffmpegInstaller.path;
      console.log(`[Streaming] Using npm ffmpeg: ${_ffmpegPath}`);
      return _ffmpegPath;
    } catch {
      // Package not available
    }
  }

  console.warn('[Streaming] ffmpeg not found — streaming features will be unavailable');
  _ffmpegPath = null;
  return null;
}

function getResolution(resolution: '720p' | '1080p'): string {
  return resolution === '720p' ? '1280x720' : '1920x1080';
}

function buildFFmpegArgs(settings: EncoderSettings, rtmpUrl: string, streamKey: string): string[] {
  const gopSize = settings.framerate * settings.keyframeInterval;
  const destination = `${rtmpUrl}/${streamKey}`;

  return [
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-b:v',
    `${String(settings.videoBitrate)}k`,
    '-maxrate',
    `${String(Math.round(settings.videoBitrate * 1.1))}k`,
    '-bufsize',
    `${String(settings.videoBitrate * 2)}k`,
    '-r',
    String(settings.framerate),
    '-g',
    String(gopSize),
    '-s',
    getResolution(settings.resolution),
    '-c:a',
    'aac',
    '-b:a',
    `${String(settings.audioBitrate)}k`,
    '-ar',
    '44100',
    '-f',
    'flv',
    destination,
  ];
}

function parseFFmpegStats(line: string): { fps: number; bitrate: number } | null {
  const fpsMatch = /fps=\s*([\d.]+)/.exec(line);
  const bitrateMatch = /bitrate=\s*([\d.]+)kbits/.exec(line);

  if (fpsMatch && bitrateMatch) {
    return {
      fps: parseFloat(fpsMatch[1]),
      bitrate: parseFloat(bitrateMatch[1]),
    };
  }
  return null;
}

function isAuthError(stderr: string): boolean {
  const authPatterns = ['401', '403', 'Unauthorized', 'Authentication', 'auth'];
  return authPatterns.some((p) => stderr.toLowerCase().includes(p.toLowerCase()));
}

function updateStreamState(destinationId: string, updates: Partial<RTMPStreamState>): void {
  const stream = activeStreams.get(destinationId);
  if (!stream) return;

  Object.assign(stream.state, updates);

  if (updates.status !== undefined) {
    sendEvent('rtmp:streamStatusChanged', {
      destinationId,
      status: updates.status,
      error: updates.error,
    });
  }
}

function attemptReconnect(destinationId: string): void {
  const stream = activeStreams.get(destinationId);
  if (!stream || stream.intentionallyStopped) return;

  if (stream.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    updateStreamState(destinationId, {
      status: 'error',
      error: `Failed after ${String(MAX_RECONNECT_ATTEMPTS)} reconnection attempts`,
    });
    sendEvent('rtmp:streamError', {
      destinationId,
      error: `Failed after ${String(MAX_RECONNECT_ATTEMPTS)} reconnection attempts`,
      isRecoverable: false,
    });
    return;
  }

  const attempt = stream.state.reconnectAttempts + 1;
  const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt - 1);

  updateStreamState(destinationId, {
    status: 'reconnecting',
    reconnectAttempts: attempt,
  });

  console.log(
    `[Streaming] Reconnecting ${stream.destination.name} (attempt ${String(attempt)}/${String(MAX_RECONNECT_ATTEMPTS)}) in ${String(delay)}ms`
  );

  stream.reconnectTimer = setTimeout(() => {
    const currentStream = activeStreams.get(destinationId);
    if (!currentStream || currentStream.intentionallyStopped) return;

    // Re-spawn ffmpeg
    const result = spawnFFmpeg(
      currentStream.destination,
      currentStream.streamKey,
      currentStream.state.reconnectAttempts
    );
    if (!result.success) {
      sendEvent('rtmp:streamError', {
        destinationId,
        error: result.error ?? 'Failed to restart stream',
        isRecoverable: false,
      });
    }
  }, delay);
}

function spawnFFmpeg(
  destination: RTMPDestinationInfo,
  streamKey: string,
  reconnectAttempts = 0
): { success: boolean; error?: string } {
  try {
    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      return {
        success: false,
        error: 'ffmpeg is not installed. Please reinstall PairUX or install ffmpeg manually.',
      };
    }
    const args = buildFFmpegArgs(destination.encoderSettings, destination.rtmpUrl, streamKey);

    const proc = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const streamState: RTMPStreamState = {
      destinationId: destination.id,
      status: 'connecting',
      startTime: Date.now(),
      duration: 0,
      bitrate: 0,
      fps: 0,
      reconnectAttempts,
      error: null,
    };

    const activeStream: ActiveStream = {
      process: proc,
      state: streamState,
      destination,
      streamKey,
      reconnectTimer: null,
      statsBuffer: '',
      stableTimer: null,
      intentionallyStopped: false,
    };

    activeStreams.set(destination.id, activeStream);

    // Monitor stderr for stats and errors
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      activeStream.statsBuffer += text;

      // Check for successful connection
      if (
        activeStream.state.status === 'connecting' &&
        (text.includes('Output #0') || text.includes('frame='))
      ) {
        updateStreamState(destination.id, { status: 'live' });

        // Reset reconnect counter after 60s of stable connection
        activeStream.stableTimer = setTimeout(() => {
          updateStreamState(destination.id, { reconnectAttempts: 0 });
        }, 60000);
      }

      // Parse stats
      const stats = parseFFmpegStats(text);
      if (stats) {
        const duration = activeStream.state.startTime
          ? Math.floor((Date.now() - activeStream.state.startTime) / 1000)
          : 0;

        updateStreamState(destination.id, {
          bitrate: stats.bitrate,
          fps: stats.fps,
          duration,
        });

        sendEvent('rtmp:streamStats', {
          destinationId: destination.id,
          bitrate: stats.bitrate,
          fps: stats.fps,
          duration,
        });
      }
    });

    proc.on('error', (error) => {
      console.error(`[Streaming] ffmpeg error for ${destination.name}:`, error.message);
      updateStreamState(destination.id, {
        status: 'error',
        error: error.message,
      });
    });

    proc.on('exit', (code, signal) => {
      const stream = activeStreams.get(destination.id);
      if (!stream) return;

      if (stream.stableTimer) clearTimeout(stream.stableTimer);

      if (stream.intentionallyStopped) {
        updateStreamState(destination.id, { status: 'stopped' });
        activeStreams.delete(destination.id);
        return;
      }

      console.log(
        `[Streaming] ffmpeg exited for ${destination.name}: code=${String(code)}, signal=${String(signal)}`
      );

      // Don't reconnect on auth errors
      if (isAuthError(stream.statsBuffer)) {
        updateStreamState(destination.id, {
          status: 'error',
          error: 'Authentication failed. Check your stream key.',
        });
        sendEvent('rtmp:streamError', {
          destinationId: destination.id,
          error: 'Authentication failed. Check your stream key.',
          isRecoverable: false,
        });
        activeStreams.delete(destination.id);
        return;
      }

      attemptReconnect(destination.id);
    });

    // Handle stdin errors (broken pipe when ffmpeg closes unexpectedly)
    proc.stdin.on('error', () => {
      // Handled by process exit event
    });

    sendEvent('rtmp:streamStatusChanged', {
      destinationId: destination.id,
      status: 'connecting',
    });

    console.log(`[Streaming] Started ffmpeg for ${destination.name}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Streaming] Failed to start ffmpeg for ${destination.name}:`, message);
    return { success: false, error: message };
  }
}

// --- Public API ---

export function startStream(
  destination: RTMPDestinationInfo,
  streamKey: string
): { success: boolean; error?: string } {
  if (activeStreams.has(destination.id)) {
    return { success: false, error: 'Stream already active for this destination' };
  }
  return spawnFFmpeg(destination, streamKey);
}

export function stopStream(destinationId: string): { success: boolean; error?: string } {
  const stream = activeStreams.get(destinationId);
  if (!stream) {
    return { success: false, error: 'No active stream for this destination' };
  }

  stream.intentionallyStopped = true;

  if (stream.reconnectTimer) clearTimeout(stream.reconnectTimer);
  if (stream.stableTimer) clearTimeout(stream.stableTimer);

  // Graceful shutdown: close stdin then SIGTERM
  try {
    stream.process.stdin?.end();
  } catch {
    // ignore
  }

  setTimeout(() => {
    try {
      stream.process.kill('SIGTERM');
    } catch {
      // ignore
    }
  }, 1000);

  // Force kill after 5 seconds
  setTimeout(() => {
    try {
      stream.process.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 5000);

  console.log(`[Streaming] Stopping stream: ${stream.destination.name}`);
  return { success: true };
}

export function stopAllStreams(): { success: boolean; stopped: number } {
  let stopped = 0;
  for (const [id] of activeStreams) {
    const result = stopStream(id);
    if (result.success) stopped++;
  }
  return { success: true, stopped };
}

export function startAllStreams(
  destinations: RTMPDestinationInfo[],
  streamKeys: Map<string, string>
): { success: boolean; started: number; errors: string[] } {
  let started = 0;
  const errors: string[] = [];

  for (const dest of destinations) {
    const key = streamKeys.get(dest.id);
    if (!key) {
      errors.push(`No stream key for ${dest.name}`);
      continue;
    }

    const result = startStream(dest, key);
    if (result.success) {
      started++;
    } else {
      errors.push(`${dest.name}: ${result.error ?? 'Unknown error'}`);
    }
  }

  return { success: started > 0, started, errors };
}

export function writeStreamChunk(chunk: Buffer): void {
  for (const stream of activeStreams.values()) {
    if (stream.state.status === 'live' || stream.state.status === 'connecting') {
      try {
        stream.process.stdin?.write(chunk);
      } catch {
        // Will be handled by process error/exit events
      }
    }
  }
}

export function getStreamStatus(destinationId: string): RTMPStreamState | null {
  const stream = activeStreams.get(destinationId);
  if (!stream) return null;

  // Update duration
  if (stream.state.startTime) {
    stream.state.duration = Math.floor((Date.now() - stream.state.startTime) / 1000);
  }

  return { ...stream.state };
}

export function getAllStreamStatuses(): RTMPStreamState[] {
  const statuses: RTMPStreamState[] = [];
  for (const stream of activeStreams.values()) {
    if (stream.state.startTime) {
      stream.state.duration = Math.floor((Date.now() - stream.state.startTime) / 1000);
    }
    statuses.push({ ...stream.state });
  }
  return statuses;
}

export { PLATFORM_PRESETS } from './destinations';
