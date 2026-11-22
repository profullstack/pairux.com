import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditPlan, MediaInfo } from '@pairux/video-edit';
import { run, type Deps } from './commands';
import type { VideoDeps } from './video';

const UUID = '33333333-3333-4333-8333-333333333333';
const webm: MediaInfo = {
  duration: null,
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
};
const mp4: MediaInfo = { ...webm, duration: 3600 };

let dir: string;
let out: string[];
let err: string[];
let rendered: { plan: EditPlan; source: string; output: string }[];
let published: string[];
let remuxed: number;
let requests: { method: string; path: string; body: string | null; auth: string | null }[];

function video(overrides: Partial<VideoDeps> = {}, probe: MediaInfo[] = [mp4]): VideoDeps {
  const probes = [...probe];
  return {
    findFfmpeg: () => '/usr/bin/ffmpeg',
    probe: () => Promise.resolve(probes.length > 1 ? probes.shift()! : probes[0]),
    remux: () => {
      remuxed++;
      return Promise.resolve();
    },
    render: (plan, opts) => {
      rendered.push({ plan, source: opts.source, output: opts.output });
      opts.onProgress?.({ seconds: 10, fraction: 1, done: true });
      return Promise.resolve({ output: opts.output, duration: 300 });
    },
    findC0mpute: () => '/usr/local/bin/c0mpute',
    publish: (file) => {
      published.push(file);
      return Promise.resolve({
        ref: 'c0p1:0123456789abcdef0123',
        link: 'https://gateway.c0mpute.com/p/abc/#k=KEY',
        capability: 'c0p1:0123456789abcdef0123#k=KEY',
      });
    },
    now: () => new Date('2026-11-22T10:00:00Z'),
    ...overrides,
  };
}

function deps(v: VideoDeps, signedIn = false, recordings: Record<string, unknown> = {}): Deps {
  return {
    env: { PAIRUX_API_URL: 'https://pairux.test' },
    configPath: join(dir, signedIn ? 'signed-in.json' : 'config.json'),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      );
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        body: typeof init?.body === 'string' ? init.body : null,
        auth: 'Authorization' in headers ? headers.Authorization : null,
      });
      const body = recordings[`${init?.method ?? 'GET'} ${url.pathname}`];
      return new Response(JSON.stringify(body ?? { error: 'not found' }), {
        status: body ? 200 : 404,
      });
    }) as typeof fetch,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    openBrowser: () => undefined,
    sleep: () => Promise.resolve(),
    readStdin: () => Promise.resolve(null),
    video: v,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pairux-video-'));
  out = [];
  err = [];
  rendered = [];
  published = [];
  remuxed = 0;
  requests = [];
  await writeFile(
    join(dir, 'signed-in.json'),
    JSON.stringify({
      tokens: { accessToken: 'pux_at_x', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
    })
  );
});

