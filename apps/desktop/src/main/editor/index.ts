/**
 * The desktop video editor's main-process side.
 *
 * Cut an hour-long recording down to the five minutes that matter, put a
 * title card or clip before and after it, fade in and out, export, and
 * optionally publish the result to c0mpute private storage, encrypted on this
 * machine under the user's own c0mpute identity.
 *
 * The edit itself is @pairux/video-edit: the renderer builds an EditPlan, this
 * module validates it and runs it through the same ffmpeg compiler the CLI,
 * web and mobile renders use.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import {
  C0MPUTE_BROWSER_LIMIT,
  validatePlan,
  type EditPlan,
  type MediaInfo,
} from '@pairux/video-edit';
import {
  RenderCancelled,
  findC0mpute,
  probeMedia,
  publishToC0mpute,
  remux,
  renderEdit,
} from '@pairux/video-edit/node';
import type { C0mputePublishResult, ProgressUpdate } from '@pairux/video-edit';

export const VIDEO_EXTENSIONS = ['.webm', '.mp4', '.mkv', '.mov', '.m4v'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export interface RecordingFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
}

/** Video files in a directory, newest first. Edits are listed too. */
export function listVideoFiles(dir: string, limit = 200): RecordingFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: RecordingFile[] = [];
  for (const name of names) {
    if (!VIDEO_EXTENSIONS.includes(extname(name).toLowerCase())) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isFile() && st.size > 0)
        files.push({ path, name, size: st.size, modifiedAt: st.mtimeMs });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}

