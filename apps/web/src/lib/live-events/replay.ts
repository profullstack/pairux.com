/**
 * Meeting replays: a scheduled meeting's `replay_visibility` decides whether each
 * occurrence is recorded and where the replay is shown on its channel page.
 */
import type { ReplayVisibility } from '@pairux/shared-types';

export type ReplaySetting = 'off' | ReplayVisibility;

export const REPLAY_SETTINGS: readonly ReplaySetting[] = ['off', 'private', 'public'];

/** The replay setting a new room carries, or null when the meeting keeps none. */
export function replayOf(value: unknown, channelId: unknown): ReplayVisibility | null {
  if (value === 'public') return channelId ? 'public' : 'private';
  if (value === 'private') return 'private';
  return null;
}

/** /c/<handle>/replay/<id>: the page for one replay. */
export function replayPath(handle: string, recordingId: string): string {
  return `/c/${encodeURIComponent(handle)}/replay/${encodeURIComponent(recordingId)}`;
}

/** Where a channel recording links: its live page when it has a public room code, else its replay page. */
export function recordingHref(handle: string, r: { id: string; join_code: string | null }): string {
  return r.join_code ? `/l/${r.join_code}` : replayPath(handle, r.id);
}
