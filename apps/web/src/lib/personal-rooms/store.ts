/**
 * Personal rooms for /api/v1/me/rooms, /api/v1/rooms/<slug>, the MCP tools and
 * the /m/<slug> page. The table is deny-by-default under RLS; everything goes
 * through the service client after an ownership check here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

import { MAX_ROOMS_PER_USER, roomUrl, slugBase, slugProblem, uniqueSlug } from './slug';

type Db = any;

export interface RoomSettings {
  mode: 'p2p' | 'sfu';
  /** Nobody new can join while locked. */
  locked: boolean;
}

export interface RoomRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  is_default: boolean;
  settings: Partial<RoomSettings> | null;
  current_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomView {
  id: string;
  slug: string;
  name: string;
  url: string;
  is_default: boolean;
  settings: RoomSettings;
  current_session_id: string | null;
  created_at: string;
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

const COLUMNS =
  'id, owner_id, slug, name, is_default, settings, current_session_id, created_at, updated_at';

/** How long after the host's last heartbeat a session still counts as live (get_public_session). */
export const LIVE_TTL_MS = 90_000;

export function normalizeSettings(s: Partial<RoomSettings> | null | undefined): RoomSettings {
  return { mode: s?.mode === 'sfu' ? 'sfu' : 'p2p', locked: s?.locked === true };
}

export function toView(row: RoomRow, origin?: string): RoomView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    url: roomUrl(row.slug, origin),
    is_default: row.is_default,
    settings: normalizeSettings(row.settings),
    current_session_id: row.current_session_id,
    created_at: row.created_at,
  };
}

/** The user's rooms, default first. Creates the default room if it is missing. */
export async function listRooms(db: Db, userId: string): Promise<RoomRow[]> {
  let { data } = await db
    .from('personal_rooms')
    .select(COLUMNS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true });
  let rows = (data ?? []) as RoomRow[];
  if (!rows.some((r) => r.is_default)) {
    await db.rpc('ensure_default_personal_room', { p_user: userId });
    ({ data } = await db
      .from('personal_rooms')
      .select(COLUMNS)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true }));
    rows = (data ?? []) as RoomRow[];
  }
  return [...rows].sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

export async function getOwnedRoom(db: Db, userId: string, id: string): Promise<RoomRow | null> {
  const { data } = await db.from('personal_rooms').select(COLUMNS).eq('id', id).maybeSingle();
  const row = data as RoomRow | null;
  return row?.owner_id === userId ? row : null;
}

export async function getRoomBySlug(db: Db, slug: string): Promise<RoomRow | null> {
  const { data } = await db
    .from('personal_rooms')
    .select(COLUMNS)
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  return (data as RoomRow | null) ?? null;
}

async function slugTaken(db: Db, slug: string, exceptId?: string): Promise<boolean> {
  const { data } = await db.from('personal_rooms').select('id').eq('slug', slug).maybeSingle();
  return Boolean(data && (data as { id: string }).id !== exceptId);
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new RoomError('Give the room a name');
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length > 80) throw new RoomError('Room names are at most 80 characters');
  return n;
}

function cleanSettings(input: unknown, base: RoomSettings): RoomSettings {
  if (input === undefined) return base;
  if (!input || typeof input !== 'object') throw new RoomError('settings must be an object');
  const s = input as Record<string, unknown>;
  const next = { ...base };
  if (s.mode !== undefined) {
    if (s.mode !== 'p2p' && s.mode !== 'sfu') throw new RoomError('settings.mode is p2p or sfu');
    next.mode = s.mode;
  }
  if (s.locked !== undefined) {
    if (typeof s.locked !== 'boolean') throw new RoomError('settings.locked is true or false');
    next.locked = s.locked;
  }
  return next;
}

async function checkSlug(db: Db, slug: unknown, exceptId?: string): Promise<string> {
  if (typeof slug !== 'string') throw new RoomError('slug must be text');
  const s = slug.trim().toLowerCase();
  const problem = slugProblem(s);
  if (problem) throw new RoomError(problem);
  if (await slugTaken(db, s, exceptId)) throw new RoomError('That link is taken', 409);
  return s;
}