/** Cache file name for a remuxed copy: changes whenever the source does. */
export function cacheKey(path: string, size: number, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${path}\0${String(size)}\0${String(Math.floor(mtimeMs))}`)
    .digest('hex')
    .slice(0, 24);
}

/** Keep the newest `keep` cache files and nothing older than `maxAgeMs`. */
export function pruneCache(
  dir: string,
  keep = 5,
  maxAgeMs = 7 * 24 * 3600 * 1000,
  now = Date.now()
): void {
  let entries: { path: string; mtime: number }[];
  try {
    entries = readdirSync(dir).map((n) => {
      const p = join(dir, n);
      return { path: p, mtime: statSync(p).mtimeMs };
    });
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  entries.forEach((e, i) => {
    if (i >= keep || now - e.mtime > maxAgeMs) {
      try {
        rmSync(e.path, { force: true });
      } catch {
        // In use; next prune.
      }
    }
  });
}

/** `<dir>/<name>-edit-<timestamp>.<ext>` */
export function defaultOutputPath(
  source: string,
  dir: string,
  format: 'mp4' | 'webm',
  now = new Date()
): string {
  const name = basename(source, extname(source)).replace(/-edit-\d{4}-\d{2}-\d{2}T[\d-]+$/, '');
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(dir, `${name}-edit-${ts}.${format}`);
}

/** A font for title cards that exists on this machine, or null for fontconfig's Sans. */
export function findTitleFont(
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
  fcMatch: () => string | null = defaultFcMatch
): string | null {
  const candidates =
    platform === 'darwin'
      ? [
          '/System/Library/Fonts/Helvetica.ttc',
          '/System/Library/Fonts/SFNS.ttf',
          '/Library/Fonts/Arial.ttf',
        ]
      : platform === 'win32'
        ? [
            join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'segoeui.ttf'),
            join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arial.ttf'),
          ]
        : [];
  for (const c of candidates) if (exists(c)) return c;
  if (platform === 'linux') {
    const matched = fcMatch();
    if (matched && exists(matched)) return matched;
    for (const c of [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    ])
      if (exists(c)) return c;
  }
  return null;
}

function defaultFcMatch(): string | null {
  try {
    const out = execFileSync('fc-match', ['-f', '%{file}', 'sans-serif:style=Bold'], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stateful editor service (one render and one publish at a time).
// ---------------------------------------------------------------------------

export interface EditorDeps {
  ffmpegPath: () => string | null;
  cacheDir: () => string;
  outputDir: () => string;
  font?: () => string | null;
}

export interface OpenedFile {
  sourcePath: string;
  /** The file to play and render from: the source, or a remuxed copy with an index. */
  editPath: string;
  info: MediaInfo;
}

export class EditorService {
  private renderAbort: AbortController | null = null;
  private publishAbort: AbortController | null = null;
  private fontCache: string | null | undefined;

  constructor(private readonly deps: EditorDeps) {}

  private ffmpeg(): string {
    const ff = this.deps.ffmpegPath();
    if (!ff) throw new Error('ffmpeg is not installed. Reinstall PairUX or install ffmpeg.');
    return ff;
  }

  async open(path: string): Promise<OpenedFile> {
    const st = statSync(path);
    if (!st.isFile()) throw new Error('Not a file');
    const ff = this.ffmpeg();
    const info = await probeMedia(ff, path);
    if (!info.hasVideo) throw new Error('That file has no video');
    if (info.duration !== null) return { sourcePath: path, editPath: path, info };

    // MediaRecorder WebM: no duration and no cues, so <video> cannot seek and
    // ffmpeg -ss has to read from the start. A stream copy fixes both.
    const dir = this.deps.cacheDir();
    mkdirSync(dir, { recursive: true });
    const ext = extname(path).toLowerCase() === '.webm' ? '.webm' : '.mkv';
    const cached = join(dir, `${cacheKey(path, st.size, st.mtimeMs)}${ext}`);
    if (!existsSync(cached)) {
      pruneCache(dir);
      const tmp = `${cached}.tmp${ext}`;
      try {
        await remux(ff, path, tmp);
        renameSync(tmp, cached);
      } catch (error) {
        rmSync(tmp, { force: true });
        throw error;
      }
    }
    const fixed = await probeMedia(ff, cached);
    return { sourcePath: path, editPath: cached, info: fixed };
  }

  async probe(path: string): Promise<MediaInfo> {
    return probeMedia(this.ffmpeg(), path);
  }

  get rendering(): boolean {
    return this.renderAbort !== null;
  }

  async render(
    rawPlan: unknown,
    opts: {
      source: string;
      sourcePath?: string;
      output?: string | null;
      quality?: 'fast' | 'balanced' | 'high';
      sourceDuration?: number | null;
    },
    onProgress: (p: ProgressUpdate) => void
  ): Promise<{ output: string; duration: number; size: number }> {
    if (this.renderAbort) throw new Error('An export is already running');
    const plan: EditPlan = validatePlan(rawPlan, opts.sourceDuration ?? null);
    const format = plan.output?.format ?? 'mp4';
    const outDir = this.deps.outputDir();
    mkdirSync(outDir, { recursive: true });
    const output = opts.output ?? defaultOutputPath(opts.sourcePath ?? opts.source, outDir, format);
    if (output === opts.source || output === opts.sourcePath)
      throw new Error('Choose a different file name; that would overwrite the recording');
    mkdirSync(dirname(output), { recursive: true });
    if (this.fontCache === undefined) this.fontCache = (this.deps.font ?? findTitleFont)();
    const abort = new AbortController();
    this.renderAbort = abort;
    try {
      const result = await renderEdit(plan, {
        ffmpeg: this.ffmpeg(),
        source: opts.source,
        output,
        fontFile: this.fontCache,
        quality: opts.quality ?? 'balanced',
        signal: abort.signal,
        onProgress,
      });
      return { ...result, size: statSync(output).size };
    } catch (error) {
      rmSync(output, { force: true });
      throw error;
    } finally {
      this.renderAbort = null;
    }
  }

  cancelRender(): boolean {
    if (!this.renderAbort) return false;
    this.renderAbort.abort();
    return true;
  }

  c0mputeStatus(): { installed: boolean; binary: string | null } {
    const binary = findC0mpute();
    return { installed: Boolean(binary), binary };
  }

  async publish(
    file: string,
    password: string | undefined,
    onLine: (line: string) => void
  ): Promise<C0mputePublishResult & { size: number; browserOpenable: boolean }> {
    if (this.publishAbort) throw new Error('A publish is already running');
    const binary = findC0mpute();
    if (!binary) throw new Error('c0mpute is not installed');
    const size = statSync(file).size;
    const abort = new AbortController();
    this.publishAbort = abort;
    try {
      const result = await publishToC0mpute(file, {
        binary,
        password: password === '' ? undefined : password,
        onLine,
        signal: abort.signal,
      });
      return { ...result, size, browserOpenable: size <= C0MPUTE_BROWSER_LIMIT };
    } finally {
      this.publishAbort = null;
    }
  }

  cancelPublish(): boolean {
    if (!this.publishAbort) return false;
    this.publishAbort.abort();
    return true;
  }
}

export { RenderCancelled };
