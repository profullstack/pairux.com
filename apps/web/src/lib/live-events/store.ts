/**
 * Live events CRUD for the signed-in host, shared by /api/v1/events, the
 * `pairux events` CLI and the MCP tools. A live event is a scheduled_sessions
 * row with a broadcast channel; `visibility = 'public'` lists it on the channel
 * page and in the channel's calendar feed.
 *
 * Writes go through the service client scoped to the host, so permission is
 * checked here: the host must be able to use the channel (can_use_resource:
 * own, team or org channel), the same rule the dashboard applies.
 *
 * Meetings with email invitees are managed in the dashboard, which sends the
 * update and cancellation emails; this API refuses to change them silently.
 */
import { getUniqueJoinCode } from '@/lib/join-code';
import type { LiveEventCreate, LiveEventUpdate } from '@/lib/validations';
import { eventUrl, viewerOccurrence, type PublicEventRow } from './public';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
type Svc = any;

export class LiveEventError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** Trimmed text, or null for empty / whitespace / missing. */
function blankToNull(s: string | null | undefined): string | null {
  const t = s?.trim() ?? '';
  return t === '' ? null : t;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^@?[A-Za-z0-9_]{3,30}$/;

const SELECT =
  'id, title, description, scheduled_at, duration_minutes, status, visibility, channel_id, ' +
  'recurrence_freq, recurrence_interval, recurrence_count, occurrences_elapsed, recurrence_anchor_at, updated_at, ' +
  'channel:channels(handle, name, avatar_url), scheduled_session_invitees(id)';

export interface LiveEventView {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  next_occurrence: string | null;
  duration_minutes: number;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  every: number;
  times: number;
  visibility: 'private' | 'public';
  channel: { handle: string; name: string } | null;
  invitee_count: number;
  /** Public page, when the event is public and on a channel. */
  url: string | null;
  calendar_url: string | null;
}

async function resolveChannel(
  svc: Svc,
  userId: string,
  channel: string
): Promise<{ id: string; handle: string }> {
  const raw = channel.trim();
  let q = svc.from('channels').select('id, handle, owner_id, org_id, team_id');
  if (UUID.test(raw)) q = q.eq('id', raw);
  else if (HANDLE.test(raw)) q = q.ilike('handle', raw.replace(/^@/, ''));
  else throw new LiveEventError('channel must be a channel id or handle');
  const { data: ch } = await q.maybeSingle();
  if (!ch) throw new LiveEventError('Channel not found or not yours', 403);
  const { data: ok } = await svc.rpc('can_use_resource', {
    p_owner: ch.owner_id,
    p_org: ch.org_id,
    p_team: ch.team_id,
    p_user: userId,
  });
  if (ok !== true) throw new LiveEventError('Channel not found or not yours', 403);
  return { id: ch.id as string, handle: ch.handle as string };
}

export function toView(row: any, origin: string, now = new Date()): LiveEventView {
  const channel = row.channel
    ? { handle: row.channel.handle as string, name: row.channel.name as string }
    : null;
  const listed = row.visibility === 'public' ? channel : null;
  const occ = channel
    ? viewerOccurrence(
        {
          ...(row as PublicEventRow),
          channel_handle: channel.handle,
          channel_name: channel.name,
          channel_avatar_url: null,
        },
        now
      )
    : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    starts_at: row.scheduled_at,
    next_occurrence: occ ? occ.startsAt.toISOString() : null,
    duration_minutes: row.duration_minutes,
    repeat: (row.recurrence_freq ?? 'none') as LiveEventView['repeat'],
    every: row.recurrence_interval ?? 1,
    times: row.recurrence_count ?? 0,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    channel,
    invitee_count: Array.isArray(row.scheduled_session_invitees)
      ? row.scheduled_session_invitees.length
      : 0,
    url: listed ? eventUrl(origin, row.id as string) : null,
    calendar_url: listed ? `${origin}/c/${listed.handle}/calendar.ics` : null,
  };
}