describe('pairux edit', () => {
  it('keeps a range with fades and a title intro', async () => {
    const code = await run(
      [
        'edit',
        '/v/meeting.mp4',
        '--keep',
        '40:00-45:00',
        '--fade',
        '1',
        '--intro-title',
        'Weekly demo',
      ],
      deps(video())
    );
    expect(code).toBe(0);
    expect(rendered).toHaveLength(1);
    const r = rendered[0];
    expect(r.plan.keep).toEqual([{ start: 2400, end: 2700 }]);
    expect(r.plan.fadeIn).toBe(1);
    expect(r.plan.intro).toMatchObject({ kind: 'title', text: 'Weekly demo', duration: 3 });
    expect(r.output).toBe('/v/meeting-edit-2026-11-22T10-00-00.mp4');
    expect(out.join('\n')).toContain('Saved /v/meeting-edit-');
  });

  it('cuts from the whole recording, remuxing a WebM that has no duration', async () => {
    const code = await run(
      ['edit', '/v/r.webm', '--cut', '0-2:10', '--cut', '50:00-1:00:00', '-o', '/v/o.mp4'],
      deps(video({}, [webm, mp4]))
    );
    expect(code).toBe(0);
    expect(remuxed).toBe(1);
    expect(rendered[0]?.plan.keep).toEqual([{ start: 130, end: 3000 }]);
    expect(rendered[0]?.source).not.toBe('/v/r.webm');
  });

  it('asks for --keep when it cannot tell the length and was given ranges to cut only', async () => {
    const code = await run(['edit', '/v/r.webm', '--fade', '1'], deps(video({}, [webm, webm])));
    expect(code).toBe(2);
    expect(err.join('\n')).toMatch(/--keep/);
  });

  it('turns an image intro into an image card and rejects bad flags', async () => {
    await run(['edit', '/v/a.mp4', '--keep', '0-60', '--outro', '/v/end.png'], deps(video()));
    expect(rendered[0]?.plan.outro).toMatchObject({ kind: 'image', source: '/v/end.png' });
    expect(await run(['edit', '/v/a.mp4', '--keep', '9-3'], deps(video()))).toBe(2);
    expect(await run(['edit', '/v/a.mp4', '--publish', 'dropbox'], deps(video()))).toBe(2);
    expect(await run(['edit'], deps(video()))).toBe(2);
  });

  it('publishes the result to c0mpute', async () => {
    const code = await run(
      ['edit', '/v/a.mp4', '--keep', '0-60', '-o', '/v/o.mp4', '--publish', 'c0mpute', '--json'],
      deps(video())
    );
    expect(code).toBe(0);
    expect(published).toEqual(['/v/o.mp4']);
    const result = JSON.parse(out[0] ?? '{}') as { c0mpute: { link: string } };
    expect(result.c0mpute.link).toContain('#k=');
  });

  it('explains how to get c0mpute when it is missing', async () => {
    const file = join(dir, 'x.mp4');
    await writeFile(file, 'x');
    const code = await run(['publish', file], deps(video({ findC0mpute: () => null })));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('https://c0mpute.com');
  });
});

describe('pairux recordings', () => {
  it('needs a sign-in', async () => {
    expect(await run(['recordings'], deps(video()))).toBe(2);
  });

  it('lists and starts a server edit', async () => {
    const rec = {
      id: UUID,
      subject: 'Standup',
      status: 'ready',
      duration_seconds: 3600,
      size_bytes: 1,
      playback_url: 'https://x/r.mp4',
      created_at: '2026-11-21T10:00:00Z',
      parent_recording_id: null,
      edit_progress: null,
      edit_error: null,
    };
    const edit = {
      ...rec,
      id: 'new-id',
      status: 'ready',
      parent_recording_id: UUID,
      playback_url: 'https://x/e.mp4',
    };
    const d = deps(video(), true, {
      'GET /api/v1/recordings': { data: { recordings: [rec] } },
      [`GET /api/v1/recordings/${UUID}`]: { data: { recording: rec } },
      [`POST /api/v1/recordings/${UUID}/edits`]: { data: { recording: edit } },
    });
    expect(await run(['recordings'], d)).toBe(0);
    expect(out[0]).toContain('Standup');
    out = [];
    expect(
      await run(
        ['recordings', 'edit', UUID, '--keep', '5m-10m', '--outro-recording', 'abc', '--wait'],
        d
      )
    ).toBe(0);
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.auth).toBe('Bearer pux_at_x');
    const body = JSON.parse(post?.body ?? '{}') as { plan: EditPlan };
    expect(body.plan.keep).toEqual([{ start: 300, end: 600 }]);
    expect(body.plan.outro).toMatchObject({ kind: 'file', source: 'recording:abc' });
    expect(out.join('\n')).toContain('Ready: https://x/e.mp4');
  });

  it('refuses local files and c0mpute for server edits', async () => {
    const rec = { id: UUID, status: 'ready', duration_seconds: 60 };
    const d = deps(video(), true, {
      [`GET /api/v1/recordings/${UUID}`]: { data: { recording: rec } },
    });
    expect(await run(['recordings', 'edit', UUID, '--intro', '/v/a.mp4'], d)).toBe(2);
    expect(await run(['recordings', 'edit', UUID, '--publish', 'c0mpute'], d)).toBe(2);
  });
});
