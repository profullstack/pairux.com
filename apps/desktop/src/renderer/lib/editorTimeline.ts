/**
 * Pure helpers behind the editor timeline: mark handling, preview playback
 * that skips the cut parts, and turning UI state into an EditPlan.
 */

import {
  cutRange,
  mergeRanges,
  type Bumper,
  type EditPlan,
  type KeepRange,
} from '@pairux/video-edit';

export interface Selection {
  start: number;
  end: number;
}

/** In/out marks to a selection, in order, or null if not both set / empty. */
export function marksToSelection(inMark: number | null, outMark: number | null): Selection | null {
  if (inMark === null || outMark === null) return null;
  const start = Math.min(inMark, outMark);
  const end = Math.max(inMark, outMark);
  return end - start >= 0.1 ? { start, end } : null;
}

export function isWholeRecording(keep: KeepRange[], duration: number): boolean {
  const [only] = keep;
  return keep.length === 1 && only.start <= 0.05 && only.end >= duration - 0.05;
}

/**
 * Setting the out mark: the first time (nothing trimmed yet) the selection
 * becomes the only thing kept, which is the "an hour recorded, five minutes
 * wanted" flow; after that each selection is added to what is kept.
 */
export function applyOutMark(
  keep: KeepRange[],
  duration: number,
  selection: Selection
): KeepRange[] {
  if (isWholeRecording(keep, duration)) return [{ ...selection }];
  return mergeRanges([...keep, { ...selection }]);
}

export function keepOnly(selection: Selection): KeepRange[] {
  return [{ ...selection }];
}

export function addToKept(keep: KeepRange[], selection: Selection): KeepRange[] {
  return mergeRanges([...keep, { ...selection }]);
}

export function cutSelection(keep: KeepRange[], selection: Selection): KeepRange[] {
  return cutRange(keep, selection.start, selection.end);
}

export function removeSegment(keep: KeepRange[], index: number): KeepRange[] {
  return keep.filter((_, i) => i !== index);
}

export function segmentAt(keep: KeepRange[], t: number): number {
  return keep.findIndex((r) => t >= r.start && t < r.end);
}

/**
 * While previewing only the kept footage: where playback should be. Returns
 * the same time when inside a kept range, the next range's start when in a
 * gap, or null when past the last range (stop).
 */
export function previewPosition(keep: KeepRange[], t: number): number | null {
  const sorted = [...keep].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    if (t < r.start) return r.start;
    if (t < r.end - 0.03) return t;
  }
  return null;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type BumperMode = 'none' | 'title' | 'file' | 'image';

export interface BumperState {
  mode: BumperMode;
  text: string;
  subtitle: string;
  duration: number;
  background: string;
  color: string;
  source: string | null;
  sourceName: string | null;
  fadeIn: number;
  fadeOut: number;
}

export function emptyBumper(text: string): BumperState {
  return {
    mode: 'none',
    text,
    subtitle: '',
    duration: 3,
    background: '#0b0b10',
    color: '#ffffff',
    source: null,
    sourceName: null,
    fadeIn: 0.5,
    fadeOut: 0.5,
  };
}

export function bumperToPlan(b: BumperState): Bumper | null {
  const fadeIn = b.fadeIn;
  // A card cannot fade for longer than it lasts.
  const cardFades = (d: number) => {
    const total = b.fadeIn + b.fadeOut;
    return total > d
      ? { fadeIn: (b.fadeIn * d) / total, fadeOut: (b.fadeOut * d) / total }
      : { fadeIn, fadeOut: b.fadeOut };
  };
  switch (b.mode) {
    case 'title':
      if (!b.text.trim()) return null;
      return {
        kind: 'title',
        text: b.text.trim(),
        subtitle: b.subtitle.trim() || undefined,
        duration: b.duration,
        background: b.background,
        color: b.color,
        ...cardFades(b.duration),
      };
    case 'image':
      if (!b.source) return null;
      return { kind: 'image', source: b.source, duration: b.duration, ...cardFades(b.duration) };
    case 'file':
      if (!b.source) return null;
      return { kind: 'file', source: b.source, fadeIn: b.fadeIn, fadeOut: b.fadeOut };
    default:
      return null;
  }
}

export function buildPlan(state: {
  keep: KeepRange[];
  fadeIn: number;
  fadeOut: number;
  intro: BumperState;
  outro: BumperState;
  format: 'mp4' | 'webm';
}): EditPlan {
  return {
    keep: state.keep,
    fadeIn: state.fadeIn,
    fadeOut: state.fadeOut,
    intro: bumperToPlan(state.intro),
    outro: bumperToPlan(state.outro),
    output: { format: state.format },
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
