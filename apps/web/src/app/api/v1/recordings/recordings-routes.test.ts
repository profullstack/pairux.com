import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';

/**
 * /api/v1/recordings: ownership is the whole security story (the table is
 * deny-by-default and these routes use the service role), so most of this is
 * about who can see, edit and delete what.
 */

const ME = 'user-me';
const OTHER = 'user-other';
const SESSION_I_HOST = '33333333-3333-4333-8333-333333333333';
const REC_MINE = '11111111-1111-4111-8111-111111111111';
const REC_HOSTED = '44444444-4444-4444-8444-444444444444';
const REC_THEIRS = '22222222-2222-4222-8222-222222222222';
const REC_LIVE = '55555555-5555-4555-8555-555555555555';

let db: ReturnType<typeof createMemoryDb> & { storage: unknown };
let currentUser: { id: string } | null = { id: ME };
const removed: string[][] = [];
const enqueued: unknown[] = [];
const slots = new Set<string>();

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => db }));
vi.mock('@/lib/request-user', () => ({ requestUser: () => Promise.resolve(currentUser) }));
vi.mock('@/lib/recording-edits/worker', () => ({
  enqueueEdit: (_db: unknown, job: unknown) => enqueued.push(job),
  claimUserSlot: (id: string) => (slots.has(id) ? false : (slots.add(id), true)),
  releaseUserSlot: (id: string) => slots.delete(id),
  sweepStaleEdits: () => Promise.resolve(),
}));

const { GET: list } = await import('./route');
const { GET: getOne, DELETE: remove } = await import('./[recordingId]/route');
const { POST: edit } = await import('./[recordingId]/edits/route');

