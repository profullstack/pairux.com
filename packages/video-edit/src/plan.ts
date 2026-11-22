/**
 * The edit plan: what to keep from a recording and what to wrap it in.
 *
 * Every surface (desktop editor, `pairux edit`, the web and mobile editors via
 * the API, the MCP tools) builds one of these and hands it to the same
 * compiler, so a cut made in one place renders identically everywhere.
 *
 * All times are seconds from the start of the source.
 */

export interface KeepRange {
  start: number;
  end: number;
}

/** A clip or still placed before or after the main content. */
export type Bumper =
  | {
      kind: 'file';
      /** Local path or URL of a video (or audio-less video) clip. */
      source: string;
      fadeIn?: number | undefined;
      fadeOut?: number | undefined;
    }
  | {
      kind: 'image';
      /** Local path or URL of a still (PNG/JPEG), shown for `duration`. */
      source: string;
      duration: number;
      fadeIn?: number | undefined;
      fadeOut?: number | undefined;
    }
  | {
      kind: 'title';
      /** Title card rendered by ffmpeg (drawtext). */
      text: string;
      subtitle?: string | undefined;
      duration: number;
      /** CSS-style hex, e.g. #0b0b10. */
      background?: string | undefined;
      color?: string | undefined;
      fadeIn?: number | undefined;
      fadeOut?: number | undefined;
    };

export type OutputFormat = 'mp4' | 'webm';

export interface EditPlan {
  /** Ranges of the source to keep, played in this order. At least one. */
  keep: KeepRange[];
  /** Fade the main content in from black (and silence), in seconds. */
  fadeIn?: number | undefined;
  /** Fade the main content out to black (and silence), in seconds. */
  fadeOut?: number | undefined;
  intro?: Bumper | null | undefined;
  outro?: Bumper | null | undefined;
  output?: {
    format?: OutputFormat | undefined;
    /** Output frame size. Defaults to the source's, rounded to even numbers. */
    width?: number | undefined;
    height?: number | undefined;
    fps?: number | undefined;
  };
}

export const LIMITS = {
  /** Longest fade, seconds. */
  maxFade: 10,
  /** Longest generated title/image card, seconds. */
  maxCard: 30,
  /** Most keep ranges in one plan. */
  maxRanges: 100,
  maxTitleLength: 120,
  /** Largest output edge, pixels. */
  maxEdge: 3840,
} as const;

export class EditPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditPlanError';
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function checkFade(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  if (!finite(value) || value < 0 || value > LIMITS.maxFade)
    throw new EditPlanError(`${label} must be between 0 and ${String(LIMITS.maxFade)} seconds`);
  return value;
}

function checkBumper(value: unknown, label: string): Bumper | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new EditPlanError(`${label} must be an object`);
  const b = value as Record<string, unknown>;
  const fadeIn = checkFade(b.fadeIn, `${label}.fadeIn`);
  const fadeOut = checkFade(b.fadeOut, `${label}.fadeOut`);
  const duration = (): number => {
    if (!finite(b.duration) || b.duration <= 0 || b.duration > LIMITS.maxCard)
      throw new EditPlanError(
        `${label}.duration must be between 0 and ${String(LIMITS.maxCard)} seconds`
      );
    if (fadeIn + fadeOut > b.duration)
      throw new EditPlanError(`${label} fades are longer than the card`);
    return b.duration;
  };
  switch (b.kind) {
    case 'file':
    case 'image': {
      if (typeof b.source !== 'string' || !b.source.trim())
        throw new EditPlanError(`${label}.source is required`);
      if (b.kind === 'file') return { kind: 'file', source: b.source, fadeIn, fadeOut };
      return { kind: 'image', source: b.source, duration: duration(), fadeIn, fadeOut };
    }
    case 'title': {
      if (typeof b.text !== 'string' || !b.text.trim())
        throw new EditPlanError(`${label}.text is required`);
      if (b.text.length > LIMITS.maxTitleLength)
        throw new EditPlanError(`${label}.text is too long`);
      if (b.subtitle !== undefined && typeof b.subtitle !== 'string')
        throw new EditPlanError(`${label}.subtitle must be text`);
      if (typeof b.subtitle === 'string' && b.subtitle.length > LIMITS.maxTitleLength)
        throw new EditPlanError(`${label}.subtitle is too long`);
      for (const key of ['background', 'color'] as const) {
        if (b[key] !== undefined && (typeof b[key] !== 'string' || !HEX.test(b[key])))
          throw new EditPlanError(`${label}.${key} must be a #rrggbb colour`);
      }
      return {
        kind: 'title',
        text: b.text.trim(),
        subtitle: typeof b.subtitle === 'string' && b.subtitle.trim() ? b.subtitle.trim() : undefined,
        duration: duration(),
        background: (b.background as string | undefined) ?? '#0b0b10',
        color: (b.color as string | undefined) ?? '#ffffff',
        fadeIn,
        fadeOut,
      };
    }
    default:
      throw new EditPlanError(`${label}.kind must be file, image or title`);
  }
}

