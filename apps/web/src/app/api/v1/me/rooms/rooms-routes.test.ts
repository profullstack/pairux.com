/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';

/**
 * Personal rooms: the table is deny-by-default and these routes use the
 * service role, so ownership and the default-room rules are the security story.
 */

const ME = 'user-me';
const OTHER = 'user-other';
const MY_DEFAULT = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';

let db: ReturnType<typeof createMemoryDb>;
let currentUser: { id: string } | null = { id: ME };

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => db }));
vi.mock('@/lib/request-user', () => ({ requestUser: () => Promise.resolve(currentUser) }));

const { GET: list, POST: create } = await import('./route');
const { GET: getOne, PATCH: patch, DELETE: remove } = await import('./[roomId]/route');
const { GET: publicGet } = await import('../../rooms/[slug]/route');

const ctx = (roomId: string) => ({ params: Promise.resolve({ roomId }) });
const json = (method: string, body?: unknown) =>
  new Request('http://localhost/api/v1/me/rooms', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const data = async (res: Response) => (await res.json()) as { data?: any; error?: string };

const room = (over: Record<string, unknown>) => ({
  settings: { mode: 'p2p', locked: false },
  current_session_id: null,
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
  is_default: false,
  ...over,
});

beforeEach(() => {
  currentUser = { id: ME };
  db = createMemoryDb({
    personal_rooms: [
      room({ id: MY_DEFAULT, owner_id: ME, slug: 'me-room', name: "Me's room", is_default: true }),
      room({
        id: THEIRS,
        owner_id: OTHER,
        slug: 'their-room',
        name: 'Their room',
        is_default: true,
      }),
    ],
    profiles: [{ id: OTHER, display_name: 'Them', avatar_url: null }],
    sessions: [],
  });
});

describe('/api/v1/me/rooms', () => {
  it('needs a sign-in', async () => {
    currentUser = null;
    expect((await list(json('GET'))).status).toBe(401);
  });

  it('lists only my rooms, default first, with links', async () => {
    const body = await data(await list(json('GET')));
    expect(body.data.rooms.map((r: any) => r.slug)).toEqual(['me-room']);
    expect(body.data.rooms[0].url).toMatch(/\/m\/me-room$/);
  });

  it('creates a room with a slug from its name, and refuses taken or reserved slugs', async () => {
    const res = await create(json('POST', { name: 'Office Hours' }));
    expect(res.status).toBe(201);
    expect((await data(res)).data.room.slug).toBe('office-hours');
    expect((await create(json('POST', { name: 'x', slug: 'their-room' }))).status).toBe(409);
    expect((await create(json('POST', { name: 'x', slug: 'settings' }))).status).toBe(400);
  });

  it('cannot read, change or delete someone else’s room', async () => {
    expect((await getOne(json('GET'), ctx(THEIRS))).status).toBe(404);
    expect((await patch(json('PATCH', { name: 'mine now' }), ctx(THEIRS))).status).toBe(404);
    expect((await remove(json('DELETE'), ctx(THEIRS))).status).toBe(404);
  });

  it('keeps exactly one default and never deletes it', async () => {
    expect((await remove(json('DELETE'), ctx(MY_DEFAULT))).status).toBe(409);
    expect((await patch(json('PATCH', { is_default: false }), ctx(MY_DEFAULT))).status).toBe(400);
    const second = (await data(await create(json('POST', { name: 'Second' })))).data.room;
    const res = await patch(json('PATCH', { is_default: true }), ctx(second.id));
    expect(res.status).toBe(200);
    const rooms = (await data(await list(json('GET')))).data.rooms;
    expect(rooms.filter((r: any) => r.is_default).map((r: any) => r.id)).toEqual([second.id]);
    expect((await remove(json('DELETE'), ctx(MY_DEFAULT))).status).toBe(200);
  });

  it('validates settings', async () => {
    expect(
      (await patch(json('PATCH', { settings: { mode: 'mesh' } }), ctx(MY_DEFAULT))).status
    ).toBe(400);
    const res = await patch(json('PATCH', { settings: { locked: true } }), ctx(MY_DEFAULT));
    expect((await data(res)).data.room.settings).toEqual({ mode: 'p2p', locked: true });
  });
});

describe('/api/v1/rooms/<slug> (public)', () => {
  it('shows the owner and hides the join code while the host is away', async () => {
    currentUser = null;
    const res = await publicGet(json('GET'), { params: Promise.resolve({ slug: 'their-room' }) });
    const body = await data(res);
    expect(body.data.room).toMatchObject({
      name: 'Their room',
      live: false,
      join_code: null,
      is_owner: false,
    });
    expect(body.data.room.owner.display_name).toBe('Them');
    expect(
      (await publicGet(json('GET'), { params: Promise.resolve({ slug: 'nope-nope' }) })).status
    ).toBe(404);
  });

  it('gives guests the join code only while the host is live and the room unlocked', async () => {
    currentUser = null;
    const fresh = new Date().toISOString();
    db = createMemoryDb({
      personal_rooms: [
        room({
          id: THEIRS,
          owner_id: OTHER,
          slug: 'their-room',
          name: 'R',
          is_default: true,
          current_session_id: 'S1',
        }),
      ],
      profiles: [{ id: OTHER, display_name: 'Them', avatar_url: null }],
      sessions: [
        {
          id: 'S1',
          join_code: 'ABC123',
          status: 'active',
          current_host_id: OTHER,
          host_last_seen_at: fresh,
        },
      ],
    });
    const live = await data(
      await publicGet(json('GET'), { params: Promise.resolve({ slug: 'their-room' }) })
    );
    expect(live.data.room).toMatchObject({ live: true, join_code: 'ABC123' });
  });
});
