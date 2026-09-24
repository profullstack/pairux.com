/**
 * Storage and bookkeeping for AI call analysis.
 *
 * Layout in the private `call-analysis` bucket, per analysis id:
 *   <id>/chunks/000000.bin …   call audio as uploaded, in order
 *   <id>/frames/0000123456.jpg screen stills, named by call time in ms
 *   <id>/recording.<ext>       the joined recording, kept when keep_recording
 *
 * Every function takes the service-role client explicitly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallAnalysisSettings, SessionSettings } from '@pairux/shared-types';

export const ANALYSIS_BUCKET = 'call-analysis';
/** How often clients send a still of the shared screen. */
export const FRAME_INTERVAL_MS = 20_000;
/** How much audio clients buffer before uploading a chunk. */
export const CHUNK_INTERVAL_MS = 15_000;
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
/** Hard ceiling on one capture, so a forgotten call cannot run up a bill. */
export const MAX_CHUNKS = Math.ceil((4 * 60 * 60 * 1000) / CHUNK_INTERVAL_MS);

export type Db = SupabaseClient;

export interface AnalysisRow {
  id: string;
  session_id: string;
  host_user_id: string;
  kind: CallAnalysisSettings['kind'];
  keep_recording: boolean;
  source: 'web' | 'desktop' | 'mobile';
  chunk_format: 'stream' | 'segments';
  mime_type: string;
  title: string | null;
  status: 'recording' | 'queued' | 'processing' | 'ready' | 'failed';
  chunk_count: number;
  frame_count: number;
  bytes: number;
  recording_path: string | null;
  duration_seconds: number | null;
  transcript: unknown;
  metrics: unknown;
  report: unknown;
  error: string | null;
  attempts: number;
  started_at: string;
  last_upload_at: string;
  queued_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * A chunk belongs to a recorder run (the ms timestamp the host's recorder
 * started) and has an index within it. Chunks of one run append into one file;
 * a host who reloads mid-call starts a new run, and runs are joined in order.
 */
export const chunkPath = (id: string, run: number, index: number) =>
  `${id}/chunks/${String(run).padStart(13, '0')}-${String(index).padStart(6, '0')}.bin`;

/** Chunk file names grouped by run, runs and chunks in order. */
export function groupChunksByRun(names: string[]): string[][] {
  const runs = new Map<string, string[]>();
  for (const name of [...names].sort()) {
    const run = /^(\d{13})-\d{6}\.bin$/.exec(name)?.[1];
    if (!run) continue;
    runs.set(run, [...(runs.get(run) ?? []), name]);
  }
  return [...runs.keys()].sort().map((run) => runs.get(run) ?? []);
}
export const framePath = (id: string, ms: number) =>
  `${id}/frames/${String(Math.max(0, Math.round(ms))).padStart(10, '0')}.jpg`;
export const recordingPathFor = (id: string, ext: string) => `${id}/recording.${ext}`;

/** Frame file name back to call time in ms. */
export function frameTimeMs(name: string): number {
  const match = /(\d+)\.jpg$/.exec(name);
  return match?.[1] ? Number(match[1]) : 0;
}

interface HostSession {
  id: string;
  status: string;
  subject: string | null;
  settings: SessionSettings | null;
}

/**
 * The session, if `userId` hosts it (owner, creator, or current host) and it
 * was created with analysis on. Anything else is null.
 */
export async function hostedAnalysisSession(
  db: Db,
  sessionId: string,
  userId: string
): Promise<(HostSession & { analysis: CallAnalysisSettings }) | null> {
  const { data } = (await db
    .from('sessions')
    .select('id, status, subject, settings, host_user_id, creator_id, current_host_id')
    .eq('id', sessionId)
    .maybeSingle()) as {
    data:
      | (HostSession & {
          host_user_id: string | null;
          creator_id: string | null;
          current_host_id: string | null;
        })
      | null;
  };
  if (!data) return null;
  const isHost = [data.host_user_id, data.creator_id, data.current_host_id].includes(userId);
  const analysis = data.settings?.analysis;
  if (!isHost || analysis?.enabled !== true) return null;
  return { ...data, analysis };
}

/** An analysis the user owns, or null. */
export async function ownedAnalysis(
  db: Db,
  id: string,
  userId: string
): Promise<AnalysisRow | null> {
  const { data } = (await db
    .from('call_analyses')
    .select('*')
    .eq('id', id)
    .eq('host_user_id', userId)
    .maybeSingle()) as { data: AnalysisRow | null };
  return data;
}

/** Call ended: every capture still recording for it goes to the report job. */
export async function queueSessionAnalyses(sessionId: string, db?: Db): Promise<void> {
  const client = db ?? (await import('@/lib/supabase/service')).serviceClient();
  await client
    .from('call_analyses')
    .update({ status: 'queued', queued_at: new Date().toISOString() } as never)
    .eq('session_id', sessionId)
    .eq('status', 'recording');
}

/** Remove every stored object for an analysis (chunks, frames, recording). */
export async function deleteAnalysisFiles(db: Db, id: string, keep: string[] = []): Promise<void> {
  for (const folder of ['chunks', 'frames']) {
    for (;;) {
      const { data } = await db.storage
        .from(ANALYSIS_BUCKET)
        .list(`${id}/${folder}`, { limit: 1000 });
      const paths = (data ?? []).map((f) => `${id}/${folder}/${f.name}`);
      if (paths.length === 0) break;
      await db.storage.from(ANALYSIS_BUCKET).remove(paths);
      if (paths.length < 1000) break;
    }
  }
  const { data: top } = await db.storage.from(ANALYSIS_BUCKET).list(id, { limit: 100 });
  const loose = (top ?? [])
    .filter((f) => /\.\w+$/.test(f.name)) // files only; folders (chunks, frames) have no extension
    .map((f) => `${id}/${f.name}`)
    .filter((p) => !keep.includes(p));
  if (loose.length > 0) await db.storage.from(ANALYSIS_BUCKET).remove(loose);
}