/**
 * Check an untrusted plan (from an API body, an IPC call or CLI flags) and
 * return a normalized copy: ranges sorted and merged where they overlap, fades
 * defaulted to 0, bumpers filled in. `sourceDuration`, when known, clamps
 * ranges to the end of the source.
 */
export function validatePlan(input: unknown, sourceDuration?: number | null): EditPlan {
  if (!input || typeof input !== 'object') throw new EditPlanError('The edit plan is missing');
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.keep) || raw.keep.length === 0)
    throw new EditPlanError('Keep at least one range of the recording');
  if (raw.keep.length > LIMITS.maxRanges)
    throw new EditPlanError(`At most ${String(LIMITS.maxRanges)} ranges`);

  const max = finite(sourceDuration) && sourceDuration > 0 ? sourceDuration : Infinity;
  const ranges: KeepRange[] = raw.keep.map((r: unknown, i) => {
    const range = (r ?? {}) as Record<string, unknown>;
    const { start, end } = range;
    if (!finite(start) || !finite(end))
      throw new EditPlanError(`Range ${String(i + 1)} needs a start and an end`);
    if (start < 0) throw new EditPlanError(`Range ${String(i + 1)} starts before 0`);
    const clampedEnd = Math.min(end, max);
    if (clampedEnd - start < 0.1)
      throw new EditPlanError(`Range ${String(i + 1)} is empty or past the end of the recording`);
    return { start, end: clampedEnd };
  });

  const keep = mergeRanges(ranges);
  const fadeIn = checkFade(raw.fadeIn, 'fadeIn');
  const fadeOut = checkFade(raw.fadeOut, 'fadeOut');
  if (fadeIn + fadeOut > keptDuration(keep))
    throw new EditPlanError('The fades are longer than what is kept');

  const out = (raw.output ?? {}) as Record<string, unknown>;
  const format = out.format ?? 'mp4';
  if (format !== 'mp4' && format !== 'webm')
    throw new EditPlanError('output.format must be mp4 or webm');
  const edge = (v: unknown, label: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (!finite(v) || v < 16 || v > LIMITS.maxEdge)
      throw new EditPlanError(`output.${label} must be 16-${String(LIMITS.maxEdge)}`);
    return even(v);
  };
  const fps = out.fps;
  if (fps !== undefined && (!finite(fps) || fps < 1 || fps > 120))
    throw new EditPlanError('output.fps must be 1-120');

  return {
    keep,
    fadeIn,
    fadeOut,
    intro: checkBumper(raw.intro, 'intro'),
    outro: checkBumper(raw.outro, 'outro'),
    output: {
      format,
      width: edge(out.width, 'width'),
      height: edge(out.height, 'height'),
      fps: fps as number | undefined,
    },
  };
}

/**
 * Keep ranges in playback order. Ranges are played in the order given, but
 * overlapping or touching neighbours (after sorting) would play the same
 * footage twice, which is never what a trim means, so they are sorted and
 * merged.
 */
export function mergeRanges(ranges: KeepRange[]): KeepRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: KeepRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.001) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

export function keptDuration(keep: KeepRange[]): number {
  return keep.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/**
 * Remove a range from the kept footage (the "cut this bit out" gesture):
 * returns the keep ranges with [start, end) taken out, splitting a range
 * when the cut falls inside it.
 */
export function cutRange(keep: KeepRange[], start: number, end: number): KeepRange[] {
  const out: KeepRange[] = [];
  for (const r of keep) {
    if (end <= r.start || start >= r.end) {
      out.push({ ...r });
      continue;
    }
    if (start - r.start >= 0.1) out.push({ start: r.start, end: start });
    if (r.end - end >= 0.1) out.push({ start: end, end: r.end });
  }
  return out;
}

export function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}
