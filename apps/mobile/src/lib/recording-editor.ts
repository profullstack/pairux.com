/**
 * Pure helpers behind the mobile recording editor: building keep ranges from
 * "Set in" / "Set out" taps, timeline geometry, and the EditPlan sent to
 * POST /api/v1/recordings/:id/edits.
 */
import {
  cutRange,
  keptDuration,
  mergeRanges,
  validatePlan,
  type Bumper,
  type EditPlan,
  type KeepRange,
} from '@pairux/video-edit';
import type { Recording } from './api/recordings';

export type BumperChoice =
  | { kind: 'none' }
  | { kind: 'title'; text: string; subtitle: string; duration: number }
  | { kind: 'recording'; recordingId: string };

export interface EditorState {
  keep: KeepRange[];
  fadeIn: number;
  fadeOut: number;
  intro: BumperChoice;
  outro: BumperChoice;
}

export const MAX_FADE = 5;

export function initialEditorState(): EditorState {
  return { keep: [], fadeIn: 0, fadeOut: 0, intro: { kind: 'none' }, outro: { kind: 'none' } };
}

/** A pending selection: in and out points, either of which may be unset. */
export interface Selection {
  in: number | null;
  out: number | null;
}

/** Ordered [start, end] for a selection, or null while incomplete or empty. */
export function selectionRange(sel: Selection): KeepRange | null {
  if (sel.in === null || sel.out === null) return null;
  const start = Math.min(sel.in, sel.out);
  const end = Math.max(sel.in, sel.out);
  return end - start >= 0.1 ? { start, end } : null;
}

/** Add the selection to the kept footage (overlaps merge). */
export function keepSelection(keep: KeepRange[], sel: Selection): KeepRange[] {
  const range = selectionRange(sel);
  return range ? mergeRanges([...keep, range]) : keep;
}

/**
 * Remove the selection. With nothing kept yet, "cut" means "keep everything
 * except this", which needs the source duration.
 */
export function cutSelection(
  keep: KeepRange[],
  sel: Selection,
  duration: number | null
): KeepRange[] {
  const range = selectionRange(sel);
  if (!range) return keep;
  const base =
    keep.length > 0 ? keep : duration && duration > 0 ? [{ start: 0, end: duration }] : [];
  return cutRange(base, range.start, range.end);
}

export function removeRange(keep: KeepRange[], index: number): KeepRange[] {
  return keep.filter((_, i) => i !== index);
}

export function clampFade(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_FADE, Math.max(0, Math.round(value * 2) / 2));
}

/** Left offset and width of a range on a track, as fractions 0-1. */
export function rangeGeometry(range: KeepRange, duration: number): { left: number; width: number } {
  if (!(duration > 0)) return { left: 0, width: 0 };
  const left = Math.min(1, Math.max(0, range.start / duration));
  const right = Math.min(1, Math.max(0, range.end / duration));
  return { left, width: Math.max(0, right - left) };
}

/** Seconds for a touch at `x` on a track `width` pixels wide. */
export function positionToTime(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return Math.min(duration, Math.max(0, (x / width) * duration));
}

function toBumper(choice: BumperChoice): Bumper | null {
  switch (choice.kind) {
    case 'none':
      return null;
    case 'title':
      return {
        kind: 'title',
        text: choice.text,
        ...(choice.subtitle.trim() ? { subtitle: choice.subtitle } : {}),
        duration: choice.duration,
        fadeIn: Math.min(0.5, choice.duration / 4),
        fadeOut: Math.min(0.5, choice.duration / 4),
      };
    case 'recording':
      return { kind: 'file', source: `recording:${choice.recordingId}`, fadeIn: 0.5, fadeOut: 0.5 };
  }
}

/**
 * The plan to POST. With no ranges kept, the whole recording is kept (so a
 * fades-and-intro-only edit works). Throws EditPlanError with a readable
 * message when the plan is invalid.
 */
export function buildPlan(state: EditorState, duration: number | null): EditPlan {
  const keep =
    state.keep.length > 0
      ? state.keep
      : duration && duration > 0
        ? [{ start: 0, end: duration }]
        : [];
  return validatePlan(
    {
      keep,
      fadeIn: state.fadeIn,
      fadeOut: state.fadeOut,
      intro: toBumper(state.intro),
      outro: toBumper(state.outro),
      output: { format: 'mp4' },
    },
    duration
  );
}

export function outputDuration(state: EditorState, duration: number | null): number {
  const keep =
    state.keep.length > 0
      ? state.keep
      : duration && duration > 0
        ? [{ start: 0, end: duration }]
        : [];
  const card = (c: BumperChoice) => (c.kind === 'title' ? c.duration : 0);
  return keptDuration(keep) + card(state.intro) + card(state.outro);
}

export function anyProcessing(recordings: Recording[]): boolean {
  return recordings.some((r) => r.status === 'processing' || r.status === 'recording');
}

/**
 * The pairux.com page that publishes a recording to c0mpute private storage.
 * It encrypts in the browser (WebCrypto) to the user's c0mpute identity, which
 * React Native cannot do without a crypto polyfill, so the app hands off to it.
 */
export function webPublishUrl(baseUrl: string, recordingId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/recordings/${encodeURIComponent(recordingId)}/publish`;
}

/** Deep link that opens the desktop editor on a recording. */
export function desktopEditLink(playbackUrl: string, title?: string | null): string {
  const t = title?.trim() ? `&title=${encodeURIComponent(title.trim())}` : '';
  return `pairux://edit?url=${encodeURIComponent(playbackUrl)}${t}`;
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? 'GB'}`;
}

/** A 0-1 fraction as a React Native percentage dimension. */
export function pct(fraction: number): `${number}%` {
  return `${String(Math.round(fraction * 10000) / 100)}%` as `${number}%`;
}
