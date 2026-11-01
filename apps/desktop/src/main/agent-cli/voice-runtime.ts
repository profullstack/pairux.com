import { app, BrowserWindow, ipcMain } from 'electron';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { AgentVoiceRunOptions } from './voice-protocol';

interface RendererEvent {
  type?: string;
  text?: string;
  error?: string;
  audio?: ArrayBuffer | Uint8Array;
}

interface VoiceConnectPayload {
  token: string;
  url: string;
  iceServers?: AgentVoiceRunOptions['iceServers'];
}

function gatewayUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

function responseError(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error;
  }
  return fallback;
}

function stringField(event: Record<string, unknown>, field: string): string {
  const value = event[field];
  return typeof value === 'string' ? value : '';
}

function emit(options: AgentVoiceRunOptions, event: Record<string, unknown>): void {
  if (options.json) options.out(JSON.stringify(event));
  else if (event.type === 'transcript') options.out(stringField(event, 'text'));
  else if (event.type === 'ended') options.out(`Voice call ended: ${stringField(event, 'reason')}`);
  else if (event.type === 'connected') options.out(`Voice connected as ${options.displayName}.`);
  else if (event.type === 'warning') options.err(`Voice: ${stringField(event, 'message')}`);
}

async function synthesize(options: AgentVoiceRunOptions, text: string): Promise<ArrayBuffer> {
  const response = await fetch(gatewayUrl(options.speechUrl, '/v1/tts'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.speechToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      engine: options.ttsEngine,
      voice: options.ttsVoice,
      locale: options.ttsLocale,
      speed: 1,
      persona: '',
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new Error(
      `C0mpute TTS failed (${String(response.status)}): ${responseError(body, response.statusText)}`
    );
  }
  return response.arrayBuffer();
}

async function transcribe(options: AgentVoiceRunOptions, audio: ArrayBuffer | Uint8Array) {
  const query = new URLSearchParams({ model: options.sttModel });
  if (options.language) query.set('language', options.language);
  const response = await fetch(gatewayUrl(options.speechUrl, `/v1/stt?${query.toString()}`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.speechToken}`,
      'Content-Type': 'audio/wav',
    },
    body: Buffer.from(audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new Error(
      `C0mpute STT failed (${String(response.status)}): ${responseError(body, response.statusText)}`
    );
  }
  return (await response.json()) as { text?: string; language?: string };
}

function parseSpeechInput(line: string): string | null {
  const value = line.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { type?: string; say?: string; text?: string };
    if (parsed.type && parsed.type !== 'speak') return null;
    return parsed.say ?? parsed.text ?? null;
  } catch {
    return value;
  }
}

/** Run a hidden Chromium renderer that provides WebRTC and WebAudio to the CLI. */
export async function runAgentVoice(options: AgentVoiceRunOptions): Promise<number> {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  return await new Promise<number>((resolve) => {
    let finished = false;
    let connected = false;
    let transcribing = false;
    const audioQueue: (ArrayBuffer | Uint8Array)[] = [];
    let ttsQueue = Promise.resolve();
    const input = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: process.stdin.isTTY,
    });

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      input.close();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      ipcMain.removeListener('agent-voice:event', onRendererEvent);
      win.removeAllListeners('closed');
      if (!win.isDestroyed()) {
        win.webContents.send('agent-voice:stop');
        win.destroy();
      }
    };
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(code);
    };
    const stop = () => {
      finish(0);
    };
    const drainAudioQueue = async () => {
      if (transcribing) return;
      transcribing = true;
      try {
        while (!finished && audioQueue.length > 0) {
          const audio = audioQueue.shift();
          if (!audio) continue;
          try {
            const result = await transcribe(options, audio);
            if (result.text?.trim()) {
              emit(options, { type: 'transcript', text: result.text.trim() });
            }
          } catch (error) {
            emit(options, { type: 'warning', message: String(error) });
          }
        }
      } finally {
        transcribing = false;
        if (!finished && audioQueue.length > 0) void drainAudioQueue();
      }
    };
    const sendConnect = (connection: VoiceConnectPayload) => {
      if (!win.isDestroyed()) win.webContents.send('agent-voice:connect', connection);
    };
    const onRendererEvent = (_event: Electron.IpcMainEvent, raw: unknown) => {
      if (finished || _event.sender !== win.webContents) return;
      const event = raw as RendererEvent;
      if (event.type === 'ready') {
        sendConnect({ token: options.token, url: options.url, iceServers: options.iceServers });
      } else if (event.type === 'connected') {
        connected = true;
        emit(options, { type: 'connected' });
      } else if (event.type === 'transcript' && event.text?.trim()) {
        emit(options, { type: 'transcript', text: event.text.trim() });
      } else if (event.type === 'audio' && event.audio) {
        if (audioQueue.length >= 3) {
          emit(options, {
            type: 'warning',
            message: 'C0mpute STT is behind; dropping an audio chunk.',
          });
        } else {
          audioQueue.push(event.audio);
          void drainAudioQueue();
        }
      } else if (event.type === 'error') {
        emit(options, { type: 'warning', message: event.error ?? 'Audio connection error' });
        if (!connected) finish(1);
      } else if (event.type === 'disconnected' && connected) {
        connected = false;
        emit(options, { type: 'warning', message: event.error ?? 'LiveKit disconnected' });
        finish(1);
      }
    };

    ipcMain.on('agent-voice:event', onRendererEvent);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    win.on('closed', () => {
      finish(0);
    });

    input.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '/quit') {
        finish(0);
        return;
      }
      const text = parseSpeechInput(line);
      if (!text) return;
      ttsQueue = ttsQueue.then(async () => {
        try {
          const audio = await synthesize(options, text);
          if (!finished && !win.isDestroyed()) win.webContents.send('agent-voice:speak', audio);
        } catch (error) {
          emit(options, { type: 'warning', message: String(error) });
        }
      });
    });

    const heartbeatTimer = setInterval(() => {
      void options.heartbeat().catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 410
        ) {
          emit(options, { type: 'ended', reason: describeError(error) });
          finish(0);
        } else {
          emit(options, {
            type: 'warning',
            message: `Could not refresh agent status: ${describeError(error)}`,
          });
        }
      });
    }, 30_000);
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    const loadRenderer =
      !app.isPackaged && rendererUrl
        ? win.loadURL(new URL('agent-voice.html', `${rendererUrl.replace(/\/+$/, '')}/`).toString())
        : win.loadFile(join(__dirname, '../renderer/agent-voice.html'));
    void loadRenderer.catch((error: unknown) => {
      emit(options, {
        type: 'warning',
        message: `Could not load PairUX voice runtime: ${describeError(error)}`,
      });
      finish(1);
    });
  });
}
