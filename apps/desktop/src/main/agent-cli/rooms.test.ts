import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { run, type Deps } from './commands';

const room = (over: Record<string, unknown>) => ({
  id: 'r1',
  slug: 'anthony-ettinger',
  name: "Anthony Ettinger's room",
  url: 'https://pairux.test/m/anthony-ettinger',
  is_default: true,
  settings: { mode: 'p2p', locked: false },
  current_session_id: null,
  created_at: '2026-11-22T00:00:00Z',
  ...over,
});

let dir: string;
let out: string[];
let err: string[];
let calls: { method: string; path: string; body: string | null; auth: string | null }[];
let rooms: ReturnType<typeof room>[];

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
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({
        method,
        path: url.pathname,
        body,
        auth: 'Authorization' in headers ? headers.Authorization : null,
      });
      const ok = (data: unknown, status = 200) =>
        new Response(JSON.stringify({ data }), { status });
      if (url.pathname === '/api/v1/me/rooms' && method === 'GET') return ok({ rooms });
      if (url.pathname === '/api/v1/me/rooms' && method === 'POST') {
        const b = JSON.parse(body ?? '{}') as { name: string; slug?: string };
        const r = room({
          id: 'r2',
          slug: b.slug ?? 'office-hours',
          name: b.name,
          is_default: false,
          url: `https://pairux.test/m/${b.slug ?? 'office-hours'}`,
        });
        rooms.push(r);
        return ok({ room: r }, 201);
      }
      const m = /^\/api\/v1\/me\/rooms\/(.+)$/.exec(url.pathname);
      if (m && method === 'PATCH') {
        const r = rooms.find((x) => x.id === m[1]);
        return ok({ room: { ...r, ...(JSON.parse(body ?? '{}') as object) } });
      }
      if (m && method === 'DELETE') {
        const target = rooms.find((x) => x.id === m[1]);
        if (target?.is_default)
          return new Response(JSON.stringify({ error: 'This is your default room.' }), {
            status: 409,
          });
        return ok({ deleted: true });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }) as typeof fetch,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    openBrowser: () => undefined,
    sleep: () => Promise.resolve(),
    readStdin: () => Promise.resolve(null),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pairux-rooms-'));
  out = [];
  err = [];
  calls = [];
  rooms = [room({})];
  await writeFile(
    join(dir, 'in.json'),
    JSON.stringify({
      tokens: { accessToken: 'pux_at_x', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
    })
  );
});

describe('pairux room --mine / pairux rooms', () => {
  it('prints the default room link, signed in', async () => {
    expect(await run(['room', '--mine'], deps())).toBe(0);
    expect(out).toEqual(['https://pairux.test/m/anthony-ettinger']);
    expect(calls[0]?.auth).toBe('Bearer pux_at_x');
  });

  it('still prints an anonymous room without --mine, and needs sign-in for --mine', async () => {
    expect(await run(['room'], deps(false))).toBe(0);
    expect(out[0]).toMatch(/^https:\/\/pairux\.test\/r\/[A-Za-z0-9_-]+#k=/);
    expect(await run(['room', '--mine'], deps(false))).toBe(2);
    expect(await run(['rooms'], deps(false))).toBe(2);
  });

  it('lists, creates, renames, re-slugs, defaults, locks and removes', async () => {
    expect(await run(['rooms'], deps())).toBe(0);
    expect(out[0]).toContain('anthony-ettinger');
    expect(out[0]).toContain('default');
    expect(await run(['rooms', 'create', 'Office', 'hours'], deps())).toBe(0);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ name: 'Office hours' });
    expect(await run(['rooms', 'rename', 'office-hours', 'Client', 'calls'], deps())).toBe(0);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ name: 'Client calls' });
    expect(await run(['rooms', 'slug', 'office-hours', 'clients'], deps())).toBe(0);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ slug: 'clients' });
    expect(await run(['rooms', 'default', 'r2'], deps())).toBe(0);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ is_default: true });
    expect(await run(['rooms', 'lock', 'anthony-ettinger'], deps())).toBe(0);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ settings: { locked: true } });
    expect(await run(['rooms', 'rm', 'office-hours'], deps())).toBe(0);
    expect(calls.at(-1)?.method).toBe('DELETE');
  });

  it('reports the server refusing to delete the default room, and unknown rooms', async () => {
    expect(await run(['rooms', 'rm', 'anthony-ettinger'], deps())).toBe(1);
    expect(err.join('\n')).toMatch(/default room/);
    expect(await run(['rooms', 'rename', 'nope', 'x'], deps())).toBe(2);
    expect(await run(['rooms', 'frobnicate'], deps())).toBe(2);
  });
});
