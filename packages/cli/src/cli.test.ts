import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { run, type Deps } from './cli.js';
import { buildAuthorizeUrl, createPkce, needsRefresh } from './auth.js';

interface Call {
  method: string;
  path: string;
  body: string | null;
  auth: string | null;
}

type Handler = (call: Call) => { status: number; body: unknown };

function fakeFetch(handler: Handler, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: typeof init?.body === 'string' ? init.body : null,
      auth: headers.Authorization ?? null,
    };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

let dir: string;
let out: string[];
let err: string[];
let calls: Call[];

function deps(handler: Handler, extra: Partial<Deps> = {}): Deps {
  return {
    env: { PAIRUX_API_URL: 'https://pairux.test' },
    configPath: join(dir, 'config.json'),
    fetchImpl: fakeFetch(handler, calls),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    openBrowser: () => undefined,
    sleep: () => Promise.resolve(),
    readStdin: () => Promise.resolve(null),
    ...extra,
  };
}

async function readConfig() {
  return JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
}

const joined = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Claude Code',
  owned: false,
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pairux-cli-'));
  out = [];
  err = [];
  calls = [];
});

describe('pkce', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).toHaveLength(43);
  });

  it('builds the authorize URL the web consent page validates', () => {
    const url = new URL(
      buildAuthorizeUrl('https://pairux.test', {
        challenge: 'c'.repeat(43),
        redirectUri: 'http://127.0.0.1:5555/callback',
        state: 'state-1234',
        clientName: 'PairUX CLI',
      })
    );
    expect(url.pathname).toBe('/cli/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/callback');
  });

  it('refreshes a minute before expiry', () => {
    expect(needsRefresh({ accessToken: 'a', refreshToken: 'r', expiresAt: 100_000 }, 30_000)).toBe(
      false
    );
    expect(needsRefresh({ accessToken: 'a', refreshToken: 'r', expiresAt: 100_000 }, 50_000)).toBe(
      true
    );
  });
});

