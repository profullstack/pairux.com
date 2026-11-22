import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/join-code', () => ({ getUniqueJoinCode: vi.fn(async () => 'JOIN1234') }));

import { createEvent, deleteEvent, LiveEventError, listMyEvents, updateEvent } from './store';
import { liveEventCreateSchema, liveEventUpdateSchema } from '@/lib/validations';

const ORIGIN = 'https://pairux.com';
const USER = 'u-host';
const CH = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  handle: 'chovy',
  owner_id: USER,
  org_id: null,
  team_id: null,
};
const EVENT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

/** A chainable stand-in for the Supabase client that records every call. */
function fakeSvc(opts: { canUse?: boolean; row?: Record<string, unknown> | null } = {}) {
  const calls: Call[] = [];
  const rpc = vi.fn(async () => ({ data: opts.canUse ?? true, error: null }));
  const from = (table: string) => {
    let op = 'select';
    let payload: unknown;
    const q: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push({ table, op: name, args });
        return q;
      };
    for (const m of ['eq', 'neq', 'not', 'order', 'limit', 'ilike']) q[m] = chain(m);
    q.select = (...args: unknown[]) => {
      calls.push({ table, op: 'select', args });
      return q;
    };
    q.insert = (p: unknown) => {
      op = 'insert';
      payload = p;
      calls.push({ table, op: 'insert', args: [p] });
      return q;
    };
    q.update = (p: unknown) => {
      op = 'update';
      payload = p;
      calls.push({ table, op: 'update', args: [p] });
      return q;
    };
    const result = () => {
      if (table === 'channels') return { data: CH, error: null };
      if (op === 'insert' || op === 'update')
        return {
          data: {
            ...(opts.row ?? {}),
            ...(payload as object),
            id: EVENT_ID,
            channel: { handle: 'chovy', name: 'Chovy' },
            scheduled_session_invitees: [],
          },
          error: null,
        };
      return { data: opts.row ?? null, error: null };
    };
    q.maybeSingle = async () => result();
    q.single = async () => result();
    q.then = (res: (v: unknown) => unknown) =>
      res({ data: opts.row ? [opts.row] : [], error: null });
    return q;
  };
  return { svc: { from, rpc }, calls, rpc };
}

const existing = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  title: 'Weekly outreach',
  description: null,
  scheduled_at: '2026-11-25T17:00:00Z',
  duration_minutes: 60,
  status: 'pending',
  visibility: 'public',
  channel_id: CH.id,
  recurrence_freq: 'weekly',
  recurrence_interval: 1,
  recurrence_count: 0,
  occurrences_elapsed: 3,
  recurrence_anchor_at: '2026-11-04T17:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
  channel: { handle: 'chovy', name: 'Chovy', avatar_url: null },
  scheduled_session_invitees: [],
  ...over,
});

beforeEach(() => vi.useRealTimers());

describe('createEvent', () => {
  it('resolves the channel by handle, checks can_use_resource for this user and inserts a public weekly event', async () => {
    const { svc, calls, rpc } = fakeSvc();
    const input = liveEventCreateSchema.parse({
      title: 'Weekly outreach',
      startsAt: '2026-11-25T17:00:00Z',
      channel: '@chovy',
      repeat: 'weekly',
    });
    const view = await createEvent(svc, USER, input, ORIGIN);
    expect(rpc).toHaveBeenCalledWith('can_use_resource', {
      p_owner: USER,
      p_org: null,
      p_team: null,
      p_user: USER,
    });
    const insert = calls.find((c) => c.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      host_user_id: USER,
      channel_id: CH.id,
      visibility: 'public',
      recurrence_freq: 'weekly',
      recurrence_anchor_at: '2026-11-25T17:00:00.000Z',
      join_code: 'JOIN1234',
    });
    expect(view.url).toBe(`${ORIGIN}/e/${EVENT_ID}`);
    expect(view.calendar_url).toBe(`${ORIGIN}/c/chovy/calendar.ics`);
  });

  it('refuses a channel the user cannot use, and junk channel names', async () => {
    const input = liveEventCreateSchema.parse({
      title: 't',
      startsAt: '2026-11-25T17:00:00Z',
      channel: 'chovy',
    });
    await expect(
      createEvent(fakeSvc({ canUse: false }).svc, USER, input, ORIGIN)
    ).rejects.toMatchObject({ status: 403 });
    const bad = { ...input, channel: 'not a handle!' };
    await expect(createEvent(fakeSvc().svc, USER, bad, ORIGIN)).rejects.toBeInstanceOf(
      LiveEventError
    );
  });

  it('validates input', () => {
    expect(() => liveEventCreateSchema.parse({ title: '', startsAt: 'x', channel: '' })).toThrow();
    expect(() =>
      liveEventCreateSchema.parse({
        title: 't',
        startsAt: '2026-11-25T17:00:00Z',
        channel: 'c',
        durationMinutes: 5,
      })
    ).toThrow();
    expect(
      liveEventCreateSchema.parse({
        title: 't',
        startsAt: '2026-11-25T09:00:00-08:00',
        channel: 'c',
      }).visibility
    ).toBe('public');
    expect(() => liveEventUpdateSchema.parse({})).toThrow();
  });
});

