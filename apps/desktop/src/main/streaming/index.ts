/**
 * RTMP streaming module - manages ffmpeg child processes for live streaming
 */

import { type ChildProcess, spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { app, type BrowserWindow } from 'electron';
import type { RTMPDestinationInfo, RTMPStreamState, EncoderSettings } from '../../preload/api';

// Resolved lazily; `ffmpegIndex` advances when a binary proves broken (e.g. the
// installer-provisioned build crashing with SIGSEGV) so we fall back to the
// next candidate instead of retrying a binary that can never work.
let ffmpegCandidates: string[] | undefined;
let ffmpegIndex = 0;

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
  connectTimer: ReturnType<typeof setTimeout> | null;
  intentionallyStopped: boolean;
  /** Consecutive ffmpeg progress samples below realtime speed. */
  slowSamples: number;
}

const activeStreams = new Map<string, ActiveStream>();
let mainWindowRef: BrowserWindow | null = null;

// The first chunk MediaRecorder emits carries the WebM/EBML init segment
// (header + track info); later chunks are headerless clusters. ffmpeg can only
// start decoding from a chunk that begins with the header, so we cache the first
// chunk and replay it to every ffmpeg that spawns *after* it (reconnects and
// destinations that join mid-session). Without this, reconnects produce a
// headerless pipe that ffmpeg rejects and nothing ever reaches the RTMP server.
let initSegment: Buffer | null = null;
// How long ffmpeg may sit in "connecting" before we treat it as a failure.
const CONNECT_TIMEOUT_MS = 20000;
// Keep the tail of ffmpeg stderr so a failure carries an actionable reason.
const STDERR_TAIL_LIMIT = 4000;

function resetInitSegmentIfIdle(): void {
  if (activeStreams.size === 0) {
    initSegment = null;
  }
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

function sendEvent(event: string, data: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(event, data);
  }
}

/**
 * Collect every usable ffmpeg binary, in preference order:
 * 1. Installer-provisioned: ~/.pairux/bin/ffmpeg (or %LOCALAPPDATA%\PairUX\bin\ffmpeg.exe)
 * 2. System PATH: which ffmpeg / where ffmpeg
 * 3. Dev-only fallback: @ffmpeg-installer/ffmpeg npm package
 */
function resolveFFmpegCandidates(): string[] {
  const candidates: string[] = [];

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
    candidates.push(installerPath);
  }

  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
    if (result && existsSync(result) && !candidates.includes(result)) {
      candidates.push(result);
    }
  } catch {
    // Not found in PATH
  }

  if (!app.isPackaged) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string };
      if (!candidates.includes(ffmpegInstaller.path)) {
        candidates.push(ffmpegInstaller.path);
      }
    } catch {
      // Package not available
    }
  }

  return candidates;
}

/** The currently-preferred ffmpeg binary, or null if none is available. */
export function getFFmpegPath(): string | null {
  ffmpegCandidates ??= resolveFFmpegCandidates();
  const path = ffmpegCandidates[ffmpegIndex] as string | undefined;
  if (!path) {
    console.warn('[Streaming] ffmpeg not found — streaming features will be unavailable');
    return null;
  }
  return path;
}

/**
 * Mark a binary as broken (it crashed before ever going live — e.g. the
 * installer-shipped 2018 build SIGSEGVs on VP9/WebM input) and advance to the
 * next candidate. Returns true when there is another binary to try.
 */
function advanceFFmpegCandidate(brokenPath: string): boolean {
  ffmpegCandidates ??= resolveFFmpegCandidates();
  if (ffmpegCandidates[ffmpegIndex] !== brokenPath) {
    // Another stream already advanced past this binary.
    return ffmpegIndex < ffmpegCandidates.length;
  }
  if (ffmpegIndex < ffmpegCandidates.length - 1) {
    ffmpegIndex++;
    console.warn(
      `[Streaming] ffmpeg at ${brokenPath} keeps crashing; falling back to ${ffmpegCandidates[ffmpegIndex]}`
    );
    return true;
  }
  return false;
}

function getResolution(resolution: '720p' | '1080p'): string {
  return resolution === '720p' ? '1280x720' : '1920x1080';
}

