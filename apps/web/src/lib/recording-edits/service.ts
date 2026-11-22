/**
 * Start a cloud edit: the one entry point for POST /api/v1/recordings/:id/edits
 * and the edit_recording MCP tool.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

import { randomUUID } from 'node:crypto';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { RecordingEditError, preparePlan } from './sources';
import {
  RECORDING_COLUMNS,
  RECORDINGS_BUCKET,
  getOwnedRecording,
  sourceUrl,
  type RecordingRow,
} from './store';
import { claimUserSlot, enqueueEdit, releaseUserSlot } from './worker';

type Db = any;

const g = globalThis as typeof globalThis & { __pairuxEditLimiter?: FixedWindowRateLimiter };
/** Ten renders an hour per user: each one is minutes of server CPU. */
const rendersPerUser = (g.__pairuxEditLimiter ??= new FixedWindowRateLimiter(10, 60 * 60_000));

export { RecordingEditError };

export async function createEdit(
  db: Db,
  userId: string,
  sourceId: string,
  body: unknown
): Promise<RecordingRow> {
  const source = await getOwnedRecording(db, userId, sourceId);
  if (!source) throw new RecordingEditError('Recording not found', 404);
  if (source.status !== 'ready')
    throw new RecordingEditError('That recording is not ready yet', 409);
  const url = sourceUrl(db, source);
  if (!url) throw new RecordingEditError('That recording has no file', 409);

  const input = (body ?? {}) as { plan?: unknown; subject?: unknown };
  const { stored, render } = await preparePlan(input.plan, source.duration_seconds, async (id) => {
    const row = await getOwnedRecording(db, userId, id);
    return row?.status === 'ready' ? sourceUrl(db, row) : null;
  });

  if (!claimUserSlot(userId))
    throw new RecordingEditError('You already have an edit rendering; wait for it to finish', 409);
  const limit = rendersPerUser.check(userId);
  if (!limit.success) {
    releaseUserSlot(userId);
    throw new RecordingEditError(
      `Too many edits this hour; try again in ${String(Math.ceil(limit.retryAfterSeconds / 60))} min`,
      429
    );
  }

  const subject =
    typeof input.subject === 'string' && input.subject.trim()
      ? input.subject.trim().slice(0, 200)
      : `${source.subject ?? 'Recording'} (edit)`;
  const id = randomUUID();
  const storagePath = `edits/${userId}/${id}.mp4`;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('recordings')
    .insert({
      id,
      session_id: source.session_id,
      // NULL keeps edits off channel pages (they filter on channel_id).
      channel_id: null,
      creator_id: userId,
      subject,
      storage_path: storagePath,
      status: 'processing',
      parent_recording_id: source.id,
      edit_plan: stored,
      edit_progress: 0,
      edit_updated_at: now,
      started_at: now,
    })
    .select(RECORDING_COLUMNS)
    .single();
  if (error || !data) {
    releaseUserSlot(userId);
    throw new RecordingEditError('Could not start the edit', 500);
  }

  enqueueEdit(db, { recordingId: id, userId, storagePath, sourceUrl: url, plan: render });
  return data as RecordingRow;
}

/** Delete an edit (never an original recording) and its file. */
export async function deleteEdit(db: Db, userId: string, id: string): Promise<void> {
  const row = await getOwnedRecording(db, userId, id);
  if (!row) throw new RecordingEditError('Recording not found', 404);
  if (!row.parent_recording_id) throw new RecordingEditError('Only edits can be deleted here', 403);
  if (row.status === 'processing')
    throw new RecordingEditError('That edit is still rendering', 409);
  if (row.storage_path) await db.storage.from(RECORDINGS_BUCKET).remove([row.storage_path]);
  await db.from('recordings').delete().eq('id', id);
}
