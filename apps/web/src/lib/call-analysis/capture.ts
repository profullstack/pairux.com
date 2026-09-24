/**
 * Browser side of AI call analysis: while a call runs, record its audio and
 * upload it in small chunks, and send a still of the shared screen every 20
 * seconds. Uploading as we go means a closed tab or crash still leaves the
 * report job everything captured up to that moment.
 *
 * Same code runs in the desktop app's renderer
 * (apps/desktop/src/renderer/lib/callAnalysisCapture.ts keeps a copy; patch
 * both).
 */

export interface CaptureOptions {
  apiBase: string;
  sessionId: string;
  source: 'web' | 'desktop';
  /** Extra headers per request (the desktop app's Bearer token). */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  fetchImpl?: typeof fetch;
  onStatus?: (status: CaptureStatus) => void;
}

export type CaptureStatus = 'idle' | 'starting' | 'capturing' | 'finishing' | 'done' | 'error';

interface StartResponse {
  analysisId: string;
  startedAt: number;
  chunkIntervalMs: number;
  frameIntervalMs: number;
}

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickAudioMimeType(
  isSupported: (t: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): string | null {
  return AUDIO_TYPES.find((t) => isSupported(t)) ?? null;
}

export class CallAnalysisCapture {
  private recorder: MediaRecorder | null = null;
  private analysisId: string | null = null;
  private startedAt = 0;
  private run = 0;
  private index = 0;
  private queue: Promise<void> = Promise.resolve();
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private status: CaptureStatus = 'idle';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CaptureOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  get currentStatus(): CaptureStatus {
    return this.status;
  }

  private setStatus(status: CaptureStatus) {
    this.status = status;
    this.opts.onStatus?.(status);
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { ...(await this.opts.headers?.()), ...extra };
  }

  /** PUT with retries; a chunk that still fails is dropped, not the call. */
  private async upload(url: string, body: Blob, contentType: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'PUT',
          headers: await this.headers({ 'Content-Type': contentType }),
          body,
          credentials: 'include',
        });
        if (res.ok || res.status === 409 || res.status === 413) return;
      } catch {
        // network blip: retry below
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  /** Start capturing `audio` (the call's mixed audio). Safe to call once. */
  async start(audio: MediaStream): Promise<boolean> {
    if (this.status !== 'idle') return this.status === 'capturing';
    const mimeType = pickAudioMimeType();
    if (!mimeType || audio.getAudioTracks().length === 0) {
      this.setStatus('error');
      return false;
    }
    this.setStatus('starting');
    try {
      const res = await this.fetchImpl(
        `${this.opts.apiBase}/api/sessions/${this.opts.sessionId}/analysis`,
        {
          method: 'POST',
          headers: await this.headers({ 'Content-Type': 'application/json' }),
          credentials: 'include',
          body: JSON.stringify({ source: this.opts.source, mimeType, chunkFormat: 'stream' }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { data?: StartResponse };
      if (!res.ok || !body.data) throw new Error('start refused');
      const { analysisId, startedAt, chunkIntervalMs, frameIntervalMs } = body.data;
      this.analysisId = analysisId;
      this.startedAt = startedAt;
      this.run = Date.now();
      this.index = 0;

      const recorder = new MediaRecorder(new MediaStream(audio.getAudioTracks()), {
        mimeType,
        audioBitsPerSecond: 32_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || !this.analysisId) return;
        const url = `${this.opts.apiBase}/api/analyses/${this.analysisId}/chunks?run=${String(this.run)}&index=${String(this.index++)}`;
        const data = event.data;
        this.queue = this.queue.then(() => this.upload(url, data, 'application/octet-stream'));
      };
      recorder.start(chunkIntervalMs);
      this.recorder = recorder;
      this.frameTimer = setInterval(() => {
        void this.sendFrame();
      }, frameIntervalMs);
      this.setStatus('capturing');
      return true;
    } catch {
      this.setStatus('error');
      return false;
    }
  }

  /** The screen share to take stills from, or null when nothing is shared. */
  setVideo(stream: MediaStream | null): void {
    const track = stream?.getVideoTracks()[0];
    if (!track) {
      if (this.video) this.video.srcObject = null;
      this.video = null;
      return;
    }
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
    }
    this.video.srcObject = new MediaStream([track]);
    void this.video.play().catch(() => undefined);
  }

  private async sendFrame(): Promise<void> {
    const video = this.video;
    if (!video || !this.analysisId || video.videoWidth === 0) return;
    const scale = Math.min(1, 1280 / video.videoWidth);
    this.canvas ??= document.createElement('canvas');
    this.canvas.width = Math.round(video.videoWidth * scale);
    this.canvas.height = Math.round(video.videoHeight * scale);
    this.canvas.getContext('2d')?.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      this.canvas?.toBlob(resolve, 'image/jpeg', 0.7);
    });
    if (!blob) return;
    const t = Math.max(0, Date.now() - this.startedAt);
    const url = `${this.opts.apiBase}/api/analyses/${this.analysisId}/frames?t=${String(t)}`;
    this.queue = this.queue.then(() => this.upload(url, blob, 'image/jpeg'));
  }

  /** Flush the last audio, then hand the capture to the report job. */
  async finish(): Promise<void> {
    if (this.status !== 'capturing') return;
    this.setStatus('finishing');
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            resolve();
          },
          { once: true }
        );
        recorder.stop();
      });
    }
    this.recorder = null;
    this.setVideo(null);
    await this.queue;
    if (this.analysisId) {
      await this.fetchImpl(`${this.opts.apiBase}/api/analyses/${this.analysisId}/finish`, {
        method: 'POST',
        headers: await this.headers(),
        credentials: 'include',
        keepalive: true,
      }).catch(() => undefined);
    }
    this.setStatus('done');
  }
}
