/**
 * `pairux edit`, `pairux publish`, `pairux recordings`: the video editor from
 * the terminal.
 *
 *   pairux edit meeting.webm --keep 40:00-45:00 --fade 1 -o clip.mp4
 *   pairux edit meeting.webm --cut 0-2:10 --intro-title "Weekly demo" --publish c0mpute
 *   pairux publish clip.mp4                 encrypt + publish to c0mpute private storage
 *   pairux recordings                       your server recordings and edits
 *   pairux recordings edit <id> --keep 12:30-17:30 --fade 1 --wait
 *
 * Local edits run the same engine as the desktop editor (@pairux/video-edit)
 * with the app's ffmpeg. Server recordings are rendered by pairux.com.
 * Publishing uses the user's own `c0mpute` binary and identity, so the file is
 * encrypted on this machine and PairUX never holds the key.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  C0MPUTE_BROWSER_LIMIT,
  EditPlanError,
  cutRange,
  formatTime,
  keptDuration,
  parseRange,
  validatePlan,
  type Bumper,
  type C0mputePublishResult,
  type EditPlan,
  type KeepRange,
  type MediaInfo,
  type ProgressUpdate,
} from '@pairux/video-edit';
import type { CloudRecording, PairuxClient } from './api';
import type { Deps } from './commands';
import { UsageError } from './errors';

export interface VideoDeps {
  findFfmpeg: () => string | null;
  probe: (ffmpeg: string, source: string) => Promise<MediaInfo>;
  remux: (ffmpeg: string, source: string, output: string) => Promise<void>;
  render: (
    plan: EditPlan,
    opts: {
      ffmpeg: string;
      source: string;
      output: string;
      sourceInfo?: MediaInfo;
      fontFile?: string | null;
      quality?: 'fast' | 'balanced' | 'high';
      onProgress?: (p: ProgressUpdate) => void;
    }
  ) => Promise<{ output: string; duration: number }>;
  findC0mpute: () => string | null;
  publish: (
    file: string,
    opts: { binary: string; shareWith?: string[]; onLine?: (line: string) => void }
  ) => Promise<C0mputePublishResult>;
  /** Wall clock, for output file names. */
  now?: () => Date;
}

export const VIDEO_HELP = `Video editing: trim long recordings, add fades and an intro/outro,
publish privately to c0mpute.

Usage:
  pairux edit <file> [options]          Edit a local recording (same engine as the app)
      --keep <start-end>                Keep this range; repeat for several (12:30-17:30, 40m-45m)
      --cut <start-end>                 Remove this range from what is kept; repeatable
      --fade <s>                        Fade in and out (or --fade-in / --fade-out)
      --intro <file>                    Clip or image (png/jpg) before the recording
      --intro-title <text>              Or a generated title card (--intro-subtitle <text>)
      --outro <file> | --outro-title <text> [--outro-subtitle <text>]
      --card-duration <s>               Length of title/image cards (default 3)
      -o, --output <file>               Default: <name>-edit-<time>.mp4 next to the input
      --format mp4|webm                 Default mp4
      --quality fast|balanced|high      Default balanced
      --publish c0mpute                 Then publish it privately (see below)
      --share-with <c0ps1...>           Also let this c0mpute identity open it; repeatable
      --json                            Print the result as JSON
  pairux publish <file> [--share-with <c0ps1...>] [--json]
                                        Encrypt on this machine and publish to c0mpute
                                        private storage; prints a private #k= link
  pairux recordings [--json]            Your PairUX server recordings and edits
  pairux recordings edit <id> [--keep/--cut/--fade/--intro-title/--outro-title ...]
                    [--intro-recording <id>] [--outro-recording <id>] [--subject <s>] [--wait]
                                        Render an edit of a server recording on pairux.com

Times: 750, 12:30, 1:02:03.5, 12m30s. c0mpute publishing needs the c0mpute CLI
(https://c0mpute.com) and an identity; set C0MPUTE_DM_PASSWORD to unlock it
non-interactively.`;