function buildFFmpegArgs(settings: EncoderSettings, rtmpUrl: string, streamKey: string): string[] {
  const gopSize = settings.framerate * settings.keyframeInterval;
  const destination = `${rtmpUrl}/${streamKey}`;

  return [
    // The renderer always pipes WebM from MediaRecorder. Stating the demuxer
    // explicitly avoids ffmpeg mis-probing a live (non-seekable) pipe.
    '-f',
    'webm',
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
    // Screen capture is variable-frame-rate (frames only on damage; a static
    // screen can go seconds without one). The fps filter duplicates frames to a
    // strict constant frame rate — without it YouTube reports "not receiving
    // enough video to maintain smooth streaming". yuv420p is the pixel format
    // RTMP platforms require.
    '-vf',
    `scale=${getResolution(settings.resolution).replace('x', ':')},fps=${String(settings.framerate)}`,
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(gopSize),
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

function parseFFmpegStats(
  line: string
): { fps: number; bitrate: number; speed: number | null } | null {
  const fpsMatch = /fps=\s*([\d.]+)/.exec(line);
  const bitrateMatch = /bitrate=\s*([\d.]+)kbits/.exec(line);
  const speedMatch = /speed=\s*([\d.]+)x/.exec(line);

  if (fpsMatch && bitrateMatch) {
    return {
      speed: speedMatch ? parseFloat(speedMatch[1]) : null,
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

/** Pull the most relevant ffmpeg error line out of buffered stderr. */
function lastFFmpegError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Iterate from the end (most recent) without mutating `lines`, so the
  // fallback below still returns the first line of output.
  const meaningful = [...lines]
    .reverse()
    .find(
      (l) =>
        /error|fail|crash|invalid|unable|not found|no such|unknown encoder|connection|refused|broken pipe|end of file|403|401/i.test(
          l
        ) && !l.startsWith('frame=')
    );
  if (meaningful) return meaningful;
  return lines.length > 0 ? lines[0] : 'ffmpeg exited without output';
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
    const reason = lastFFmpegError(stream.statsBuffer);
    const error = `Failed after ${String(MAX_RECONNECT_ATTEMPTS)} reconnection attempts: ${reason}`;
    updateStreamState(destinationId, { status: 'error', error });
    sendEvent('rtmp:streamError', { destinationId, error, isRecoverable: false });
    activeStreams.delete(destinationId);
    resetInitSegmentIfIdle();
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
      connectTimer: null,
      intentionallyStopped: false,
      slowSamples: 0,
    };

    activeStreams.set(destination.id, activeStream);

    // Replay the cached WebM header so a stream that spawns after recording
    // started (reconnect, or a destination added mid-session) receives a valid
    // stream start instead of headerless clusters.
    if (initSegment) {
      try {
        proc.stdin.write(initSegment);
      } catch {
        // Surfaced via the process error/exit handlers.
      }
    }

    // If ffmpeg never reports a live connection, treat it as a failure rather
    // than sitting in "connecting" forever (e.g. unreachable ingest, bad key).
    activeStream.connectTimer = setTimeout(() => {
      const s = activeStreams.get(destination.id);
      if (!s || s.intentionallyStopped || s.state.status !== 'connecting') return;
      console.warn(`[Streaming] ${destination.name} stuck connecting; restarting ffmpeg`);
      try {
        s.process.kill('SIGKILL');
      } catch {
        // exit handler drives the reconnect
      }
    }, CONNECT_TIMEOUT_MS);

    // Monitor stderr for stats and errors
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      // Keep only the tail so a long-running stream's buffer can't grow without
      // bound, while still preserving the most recent (most relevant) errors.
      activeStream.statsBuffer = (activeStream.statsBuffer + text).slice(-STDERR_TAIL_LIMIT);

      // Check for successful connection
      if (
        activeStream.state.status === 'connecting' &&
        (text.includes('Output #0') || text.includes('frame='))
      ) {
        if (activeStream.connectTimer) {
          clearTimeout(activeStream.connectTimer);
          activeStream.connectTimer = null;
        }
        updateStreamState(destination.id, { status: 'live' });

        // Reset reconnect counter after 60s of stable connection
        activeStream.stableTimer = setTimeout(() => {
          updateStreamState(destination.id, { reconnectAttempts: 0 });
        }, 60000);
      }

      // Parse stats
      const stats = parseFFmpegStats(text);
      if (stats) {
        // Encoder falling behind realtime means the platform will starve and
        // viewers buffer ("not receiving enough video"). Warn once per stream
        // after a sustained slowdown so the cause is visible in the logs.
        if (stats.speed !== null) {
          if (stats.speed < 0.92) {
            activeStream.slowSamples++;
            if (activeStream.slowSamples === 5) {
              console.warn(
                `[Streaming] ${destination.name}: encoder at ${String(stats.speed)}x realtime — ` +
                  'CPU or upload bandwidth cannot keep up. Lower the resolution/bitrate ' +
                  'in the destination settings or stream to fewer platforms at once.'
              );
            }
          } else {
            activeStream.slowSamples = 0;
          }
        }

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
      if (stream.connectTimer) clearTimeout(stream.connectTimer);

      if (stream.intentionallyStopped) {
        updateStreamState(destination.id, { status: 'stopped' });
        activeStreams.delete(destination.id);
        resetInitSegmentIfIdle();
        return;
      }

      console.log(
        `[Streaming] ffmpeg exited for ${destination.name}: code=${String(code)}, signal=${String(signal)}\n${lastFFmpegError(stream.statsBuffer)}`
      );

      // A signal exit before the stream ever went live means the binary itself
      // is broken (e.g. the bundled 2018 build SIGSEGVs on VP9/WebM input).
      // Switch to the next ffmpeg candidate so the reconnect can actually work,
      // and leave a readable reason for the final error message.
      if (signal && stream.state.status === 'connecting') {
        stream.statsBuffer += `\nffmpeg crashed (${signal}) before going live`;
        if (!advanceFFmpegCandidate(ffmpegPath)) {
          stream.statsBuffer +=
            '\nNo working ffmpeg found — install one (e.g. sudo apt install ffmpeg) and try again';
        }
      }

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
        resetInitSegmentIfIdle();
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
  if (stream.connectTimer) clearTimeout(stream.connectTimer);

  // Graceful shutdown: close stdin first
  try {
    stream.process.stdin?.end();
  } catch {
    // ignore
  }

  // On Windows, SIGTERM/SIGKILL don't work properly — use taskkill instead
  if (process.platform === 'win32') {
    const pid = stream.process.pid;
    setTimeout(() => {
      try {
        if (pid) {
          spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
            stdio: 'ignore',
          });
        }
      } catch {
        // ignore
      }
    }, 1000);
  } else {
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
  }

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
  if (destinations.length === 0) {
    return {
      success: false,
      started: 0,
      errors: ['No enabled streaming destinations. Add or enable one in Settings.'],
    };
  }

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

/**
 * Write an encoded chunk to every active stream's ffmpeg stdin.
 *
 * Honors stdin backpressure: when a pipe's buffer is full, `write()` returns
 * false and we wait for its 'drain' event before resolving. Because the renderer
 * awaits this call before sending the next chunk, a slow upstream (network /
 * ffmpeg) throttles the producer instead of buffering chunks in memory unbounded.
 */
export async function writeStreamChunk(chunk: Buffer): Promise<void> {
  // The first chunk produced after a stream becomes active carries the WebM
  // header; cache a copy so reconnects/late joiners can be primed with it.
  if (!initSegment && activeStreams.size > 0 && chunk.length > 0) {
    initSegment = Buffer.from(chunk);
  }

  const drains: Promise<void>[] = [];

  for (const stream of activeStreams.values()) {
    if (stream.state.status === 'live' || stream.state.status === 'connecting') {
      const stdin = stream.process.stdin;
      if (!stdin) continue;
      try {
        const hasRoom = stdin.write(chunk);
        if (!hasRoom) {
          drains.push(
            new Promise<void>((resolve) => {
              stdin.once('drain', () => {
                resolve();
              });
            })
          );
        }
      } catch {
        // Will be handled by process error/exit events
      }
    }
  }

  if (drains.length > 0) {
    await Promise.all(drains);
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
