/**
 * Renders cloud edits in this server process: ffmpeg reads the parent
 * recording straight from storage over HTTP (each kept range is its own
 * seeked input, so a five-minute cut of an hour-long file downloads and
 * decodes about five minutes), writes a temp MP4, and the result is streamed
 * back into the recordings bucket.
 *
 * In-process on purpose, like call analysis: no queue service to run. A
 * deploy or crash mid-render leaves the row 'processing'; sweepStaleEdits
 * fails rows whose progress has not moved for 15 minutes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EditPlan } from '@pairux/video-edit';
import { RECORDINGS_BUCKET } from './store';

type Db = any;

export interface EditJob {
  recordingId: string;
  userId: string;
  storagePath: string;
  sourceUrl: string;
  plan: EditPlan;
}

const GLOBAL_CONCURRENCY = 2;
const PROGRESS_EVERY_MS = 2000;
export const STALE_AFTER_MS = 15 * 60_000;
const FONT = '/usr/share/fonts/dejavu/DejaVuSans.ttf';

interface Queue {
  running: number;
  waiting: EditJob[];
  /** Users with a render queued or running. */
  users: Set<string>;
  lastSweep: number;
}

// One queue per process even if Next bundles this module into several routes.
const g = globalThis as typeof globalThis & { __pairuxEditQueue?: Queue };
const queue: Queue = (g.__pairuxEditQueue ??= {
  running: 0,
  waiting: [],
  users: new Set(),
  lastSweep: 0,
});

/**
 * Claim the user's single render slot, synchronously, before any await, so two
 * requests at once cannot both start one. False when it is already taken.
 */
export function claimUserSlot(userId: string): boolean {
  if (queue.users.has(userId)) return false;
  queue.users.add(userId);
  return true;
}

export function releaseUserSlot(userId: string): void {
  queue.users.delete(userId);
}

export function enqueueEdit(db: Db, job: EditJob): void {
  queue.users.add(job.userId);
  queue.waiting.push(job);
  pump(db);
}

function pump(db: Db): void {
  while (queue.running < GLOBAL_CONCURRENCY && queue.waiting.length) {
    const job = queue.waiting.shift();
    if (!job) break;
    queue.running++;
    void processEdit(db, job)
      .catch((e: unknown) => {
        console.error('[recording-edits] job crashed:', e);
      })
      .finally(() => {
        queue.running--;
        queue.users.delete(job.userId);
        pump(db);
      });
  }
}

async function patch(db: Db, id: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('recordings')
    .update({ ...fields, edit_updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.warn('[recording-edits] update failed:', error);
}

export async function processEdit(db: Db, job: EditJob): Promise<void> {
  const { renderEdit } = await import('@pairux/video-edit/node');
  const dir = await mkdtemp(join(tmpdir(), 'pairux-edit-'));
  const output = join(dir, 'edit.mp4');
  let lastWrite = 0;
  try {
    const result = await renderEdit(job.plan, {
      ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
      source: job.sourceUrl,
      output,
      fontFile: existsSync(FONT) ? FONT : null,
      onProgress: (p) => {
        const now = Date.now();
        if (p.done || now - lastWrite < PROGRESS_EVERY_MS || p.fraction === null) return;
        lastWrite = now;
        // Rendering is 0-90%; the upload is the last stretch.
        void patch(db, job.recordingId, { edit_progress: Math.round(p.fraction * 90) / 100 });
      },
    });
    await patch(db, job.recordingId, { edit_progress: 0.9 });
    const { size } = await stat(output);
    const { error } = await db.storage
      .from(RECORDINGS_BUCKET)
      .upload(job.storagePath, createReadStream(output), {
        contentType: 'video/mp4',
        upsert: true,
      });
    if (error) throw new Error(`Upload failed: ${String(error.message ?? error)}`);
    const { data } = db.storage.from(RECORDINGS_BUCKET).getPublicUrl(job.storagePath);
    await patch(db, job.recordingId, {
      status: 'ready',
      playback_url: (data as { publicUrl?: string } | null)?.publicUrl ?? null,
      size_bytes: size,
      duration_seconds: Math.round(result.duration),
      edit_progress: 1,
      edit_error: null,
      ended_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[recording-edits] render failed:', message);
    await patch(db, job.recordingId, { status: 'failed', edit_error: message.slice(0, 500) });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Fail edits left 'processing' by a restart. Cheap and idempotent; called
 * from the list route at most once a minute per process.
 */
export async function sweepStaleEdits(db: Db, now = Date.now()): Promise<void> {
  if (now - queue.lastSweep < 60_000) return;
  queue.lastSweep = now;
  const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
  const { data } = await db
    .from('recordings')
    .select('id, creator_id, edit_updated_at')
    .eq('status', 'processing')
    .lt('edit_updated_at', cutoff)
    .limit(50);
  for (const row of (data ?? []) as { id: string; creator_id: string | null }[]) {
    // A render still running in this process is not stale, just slow to report.
    if (row.creator_id && queue.users.has(row.creator_id)) continue;
    await patch(db, row.id, {
      status: 'failed',
      edit_error: 'The render stopped (the server restarted). Try again.',
    });
  }
}
