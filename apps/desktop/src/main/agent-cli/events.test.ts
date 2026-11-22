import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { run, type Deps } from './commands';
import { parseWhen } from './events';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  title: 'Weekly outreach',
  description: null,
  starts_at: '2030-01-02T17:00:00.000Z',
  next_occurrence: '2030-01-02T17:00:00.000Z',
  duration_minutes: 60,
  repeat: 'weekly',
  every: 1,
  times: 0,
  visibility: 'public',
  channel: { handle: 'chovy', name: 'Chovy' },
  invitee_count: 0,
  url: 'https://pairux.test/e/e1',
  calendar_url: 'https://pairux.test/c/chovy/calendar.ics',
  ...over,
});

let dir: string;
let out: string[];
let calls: {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}[];

function deps(signedIn = true): Deps {
  return {
    env: { PAIRUX_API_URL: 'https://pairux.test' },
    configPath: join(dir, signedIn ? 'in.json' : 'out.json'),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      );
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({
        method,
        path: url.pathname,
        body,
        auth: 'Authorization' in headers ? headers.Authorization : null,
      });
      const ok = (data: unknown, status = 200) =>
        new Response(JSON.stringify({ data }), { status });
      if (url.pathname === '/api/v1/events' && method === 'GET') return ok([event()]);
      if (url.pathname === '/api/v1/events' && method === 'POST')
        return ok(event({ ...body, id: 'e2' }), 201);
      const m = /^\/api\/v1\/events\/(.+)$/.exec(url.pathname);
      if (m && method === 'PATCH') {
        if (m[1] === 'guests')
          return new Response(
            JSON.stringify({
              error:
                'This meeting has email invitees; edit it in the PairUX dashboard so they are notified',
            }),
            { status: 409 }
          );
        return ok(event({ id: m[1], ...body }));
      }
      if (m && method === 'DELETE') return ok({ id: m[1], status: 'cancelled' });
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }) as typeof fetch,
    out: (l) => out.push(l),
    err: () => undefined,
    openBrowser: () => undefined,
    sleep: () => Promise.resolve(),
    readStdin: () => Promise.resolve(null),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pairux-events-'));
  out = [];
  calls = [];
  await writeFile(
    join(dir, 'in.json'),
    JSON.stringify({
      tokens: { accessToken: 'pux_at_x', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
    })
  );
});

describe('pairux events', () => {
  it('lists events signed in, with the public page link', async () => {
    expect(await run(['events'], deps())).toBe(0);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/api/v1/events',
      auth: 'Bearer pux_at_x',
    });
    expect(out[0]).toContain('Weekly outreach');
    expect(out[0]).toContain('https://pairux.test/e/e1');
    expect(out[0]).toContain('@chovy');
  });

  it('adds a public weekly event from a local time', async () => {
    expect(
      await run(
        [
          'events',
          'add',
          'Weekly',
          'outreach',
          '--at',
          '2030-01-02T09:00',
          '--channel',
          'chovy',
          '--weekly',
          '--minutes',
          '45',
        ],
        deps()
      )
    ).toBe(0);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      title: 'Weekly outreach',
      channel: 'chovy',
      repeat: 'weekly',
      durationMinutes: 45,
      visibility: 'public',
      startsAt: new Date(2030, 0, 2, 9, 0).toISOString(),
    });
  });

  it('edits, unlists, re-lists and cancels', async () => {
    await run(['events', 'edit', 'e1', '--at', '2030-01-03T10:00', '--once'], deps());
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/api/v1/events/e1' });
    expect(calls.at(-1)!.body).toMatchObject({
      repeat: 'none',
      startsAt: new Date(2030, 0, 3, 10, 0).toISOString(),
    });
    await run(['events', 'private', 'e1'], deps());
    expect(calls.at(-1)!.body).toEqual({ visibility: 'private' });
    await run(['events', 'public', 'e1'], deps());
    expect(calls.at(-1)!.body).toEqual({ visibility: 'public' });
    await run(['events', 'rm', 'e1'], deps());
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/v1/events/e1' });
    expect(out.at(-1)).toBe('Cancelled e1.');
  });

  it('explains what is missing instead of calling the API', async () => {
    for (const argv of [
      ['events', 'add', 'x', '--channel', 'c'],
      ['events', 'add', 'x', '--at', '2030-01-02T09:00'],
      ['events', 'add', '--at', '2030-01-02T09:00', '--channel', 'c'],
      ['events', 'edit', 'e1'],
      ['events', 'rm'],
      ['events', 'add', 'x', '--at', '2030-01-02T09:00', '--channel', 'c', '--weekly', '--daily'],
      ['events', 'bogus'],
    ]) {
      expect(await run(argv, deps())).not.toBe(0);
    }
    expect(calls).toHaveLength(0);
  });

  it('needs a login', async () => {
    expect(await run(['events'], deps(false))).not.toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('surfaces the server refusal for meetings with invitees', async () => {
    expect(await run(['events', 'edit', 'guests', '--title', 'x'], deps())).not.toBe(0);
  });
});

describe('parseWhen', () => {
  it('reads local and ISO times and refuses junk and the past', () => {
    const now = new Date(2030, 0, 1);
    expect(parseWhen('2030-01-02T09:00', now)).toBe(new Date(2030, 0, 2, 9, 0).toISOString());
    expect(parseWhen('2030-01-02T09:00:00-08:00', now)).toBe('2030-01-02T17:00:00.000Z');
    expect(() => parseWhen('tomorrow-ish', now)).toThrow();
    expect(() => parseWhen('2029-12-01T09:00', now)).toThrow();
  });
});