const ctx = (recordingId: string) => ({ params: Promise.resolve({ recordingId }) });
const req = (body?: unknown) =>
  new Request('http://localhost/api/v1/recordings', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function rec(id: string, fields: Record<string, unknown>) {
  return {
    id,
    session_id: '99999999-9999-4999-8999-999999999999',
    creator_id: ME,
    subject: id,
    status: 'ready',
    storage_path: `sessions/x/${id}.mp4`,
    playback_url: `https://storage.example/${id}.mp4`,
    duration_seconds: 3600,
    size_bytes: 1000,
    created_at: '2026-11-01T00:00:00.000Z',
    parent_recording_id: null,
    edit_plan: null,
    edit_progress: null,
    edit_error: null,
    edit_updated_at: null,
    ...fields,
  };
}

beforeEach(() => {
  currentUser = { id: ME };
  removed.length = 0;
  enqueued.length = 0;
  slots.clear();
  const base = createMemoryDb({
    sessions: [{ id: SESSION_I_HOST, creator_id: OTHER, host_user_id: ME }],
    recordings: [
      rec(REC_MINE, { created_at: '2026-11-02T00:00:00.000Z' }),
      rec(REC_HOSTED, { creator_id: OTHER, session_id: SESSION_I_HOST }),
      rec(REC_THEIRS, { creator_id: OTHER, created_at: '2026-11-03T00:00:00.000Z' }),
      rec(REC_LIVE, { status: 'recording', created_at: '2026-11-04T00:00:00.000Z' }),
    ],
  });
  db = Object.assign(base, {
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removed.push(paths);
          return Promise.resolve({ data: null, error: null });
        },
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.example/${p}` } }),
      }),
    },
  });
});

const validPlan = { keep: [{ start: 2400, end: 2700 }], fadeIn: 1, fadeOut: 1 };

describe('GET /api/v1/recordings', () => {
  it('needs a user', async () => {
    currentUser = null;
    expect((await list(req())).status).toBe(401);
  });

  it('lists what I created and what was recorded in sessions I host, newest first, in the { data } envelope', async () => {
    const res = await list(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { recordings: { id: string; playback_url: unknown }[] };
    };
    expect(body.data.recordings.map((r) => r.id)).toEqual([REC_LIVE, REC_MINE, REC_HOSTED]);
    // Not ready → no playback URL.
    expect(body.data.recordings[0]?.playback_url).toBeNull();
  });
});

describe('GET /api/v1/recordings/:id', () => {
  it('404s for someone else’s recording and for junk ids', async () => {
    expect((await getOne(req(), ctx(REC_THEIRS))).status).toBe(404);
    expect((await getOne(req(), ctx('../etc'))).status).toBe(404);
  });
  it('returns mine', async () => {
    const res = await getOne(req(), ctx(REC_HOSTED));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { recording: { id: string } } }).data.recording.id).toBe(
      REC_HOSTED
    );
  });
});

describe('POST /api/v1/recordings/:id/edits', () => {
  it('starts a render: a new private row, the plan resolved, 202', async () => {
    const res = await edit(
      req({ plan: { ...validPlan, outro: { kind: 'file', source: `recording:${REC_HOSTED}` } } }),
      ctx(REC_MINE)
    );
    expect(res.status).toBe(202);
    const { data } = (await res.json()) as {
      data: { recording: { id: string; status: string; parent_recording_id: string } };
    };
    expect(data.recording).toMatchObject({ status: 'processing', parent_recording_id: REC_MINE });
    const row = db.tables.recordings?.find((r) => r.id === data.recording.id);
    expect(row).toMatchObject({ channel_id: null, creator_id: ME });
    expect(row?.storage_path).toBe(`edits/${ME}/${data.recording.id}.mp4`);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      sourceUrl: `https://storage.example/${REC_MINE}.mp4`,
      plan: { outro: { source: `https://storage.example/${REC_HOSTED}.mp4` } },
    });
  });

  it('allows one render at a time per user', async () => {
    expect((await edit(req({ plan: validPlan }), ctx(REC_MINE))).status).toBe(202);
    expect((await edit(req({ plan: validPlan }), ctx(REC_MINE))).status).toBe(409);
  });

  it('refuses bad plans, foreign recordings, unready recordings and arbitrary sources', async () => {
    expect((await edit(req({ plan: { keep: [] } }), ctx(REC_MINE))).status).toBe(400);
    expect((await edit(req({ plan: validPlan }), ctx(REC_THEIRS))).status).toBe(404);
    expect((await edit(req({ plan: validPlan }), ctx(REC_LIVE))).status).toBe(409);
    const ssrf = await edit(
      req({ plan: { ...validPlan, intro: { kind: 'file', source: 'http://169.254.169.254/' } } }),
      ctx(REC_MINE)
    );
    expect(ssrf.status).toBe(400);
    const theirs = await edit(
      req({ plan: { ...validPlan, intro: { kind: 'file', source: `recording:${REC_THEIRS}` } } }),
      ctx(REC_MINE)
    );
    expect(theirs.status).toBe(404);
    expect(enqueued).toHaveLength(0);
    expect(db.tables.recordings).toHaveLength(4);
  });

  it('needs a user', async () => {
    currentUser = null;
    expect((await edit(req({ plan: validPlan }), ctx(REC_MINE))).status).toBe(401);
  });
});

describe('DELETE /api/v1/recordings/:id', () => {
  it('never deletes an original recording', async () => {
    expect((await remove(req(), ctx(REC_MINE))).status).toBe(403);
    expect(removed).toHaveLength(0);
  });

  it('deletes my edit and its file, but not someone else’s', async () => {
    db.tables.recordings?.push(
      rec('66666666-6666-4666-8666-666666666666', {
        parent_recording_id: REC_MINE,
        storage_path: 'edits/user-me/6.mp4',
      }),
      rec('77777777-7777-4777-8777-777777777777', {
        creator_id: OTHER,
        parent_recording_id: REC_THEIRS,
      })
    );
    expect((await remove(req(), ctx('77777777-7777-4777-8777-777777777777'))).status).toBe(404);
    expect((await remove(req(), ctx('66666666-6666-4666-8666-666666666666'))).status).toBe(200);
    expect(removed).toEqual([['edits/user-me/6.mp4']]);
    expect(db.tables.recordings?.some((r) => r.id === '66666666-6666-4666-8666-666666666666')).toBe(
      false
    );
  });
});