export async function createRoom(
  db: Db,
  userId: string,
  body: { name?: unknown; slug?: unknown; settings?: unknown; is_default?: unknown }
): Promise<RoomRow> {
  const existing = await listRooms(db, userId);
  if (existing.length >= MAX_ROOMS_PER_USER)
    throw new RoomError(`You can have at most ${String(MAX_ROOMS_PER_USER)} rooms`, 409);
  const name = cleanName(body.name);
  let slug: string;
  if (body.slug !== undefined && body.slug !== '') slug = await checkSlug(db, body.slug);
  else {
    const taken = new Set<string>();
    const base = slugBase(name);
    // Collect the collisions for this base once, then pick the first free one.
    const { data } = await db.from('personal_rooms').select('slug').limit(1000);
    for (const r of (data ?? []) as { slug: string }[])
      if (r.slug === base || r.slug.startsWith(`${base}-`)) taken.add(r.slug);
    slug = uniqueSlug(base, (s) => taken.has(s));
  }
  const settings = cleanSettings(body.settings, normalizeSettings(null));
  const makeDefault = body.is_default === true;
  if (makeDefault)
    await db
      .from('personal_rooms')
      .update({ is_default: false })
      .eq('owner_id', userId)
      .eq('is_default', true);
  const { data, error } = await db
    .from('personal_rooms')
    .insert({ owner_id: userId, slug, name, settings, is_default: makeDefault })
    .select(COLUMNS)
    .single();
  if (error) {
    if (/duplicate|unique/i.test(String(error.message)))
      throw new RoomError('That link is taken', 409);
    throw new RoomError(String(error.message), 500);
  }
  return data as RoomRow;
}

export async function updateRoom(
  db: Db,
  userId: string,
  id: string,
  body: { name?: unknown; slug?: unknown; settings?: unknown; is_default?: unknown }
): Promise<RoomRow> {
  const room = await getOwnedRoom(db, userId, id);
  if (!room) throw new RoomError('Room not found', 404);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = cleanName(body.name);
  if (body.slug !== undefined && body.slug !== room.slug)
    patch.slug = await checkSlug(db, body.slug, room.id);
  if (body.settings !== undefined)
    patch.settings = cleanSettings(body.settings, normalizeSettings(room.settings));
  if (body.is_default === false && room.is_default)
    throw new RoomError('Make another room the default instead');
  if (body.is_default === true && !room.is_default) {
    await db
      .from('personal_rooms')
      .update({ is_default: false })
      .eq('owner_id', userId)
      .eq('is_default', true);
    patch.is_default = true;
  }
  if (Object.keys(patch).length === 0) return room;
  const { data, error } = await db
    .from('personal_rooms')
    .update(patch)
    .eq('id', room.id)
    .select(COLUMNS)
    .single();
  if (error) {
    if (/duplicate|unique/i.test(String(error.message)))
      throw new RoomError('That link is taken', 409);
    throw new RoomError(String(error.message), 500);
  }
  return data as RoomRow;
}

export async function deleteRoom(db: Db, userId: string, id: string): Promise<void> {
  const room = await getOwnedRoom(db, userId, id);
  if (!room) throw new RoomError('Room not found', 404);
  if (room.is_default)
    throw new RoomError('This is your default room. Make another room the default first.', 409);
  await db.from('personal_rooms').delete().eq('id', room.id);
}

interface SessionLite {
  id: string;
  join_code: string;
  status: string;
  current_host_id: string | null;
  host_last_seen_at: string | null;
}

/** The room's session if the host is in it right now. */
export async function liveSession(
  db: Db,
  room: RoomRow,
  now = Date.now()
): Promise<SessionLite | null> {
  const s = await roomSession(db, room);
  if (!s?.current_host_id || !s.host_last_seen_at) return null;
  return now - new Date(s.host_last_seen_at).getTime() < LIVE_TTL_MS ? s : null;
}

/** The room's session if it has one that has not ended (the owner can resume it). */
export async function roomSession(db: Db, room: RoomRow): Promise<SessionLite | null> {
  if (!room.current_session_id) return null;
  const { data } = await db
    .from('sessions')
    .select('id, join_code, status, current_host_id, host_last_seen_at')
    .eq('id', room.current_session_id)
    .maybeSingle();
  const s = data as SessionLite | null;
  return s && s.status !== 'ended' ? s : null;
}

export interface PublicRoom {
  slug: string;
  name: string;
  owner: { display_name: string | null; avatar_url: string | null };
  is_owner: boolean;
  locked: boolean;
  live: boolean;
  /** Only while live and not locked. */
  join_code: string | null;
}

export async function publicRoom(
  db: Db,
  room: RoomRow,
  viewerId: string | null
): Promise<PublicRoom> {
  const { data: profile } = await db
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', room.owner_id)
    .maybeSingle();
  const settings = normalizeSettings(room.settings);
  const live = await liveSession(db, room);
  const isOwner = viewerId === room.owner_id;
  return {
    slug: room.slug,
    name: room.name,
    owner: {
      display_name: (profile as { display_name?: string | null } | null)?.display_name ?? null,
      avatar_url: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
    },
    is_owner: isOwner,
    locked: settings.locked,
    live: Boolean(live),
    join_code: live && (!settings.locked || isOwner) ? live.join_code : null,
  };
}