/** The host's events that are on a channel (live events), soonest first. */
export async function listMyEvents(
  svc: Svc,
  userId: string,
  origin: string
): Promise<LiveEventView[]> {
  const { data, error } = await svc
    .from('scheduled_sessions')
    .select(SELECT)
    .eq('host_user_id', userId)
    .eq('status', 'pending')
    .not('channel_id', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(200);
  if (error) throw new LiveEventError('Could not list events', 500);
  return ((data ?? []) as any[]).map((r) => toView(r, origin));
}

async function ownRow(svc: Svc, userId: string, id: string): Promise<any> {
  if (!UUID.test(id)) throw new LiveEventError('Event not found', 404);
  const { data } = await svc
    .from('scheduled_sessions')
    .select(SELECT)
    .eq('id', id)
    .eq('host_user_id', userId)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (!data) throw new LiveEventError('Event not found', 404);
  return data;
}

export async function getMyEvent(
  svc: Svc,
  userId: string,
  id: string,
  origin: string
): Promise<LiveEventView> {
  return toView(await ownRow(svc, userId, id), origin);
}

export async function createEvent(
  svc: Svc,
  userId: string,
  input: LiveEventCreate,
  origin: string
): Promise<LiveEventView> {
  const channel = await resolveChannel(svc, userId, input.channel);
  const repeating = input.repeat !== 'none';
  const joinCode = await getUniqueJoinCode(svc as Parameters<typeof getUniqueJoinCode>[0]);
  const startsAt = new Date(input.startsAt).toISOString();
  const { data, error } = await svc
    .from('scheduled_sessions')
    .insert({
      host_user_id: userId,
      title: input.title,
      description: blankToNull(input.description),
      scheduled_at: startsAt,
      duration_minutes: input.durationMinutes,
      join_code: joinCode,
      channel_id: channel.id,
      visibility: input.visibility,
      recurrence_freq: repeating ? input.repeat : null,
      recurrence_interval: repeating ? input.every : 1,
      recurrence_count: repeating ? input.times : 0,
      occurrences_elapsed: 0,
      recurrence_anchor_at: startsAt,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw new LiveEventError('Could not create the event', 500);
  return toView(data, origin);
}

export async function updateEvent(
  svc: Svc,
  userId: string,
  id: string,
  input: LiveEventUpdate,
  origin: string
): Promise<LiveEventView> {
  const row = await ownRow(svc, userId, id);
  if ((row.scheduled_session_invitees?.length ?? 0) > 0) {
    throw new LiveEventError(
      'This meeting has email invitees; edit it in the PairUX dashboard so they are notified',
      409
    );
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = blankToNull(input.description);
  if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes;
  if (input.channel !== undefined)
    patch.channel_id = (await resolveChannel(svc, userId, input.channel)).id;
  if (input.visibility !== undefined) patch.visibility = input.visibility;

  // A new time or a new repeat pattern starts the series over from that time.
  const startsAt =
    input.startsAt !== undefined ? new Date(input.startsAt).toISOString() : undefined;
  const repeatChanged =
    input.repeat !== undefined || input.every !== undefined || input.times !== undefined;
  if (startsAt) patch.scheduled_at = startsAt;
  if (repeatChanged) {
    const repeat = input.repeat ?? row.recurrence_freq ?? 'none';
    const on = repeat !== 'none';
    patch.recurrence_freq = on ? repeat : null;
    patch.recurrence_interval = on ? (input.every ?? row.recurrence_interval ?? 1) : 1;
    patch.recurrence_count = on ? (input.times ?? row.recurrence_count ?? 0) : 0;
  }
  if (startsAt || repeatChanged) {
    patch.recurrence_anchor_at = startsAt ?? row.scheduled_at;
    patch.occurrences_elapsed = 0;
  }

  const { data, error } = await svc
    .from('scheduled_sessions')
    .update(patch)
    .eq('id', id)
    .eq('host_user_id', userId)
    .select(SELECT)
    .single();
  if (error || !data) throw new LiveEventError('Could not update the event', 500);
  return toView(data, origin);
}

/** Cancel (the row stays, as everywhere else in PairUX); it leaves every page and feed at once. */
export async function deleteEvent(
  svc: Svc,
  userId: string,
  id: string
): Promise<{ id: string; status: 'cancelled' }> {
  const row = await ownRow(svc, userId, id);
  if ((row.scheduled_session_invitees?.length ?? 0) > 0) {
    throw new LiveEventError(
      'This meeting has email invitees; cancel it in the PairUX dashboard so they are notified',
      409
    );
  }
  const { error } = await svc
    .from('scheduled_sessions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('host_user_id', userId);
  if (error) throw new LiveEventError('Could not cancel the event', 500);
  return { id, status: 'cancelled' };
}