const EDIT_OPTIONS = {
  keep: { type: 'string', multiple: true },
  cut: { type: 'string', multiple: true },
  fade: { type: 'string' },
  'fade-in': { type: 'string' },
  'fade-out': { type: 'string' },
  intro: { type: 'string' },
  'intro-title': { type: 'string' },
  'intro-subtitle': { type: 'string' },
  'intro-recording': { type: 'string' },
  outro: { type: 'string' },
  'outro-title': { type: 'string' },
  'outro-subtitle': { type: 'string' },
  'outro-recording': { type: 'string' },
  'card-duration': { type: 'string' },
  output: { type: 'string', short: 'o' },
  format: { type: 'string' },
  quality: { type: 'string' },
  publish: { type: 'string' },
  'share-with': { type: 'string', multiple: true },
  subject: { type: 'string' },
  wait: { type: 'boolean' },
  json: { type: 'boolean' },
} as const;

type EditValues = ReturnType<typeof parseEditArgs>['values'];

function parseEditArgs(args: string[]) {
  return parseArgs({ args, options: EDIT_OPTIONS, allowPositionals: true, strict: true });
}

function seconds(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`${label} must be a number of seconds`);
  return n;
}

function ranges(values: string[] | undefined, label: string): KeepRange[] {
  return (values ?? []).map((v) => {
    try {
      return parseRange(v);
    } catch (error) {
      throw new UsageError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

const IMAGE = /\.(png|jpe?g|webp|bmp)$/i;

function bumper(values: EditValues, which: 'intro' | 'outro', cloud: boolean): Bumper | null {
  const file = values[which];
  const title = values[`${which}-title`];
  const recording = values[`${which}-recording`];
  const given = [file, title, recording].filter((v) => v !== undefined).length;
  if (given > 1)
    throw new UsageError(`Give one of --${which}, --${which}-title, --${which}-recording`);
  const duration = seconds(values['card-duration'], '--card-duration') ?? 3;
  const fade = Math.min(0.5, duration / 4);
  if (title !== undefined) {
    const subtitle = values[`${which}-subtitle`];
    return {
      kind: 'title',
      text: title,
      ...(subtitle ? { subtitle } : {}),
      duration,
      fadeIn: fade,
      fadeOut: fade,
    };
  }
  if (recording !== undefined) {
    if (!cloud) throw new UsageError(`--${which}-recording is for \`pairux recordings edit\``);
    return { kind: 'file', source: `recording:${recording}`, fadeIn: fade, fadeOut: fade };
  }
  if (file !== undefined) {
    if (cloud) throw new UsageError(`Server edits take --${which}-title or --${which}-recording`);
    return IMAGE.test(file)
      ? { kind: 'image', source: file, duration, fadeIn: fade, fadeOut: fade }
      : { kind: 'file', source: file, fadeIn: fade, fadeOut: fade };
  }
  return null;
}

/** Build the raw plan from flags; validatePlan checks and normalizes it. */
export function planFromFlags(
  values: EditValues,
  duration: number | null,
  cloud = false
): EditPlan {
  let keep = ranges(values.keep, '--keep');
  const cuts = ranges(values.cut, '--cut');
  if (keep.length === 0) {
    if (!duration) {
      throw new UsageError(
        'The recording does not say how long it is; give the part to keep with --keep start-end'
      );
    }
    keep = [{ start: 0, end: duration }];
  }
  for (const c of cuts) keep = cutRange(keep, c.start, c.end);
  if (keep.length === 0) throw new UsageError('Nothing is left after the cuts');
  const fade = seconds(values.fade, '--fade');
  const format = values.format ?? 'mp4';
  if (format !== 'mp4' && format !== 'webm') throw new UsageError('--format is mp4 or webm');
  try {
    return validatePlan(
      {
        keep,
        fadeIn: seconds(values['fade-in'], '--fade-in') ?? fade ?? 0,
        fadeOut: seconds(values['fade-out'], '--fade-out') ?? fade ?? 0,
        intro: bumper(values, 'intro', cloud),
        outro: bumper(values, 'outro', cloud),
        output: { format },
      },
      duration
    );
  } catch (error) {
    if (error instanceof EditPlanError) throw new UsageError(error.message);
    throw error;
  }
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function publishFile(
  file: string,
  shareWith: string[],
  json: boolean,
  deps: Deps,
  video: VideoDeps
): Promise<C0mputePublishResult> {
  const binary = video.findC0mpute();
  if (!binary) {
    throw new UsageError(
      'The c0mpute CLI is not installed (or not on PATH). Install it from https://c0mpute.com, run `c0mpute storage key init --backup-to <file>` once, then try again. Set C0MPUTE_BIN to point at it.'
    );
  }
  if (!json) deps.err(`Encrypting and publishing ${basename(file)} to c0mpute private storage...`);
  const result = await video.publish(file, {
    binary,
    shareWith,
    onLine: (line) => {
      if (!json) deps.err(`  ${line}`);
    },
  });
  if (!json) {
    deps.out(`Private (end-to-end encrypted) on c0mpute: ${result.ref}`);
    if (result.link)
      deps.out(`Link (key is in the #k= part; anyone with it can watch): ${result.link}`);
    if (result.capability) deps.out(`For \`c0mpute storage get\`: ${result.capability}`);
    const bytes = (await stat(file)).size;
    if (bytes > C0MPUTE_BROWSER_LIMIT) {
      deps.out(
        `Note: at ${size(bytes)} it is too large for the browser link; open it with \`c0mpute storage get ${result.capability ?? result.ref} -o out${extname(file)}\`.`
      );
    }
  }
  return result;
}

function progressPrinter(deps: Deps, json: boolean): (p: ProgressUpdate) => void {
  let last = -1;
  return (p) => {
    if (json || p.fraction === null) return;
    const pct = Math.floor(p.fraction * 100);
    if (pct >= last + 5 || (p.done && last < 100)) {
      last = pct;
      deps.err(`  rendering ${String(pct)}%  (${formatTime(p.seconds, 0)})`);
    }
  };
}

export async function runEdit(args: string[], deps: Deps, video: VideoDeps): Promise<number> {
  const { values, positionals } = parseEditArgs(args);
  const input = positionals[0];
  if (!input)
    throw new UsageError('Usage: pairux edit <file> --keep <start-end> ... (see `pairux help`)');
  if (positionals.length > 1) throw new UsageError(`Unexpected argument "${positionals[1]}"`);
  if (values.publish !== undefined && values.publish !== 'c0mpute')
    throw new UsageError('--publish only knows c0mpute');
  const quality = values.quality ?? 'balanced';
  if (quality !== 'fast' && quality !== 'balanced' && quality !== 'high')
    throw new UsageError('--quality is fast, balanced or high');
  const ffmpeg = video.findFfmpeg();
  if (!ffmpeg) throw new UsageError('ffmpeg was not found; reinstall PairUX or put ffmpeg on PATH');

  const json = values.json ?? false;
  let source = input;
  let info = await video.probe(ffmpeg, input);
  let scratch: string | null = null;
  try {
    // MediaRecorder WebM has no duration; a stream-copy remux adds one (and a
    // seek index) in seconds, which "keep everything" and the cuts need.
    if (info.duration === null && (values.keep ?? []).length === 0) {
      scratch = await mkdtemp(join(tmpdir(), 'pairux-edit-'));
      source = join(scratch, `source${extname(input) || '.webm'}`);
      await video.remux(ffmpeg, input, source);
      info = await video.probe(ffmpeg, source);
    }
    const plan = planFromFlags(values, info.duration);
    const format = plan.output?.format ?? 'mp4';
    const output =
      values.output ??
      join(
        dirname(input),
        `${basename(input, extname(input))}-edit-${stamp(video.now?.() ?? new Date())}.${format}`
      );
    if (!json) {
      deps.err(
        `Keeping ${String(plan.keep.length)} range(s), ${formatTime(keptDuration(plan.keep), 0)} of ${info.duration ? formatTime(info.duration, 0) : 'the recording'}`
      );
    }
    const result = await video.render(plan, {
      ffmpeg,
      source,
      output,
      sourceInfo: info,
      quality,
      onProgress: progressPrinter(deps, json),
    });
    let published: C0mputePublishResult | null = null;
    if (!json) deps.out(`Saved ${result.output} (${formatTime(result.duration, 0)})`);
    if (values.publish === 'c0mpute') {
      published = await publishFile(result.output, values['share-with'] ?? [], json, deps, video);
    }
    if (json)
      deps.out(
        JSON.stringify({
          output: result.output,
          duration: result.duration,
          plan,
          c0mpute: published,
        })
      );
    return 0;
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

export async function runPublish(args: string[], deps: Deps, video: VideoDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { 'share-with': { type: 'string', multiple: true }, json: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  });
  const file = positionals[0];
  if (!file) throw new UsageError('Usage: pairux publish <file> [--share-with <c0ps1...>]');
  await stat(file).catch(() => {
    throw new UsageError(`No such file: ${file}`);
  });
  const result = await publishFile(
    file,
    values['share-with'] ?? [],
    values.json ?? false,
    deps,
    video
  );
  if (values.json) deps.out(JSON.stringify(result));
  return 0;
}

function describeRecording(r: CloudRecording): string {
  const len = r.duration_seconds ? formatTime(r.duration_seconds, 0) : '--:--';
  const status =
    r.status === 'processing' && r.edit_progress !== null
      ? `processing ${String(Math.round(r.edit_progress * 100))}%`
      : r.status;
  const edit = r.parent_recording_id ? ` (edit of ${r.parent_recording_id.slice(0, 8)})` : '';
  return `${r.id}  ${r.created_at.slice(0, 16).replace('T', ' ')}  ${len.padStart(8)}  ${status.padEnd(15)} ${r.subject ?? 'Untitled'}${edit}`;
}

export async function runRecordings(
  args: string[],
  deps: Deps,
  client: PairuxClient,
  signedIn: boolean
): Promise<number> {
  if (!signedIn) throw new UsageError('Sign in first: `pairux login`.');
  const api = client.recordings();
  const [sub, ...rest] = args;
  if (args.length === 0 || sub === '--json' || sub === 'list') {
    const json = args.includes('--json');
    const list = await api.list();
    if (json) deps.out(JSON.stringify(list));
    else if (list.length === 0) deps.out('No server recordings yet.');
    else for (const r of list) deps.out(describeRecording(r));
    return 0;
  }
  if (sub !== 'edit')
    throw new UsageError(`Unknown recordings command "${sub}". Run \`pairux help\`.`);

  const { values, positionals } = parseEditArgs(rest);
  const id = positionals[0];
  if (!id) throw new UsageError('Usage: pairux recordings edit <id> --keep <start-end> ...');
  if (values.publish !== undefined)
    throw new UsageError(
      'Download the edit, then `pairux publish <file>`: c0mpute encrypts on your machine'
    );
  const source = await api.get(id);
  if (source.status !== 'ready')
    throw new UsageError(`That recording is ${source.status}, not ready`);
  const plan = planFromFlags(values, source.duration_seconds, true);
  const json = values.json ?? false;
  let edit = await api.edit(id, plan, values.subject);
  if (!json) deps.err(`Rendering on pairux.com as ${edit.id}...`);
  if (values.wait) {
    let last = -1;
    while (edit.status === 'processing' || edit.status === 'recording') {
      await deps.sleep(3_000);
      edit = await api.get(edit.id);
      const pct = Math.round((edit.edit_progress ?? 0) * 100);
      if (!json && pct !== last) {
        last = pct;
        deps.err(`  rendering ${String(pct)}%`);
      }
    }
    if (edit.status === 'failed') {
      deps.err(`The edit failed: ${edit.edit_error ?? 'unknown error'}`);
      if (json) deps.out(JSON.stringify(edit));
      return 1;
    }
  }
  if (json) deps.out(JSON.stringify(edit));
  else if (edit.status === 'ready') deps.out(`Ready: ${edit.playback_url ?? edit.id}`);
  else deps.out(`Started. Check with \`pairux recordings\` (id ${edit.id}).`);
  return 0;
}