describe('pairux join / say / leave', () => {
  it('joins anonymously, remembers the agent, and stores config as 0600', async () => {
    const code = await run(
      ['join', 'abc123', '--client', 'claude-code'],
      deps(() => ({ status: 201, body: { data: joined } }), {
        env: { PAIRUX_API_URL: 'https://pairux.test', CLAUDECODE: '1' },
      })
    );
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/agents/join', auth: null });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      joinCode: 'ABC123',
      name: 'Claude Code',
      client: 'claude-code',
    });
    expect(out[0]).toContain('anonymous agent');
    const config = await readConfig();
    expect(config.agent).toMatchObject({ participantId: joined.participantId, joinCode: 'ABC123' });
    expect((await stat(join(dir, 'config.json'))).mode & 0o777).toBe(0o600);
  });

  it('sends the access token when signed in', async () => {
    const d = deps((call) =>
      call.path === '/api/v1/agents/join'
        ? { status: 201, body: { data: { ...joined, owned: true } } }
        : { status: 404, body: { error: 'nope' } }
    );
    await (
      await import('./config.js')
    ).saveConfig(
      {
        tokens: {
          accessToken: 'pux_at_x',
          refreshToken: 'pux_rt_x',
          expiresAt: Date.now() + 3_600_000,
        },
      },
      d.configPath
    );
    expect(await run(['join', 'ABC123', '--name', 'Reviewer'], d)).toBe(0);
    expect(calls[0]!.auth).toBe('Bearer pux_at_x');
    expect(out[0]).toContain('(your agent)');
  });

  it('rejects a malformed join code without calling the API', async () => {
    expect(
      await run(
        ['join', 'nope'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it('refuses to join twice without --force', async () => {
    const d = deps(() => ({ status: 201, body: { data: joined } }));
    await run(['join', 'ABC123'], d);
    expect(await run(['join', 'XYZ789'], d)).toBe(2);
    expect(err[0]).toContain('Already in session ABC123');
  });

  it('says a message and enforces the 500-character limit locally', async () => {
    const d = deps((call) =>
      call.path.endsWith('/messages')
        ? { status: 201, body: { data: { id: 'm1' } } }
        : { status: 201, body: { data: joined } }
    );
    await run(['join', 'ABC123'], d);
    expect(await run(['say', 'hello', 'room'], d)).toBe(0);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: `/api/v1/agents/${joined.participantId}/messages`,
    });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ content: 'hello room' });
    expect(await run(['say', 'x'.repeat(501)], d)).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('leaves and forgets the agent even if the host already removed it', async () => {
    const d = deps((call) =>
      call.method === 'DELETE'
        ? { status: 410, body: { error: 'gone' } }
        : { status: 201, body: { data: joined } }
    );
    await run(['join', 'ABC123'], d);
    expect(await run(['leave'], d)).toBe(0);
    expect((await readConfig()).agent).toBeUndefined();
  });

  it('say without a session explains how to join', async () => {
    expect(
      await run(
        ['say', 'hi'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(2);
    expect(err[0]).toContain('pairux join');
  });
});

describe('pairux listen', () => {
  const roster = (extra: object[] = []) => [
    {
      id: 'h',
      display_name: 'Anthony',
      role: 'host',
      kind: 'human',
      agent_client: null,
      control_state: 'view-only',
    },
    {
      id: joined.participantId,
      display_name: 'Claude Code',
      role: 'viewer',
      kind: 'agent',
      agent_client: 'claude-code',
      control_state: 'view-only',
    },
    ...extra,
  ];

  function poll(messages: object[], participants: object[]) {
    return {
      status: 200,
      body: {
        data: {
          you: { id: joined.participantId, displayName: 'Claude Code' },
          session: { id: joined.sessionId, status: 'active', subject: null, joinCode: 'ABC123' },
          participants,
          messages,
          serverTime: '2026-09-24T12:00:00.000Z',
        },
      },
    };
  }

  it('prints new messages, roster changes, and advances the cursor', async () => {
    let n = 0;
    const d = deps(
      (call) => {
        if (call.path === '/api/v1/agents/join') return { status: 201, body: { data: joined } };
        n += 1;
        if (n === 1)
          return poll(
            [
              {
                id: 'm1',
                display_name: 'Anthony',
                content: 'can you check the test?',
                message_type: 'text',
                created_at: '2026-09-24T12:00:01.000Z',
              },
            ],
            roster()
          );
        return poll(
          [],
          roster([
            {
              id: 'g',
              display_name: 'Sam',
              role: 'viewer',
              kind: 'human',
              agent_client: null,
              control_state: 'view-only',
            },
          ])
        );
      },
      { maxPolls: 2 }
    );

    await run(['join', 'ABC123'], d);
    out = [];
    expect(await run(['listen'], d)).toBe(0);
    expect(out[0]).toMatch(/Anthony: can you check the test\?$/);
    expect(out[1]).toBe('* Sam joined');
    // Second poll asks only for messages after the one already shown.
    expect(calls[2]!.path).toContain(encodeURIComponent('2026-09-24T12:00:01.000Z'));
    expect((await readConfig()).agent).toMatchObject({ cursor: '2026-09-24T12:00:01.000Z' });
  });

  it('emits JSON lines with --json', async () => {
    const d = deps((call) =>
      call.path === '/api/v1/agents/join'
        ? { status: 201, body: { data: joined } }
        : poll(
            [
              {
                id: 'm1',
                display_name: 'A',
                content: 'hi',
                message_type: 'text',
                created_at: '2026-09-24T12:00:01.000Z',
              },
            ],
            roster()
          )
    );
    await run(['join', 'ABC123'], d);
    out = [];
    await run(['listen', '--json', '--once'], d);
    expect(JSON.parse(out[0]!)).toMatchObject({ type: 'message', content: 'hi' });
  });

  it('stops cleanly and forgets the agent when removed (410)', async () => {
    const d = deps((call) =>
      call.path === '/api/v1/agents/join'
        ? { status: 201, body: { data: joined } }
        : { status: 410, body: { error: 'This agent has left or was removed from the session' } }
    );
    await run(['join', 'ABC123'], d);
    out = [];
    expect(await run(['listen'], d)).toBe(0);
    expect(out[0]).toContain('removed');
    expect((await readConfig()).agent).toBeUndefined();
  });
});

describe('pairux login', () => {
  it('completes the PKCE loopback flow and stores rotated tokens', async () => {
    let challengeSeen = '';
    let verifierSent = '';
    const d = deps(
      (call) => {
        if (call.path === '/api/v1/cli/token') {
          const params = new URLSearchParams(call.body ?? '');
          verifierSent = params.get('code_verifier') ?? '';
          expect(params.get('grant_type')).toBe('authorization_code');
          expect(params.get('code')).toBe('the-code');
          expect(params.get('redirect_uri')).toBe('http://127.0.0.1:4321/callback');
          return {
            status: 200,
            body: {
              access_token: 'pux_at_new',
              refresh_token: 'pux_rt_new',
              expires_in: 3600,
              token_type: 'Bearer',
            },
          };
        }
        if (call.path === '/api/v1/cli/me') {
          expect(call.auth).toBe('Bearer pux_at_new');
          return {
            status: 200,
            body: { data: { userId: 'u1', displayName: 'Anthony', username: 'anthony' } },
          };
        }
        return { status: 404, body: {} };
      },
      {
        openBrowser: (url) => {
          challengeSeen = new URL(url).searchParams.get('code_challenge') ?? '';
        },
        login: () =>
          Promise.resolve({
            redirectUri: 'http://127.0.0.1:4321/callback',
            waitForCode: () => Promise.resolve('the-code'),
            close: () => undefined,
          }),
      }
    );
    expect(await run(['login'], d)).toBe(0);
    expect(createHash('sha256').update(verifierSent).digest('base64url')).toBe(challengeSeen);
    expect((await readConfig()).tokens).toMatchObject({
      accessToken: 'pux_at_new',
      refreshToken: 'pux_rt_new',
    });
    expect(out.at(-1)).toBe('Signed in as Anthony.');
  });

  it('refreshes an expiring token before calling the API, and saves the rotated pair', async () => {
    const d = deps((call) => {
      if (call.path === '/api/v1/cli/token') {
        expect(new URLSearchParams(call.body ?? '').get('refresh_token')).toBe('pux_rt_old');
        return {
          status: 200,
          body: { access_token: 'pux_at_2', refresh_token: 'pux_rt_2', expires_in: 3600 },
        };
      }
      expect(call.auth).toBe('Bearer pux_at_2');
      return {
        status: 200,
        body: { data: { userId: 'u1', displayName: 'Anthony', username: null } },
      };
    });
    await (
      await import('./config.js')
    ).saveConfig(
      {
        tokens: {
          accessToken: 'pux_at_old',
          refreshToken: 'pux_rt_old',
          expiresAt: Date.now() - 1,
        },
      },
      d.configPath
    );
    expect(await run(['whoami'], d)).toBe(0);
    expect((await readConfig()).tokens).toMatchObject({ refreshToken: 'pux_rt_2' });
  });

  it('logout revokes the refresh token and drops it', async () => {
    const d = deps(() => ({ status: 200, body: {} }));
    await (
      await import('./config.js')
    ).saveConfig(
      {
        tokens: {
          accessToken: 'pux_at_x',
          refreshToken: 'pux_rt_x',
          expiresAt: Date.now() + 3_600_000,
        },
      },
      d.configPath
    );
    expect(await run(['logout'], d)).toBe(0);
    expect(calls[0]!.path).toBe('/api/v1/cli/revoke');
    expect(calls[0]!.body).toBe('token=pux_rt_x');
    expect((await readConfig()).tokens).toBeUndefined();
  });
});