describe('updateEvent / deleteEvent', () => {
  it('scopes every query to the host and restarts the series from a new time', async () => {
    const { svc, calls } = fakeSvc({ row: existing() });
    const input = liveEventUpdateSchema.parse({ startsAt: '2026-11-26T18:00:00Z' });
    await updateEvent(svc, USER, EVENT_ID, input, ORIGIN);
    expect(
      calls
        .filter((c) => c.op === 'eq' && c.args[0] === 'host_user_id')
        .every((c) => c.args[1] === USER)
    ).toBe(true);
    expect(
      calls.filter((c) => c.op === 'eq' && c.args[0] === 'host_user_id').length
    ).toBeGreaterThanOrEqual(2);
    const patch = calls.find((c) => c.op === 'update')!.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      scheduled_at: '2026-11-26T18:00:00.000Z',
      recurrence_anchor_at: '2026-11-26T18:00:00.000Z',
      occurrences_elapsed: 0,
    });
  });

  it('turns repetition off cleanly', async () => {
    const { svc, calls } = fakeSvc({ row: existing() });
    await updateEvent(svc, USER, EVENT_ID, liveEventUpdateSchema.parse({ repeat: 'none' }), ORIGIN);
    const patch = calls.find((c) => c.op === 'update')!.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      recurrence_freq: null,
      recurrence_interval: 1,
      recurrence_count: 0,
    });
  });

  it('refuses meetings with email invitees so the dashboard can notify them', async () => {
    const withGuests = existing({ scheduled_session_invitees: [{ id: 'i1' }] });
    await expect(
      updateEvent(
        fakeSvc({ row: withGuests }).svc,
        USER,
        EVENT_ID,
        liveEventUpdateSchema.parse({ title: 'x' }),
        ORIGIN
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      deleteEvent(fakeSvc({ row: withGuests }).svc, USER, EVENT_ID)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cancels instead of deleting, and 404s for someone else’s or a bad id', async () => {
    const { svc, calls } = fakeSvc({ row: existing() });
    expect(await deleteEvent(svc, USER, EVENT_ID)).toEqual({ id: EVENT_ID, status: 'cancelled' });
    expect(calls.find((c) => c.op === 'update')!.args[0]).toMatchObject({ status: 'cancelled' });
    await expect(deleteEvent(fakeSvc({ row: null }).svc, USER, EVENT_ID)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      deleteEvent(fakeSvc({ row: existing() }).svc, USER, "1' or 1=1")
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('listMyEvents', () => {
  it('lists only the host’s pending channel events', async () => {
    const { svc, calls } = fakeSvc({ row: existing() });
    const list = await listMyEvents(svc, USER, ORIGIN);
    expect(list).toHaveLength(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'eq', args: ['host_user_id', USER] }),
        expect.objectContaining({ op: 'eq', args: ['status', 'pending'] }),
        expect.objectContaining({ op: 'not', args: ['channel_id', 'is', null] }),
      ])
    );
    expect(list[0]).toMatchObject({
      repeat: 'weekly',
      visibility: 'public',
      channel: { handle: 'chovy' },
    });
  });
});
