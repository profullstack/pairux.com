import type { TranscriptInput, TranscriptSegment } from './types.js';

/** Format a millisecond offset as `mm:ss` (minutes are not zero-capped at 60). */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Render one segment as `[mm:ss Speaker] text`. */
export function formatSegment(segment: TranscriptSegment): string {
  return `[${formatTimestamp(segment.startMs)} ${segment.speaker}] ${segment.text}`;
}

/** Render the whole transcript, one segment per line, for prompt inclusion. */
export function formatTranscript(input: TranscriptInput): string {
  return input.segments.map((segment) => formatSegment(segment)).join('\n');
}
