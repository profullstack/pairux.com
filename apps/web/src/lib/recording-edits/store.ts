/**
 * Recordings as their owner sees them, for /api/v1/recordings, the MCP tools
 * and the /recordings pages.
 *
 * A recording belongs to whoever created it (recordings.creator_id, which is
 * also the user on every edit) or to the creator/host of the session it was
 * recorded in. The table is deny-by-default under RLS, so everything here
 * goes through the service client after that ownership check.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

export const RECORDINGS_BUCKET = 'recordings';

export interface RecordingRow {
  id: string;
  session_id: string | null;
  creator_id: string | null;
  subject: string | null;
  status: 'recording' | 'processing' | 'ready' | 'failed';
  storage_path: string | null;
  playback_url: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  created_at: string;
  parent_recording_id: string | null;
  edit_plan: unknown;
  edit_progress: number | null;
  edit_error: string | null;
  edit_updated_at: string | null;
}

/** What the API returns for one recording. */
export interface RecordingView {
  id: string;
  subject: string | null;
  status: RecordingRow['status'];
  duration_seconds: number | null;
  size_bytes: number | null;
  playback_url: string | null;
  created_at: string;
  parent_recording_id: string | null;
  edit_progress: number | null;
  edit_error: string | null;
}

export const RECORDING_COLUMNS =
  'id, session_id, creator_id, subject, status, storage_path, playback_url, duration_seconds, size_bytes, created_at, parent_recording_id, edit_plan, edit_progress, edit_error, edit_updated_at';

export function toView(row: RecordingRow): RecordingView {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    duration_seconds: row.duration_seconds,
    size_bytes: row.size_bytes,
    playback_url: row.status === 'ready' ? row.playback_url : null,
    created_at: row.created_at,
    parent_recording_id: row.parent_recording_id,
    edit_progress: row.edit_progress,
    edit_error: row.edit_error,
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = any;

/** Sessions the user created or hosted. */
async function ownedSessionIds(db: Db, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const column of ['creator_id', 'host_user_id']) {
    const { data } = await db.from('sessions').select('id').eq(column, userId).limit(1000);
    for (const row of (data ?? []) as { id: string }[]) ids.add(row.id);
  }
  return [...ids];
}

export async function isOwner(db: Db, userId: string, row: RecordingRow): Promise<boolean> {
  if (row.creator_id === userId) return true;
  if (!row.session_id) return false;
  const { data } = await db
    .from('sessions')
    .select('id, creator_id, host_user_id')
    .eq('id', row.session_id)
    .maybeSingle();
  const s = data as { creator_id?: string | null; host_user_id?: string | null } | null;
  return Boolean(s && (s.creator_id === userId || s.host_user_id === userId));
}

/** One recording, or null when it does not exist or is not the user's. */
export async function getOwnedRecording(
  db: Db,
  userId: string,
  id: string
): Promise<RecordingRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db.from('recordings').select(RECORDING_COLUMNS).eq('id', id).maybeSingle();
  const row = data as RecordingRow | null;
  if (!row) return null;
  return (await isOwner(db, userId, row)) ? row : null;
}

/** The user's recordings and edits, newest first. */
export async function listOwnedRecordings(
  db: Db,
  userId: string,
  limit = 100
): Promise<RecordingRow[]> {
  const byId = new Map<string, RecordingRow>();
  const mine = await db
    .from('recordings')
    .select(RECORDING_COLUMNS)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  for (const row of (mine.data ?? []) as RecordingRow[]) byId.set(row.id, row);
  const sessions = await ownedSessionIds(db, userId);
  if (sessions.length) {
    const fromSessions = await db
      .from('recordings')
      .select(RECORDING_COLUMNS)
      .in('session_id', sessions.slice(0, 500))
      .order('created_at', { ascending: false })
      .limit(limit);
    for (const row of (fromSessions.data ?? []) as RecordingRow[]) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);
}

/** A playable/seekable URL for a ready recording. */
export function sourceUrl(db: Db, row: RecordingRow): string | null {
  if (row.playback_url) return row.playback_url;
  if (!row.storage_path) return null;
  const { data } = db.storage.from(RECORDINGS_BUCKET).getPublicUrl(row.storage_path);
  return (data as { publicUrl?: string } | null)?.publicUrl ?? null;
}
