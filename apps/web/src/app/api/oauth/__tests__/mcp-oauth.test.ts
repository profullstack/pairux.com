// OAuth 2.1 for the MCP server at /api/v1/mcp (lib/mcp-oauth.ts): discovery,
// dynamic client registration, the consent POST, PKCE code exchange, refresh
// rotation, revoke, and the MCP route itself (401 + WWW-Authenticate, OAuth
// token works, an existing `pairux login` CLI token still works).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';

process.env.NEXT_PUBLIC_APP_URL = 'https://pairux.com';

// In-memory tables behind a query builder with just the calls lib/mcp-oauth.ts
// makes: insert/select/update, eq/is/gt filters, order, maybeSingle.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let signedInAs: string | null = null;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Row = {};
  const rows = () => (tables[table] ??= []);
  const run = (): Row[] => {
    if (op === 'insert') {
      const row: Row = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        revoked_at: null,
        used_at: null,
        last_used_at: null,
        ...payload,
      };
      rows().push(row);
      return [row];
    }
    const matched = rows().filter((r) => filters.every((f) => f(r)));
    if (op === 'update') for (const r of matched) Object.assign(r, payload);
    return matched.map((r) =>
      table === 'oauth_tokens'
        ? {
            ...r,
            oauth_clients: (tables.oauth_clients ?? []).find((c) => c.client_id === r.client_id),
          }
        : r
    );
  };
  const b = {
    insert(p: Row) {
      op = 'insert';
      payload = p;
      return Promise.resolve({ data: null, error: (run(), null) });
    },
    update(p: Row) {
      op = 'update';
      payload = p;
      return b;
    },
    select() {
      return b;
    },
    order() {
      return b;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return b;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (r[col] ?? null) === val);
      return b;
    },
    gt(col: string, val: string) {
      filters.push((r) => String(r[col]) > val);
      return b;
    },
    async maybeSingle() {
      const [r] = run();
      return { data: r ?? null, error: null };
    },
    then(resolve: (v: { data: Row[]; error: null }) => void) {
      resolve({ data: run(), error: null });
    },
  };
  return b;
}

const sessionUser = () =>
  signedInAs ? { id: signedInAs, email: `${signedInAs}@example.com` } : null;
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser() }, error: null }) },
  }),
  getAuthenticatedUser: async () => ({ user: sessionUser(), error: null }),
}));
// The existing `pairux login` CLI token path (lib/cli-auth.ts), unchanged: one known token.
const OLD_KEY = 'pux_at_' + 'k'.repeat(43);
vi.mock('@/lib/cli-auth', () => ({
  getCliUser: async (_db: unknown, request: Request) =>
    request.headers.get('authorization') === `Bearer ${OLD_KEY}` ? { userId: 'cli-user' } : null,
}));

const { POST: register } = await import('../register/route');
const { POST: token } = await import('../token/route');
const { POST: decide } = await import('../authorize/route');
const { GET: listGrants, DELETE: dropGrant } = await import('../grants/route');
const { POST: revoke } = await import('../revoke/route');
const { GET: resourceMeta } = await import('@/app/.well-known/oauth-protected-resource/route');
const { GET: asMeta } = await import('@/app/.well-known/oauth-authorization-server/route');
const mcp = await import('@/app/api/v1/mcp/route');
const oauth = await import('@/lib/mcp-oauth');

const O = 'https://pairux.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const form = (
  body: Record<string, string>,
  url = `${O}/api/oauth/token`,
  headers: Record<string, string> = {}
) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
const consent = (body: Record<string, string>, origin: string | null = O) =>
  form(body, `${O}/api/oauth/authorize`, origin ? { origin } : {});

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function newClient(redirect_uris = [CLAUDE, CHATGPT, 'http://localhost:33418/callback']) {
  const res = await register(
    json(`${O}/api/oauth/register`, {
      client_name: 'Claude',
      redirect_uris,
      token_endpoint_auth_method: 'none',
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string; token_endpoint_auth_method: string };
}

const req = (client_id: string, challenge: string, redirect = CLAUDE) => ({
  response_type: 'code',
  client_id,
  redirect_uri: redirect,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'xyz',
  resource: `${O}/api/v1/mcp`,
});

async function authorize(clientId: string, challenge: string, redirect = CLAUDE) {
  signedInAs = 'user-1';
  const res = await decide(consent({ ...req(clientId, challenge, redirect), decision: 'allow' }));
  expect(res.status).toBe(303);
  const u = new URL(res.headers.get('location')!);
  expect(u.searchParams.get('state')).toBe('xyz');
  expect(u.searchParams.get('iss')).toBe(O);
  return u.searchParams.get('code')!;
}

async function fullToken(redirect = CLAUDE) {
  const { client_id } = await newClient();
  const { verifier, challenge } = pkce();
  const code = await authorize(client_id, challenge, redirect);
  const res = await token(
    form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id,
      code_verifier: verifier,
    })
  );
  expect(res.status).toBe(200);
  return { client_id, t: (await res.json()) as { access_token: string; refresh_token: string } };
}

const rpc = (method: string, auth?: string, id = 1) =>
  new Request(`${O}/api/v1/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params:
        method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 't', version: '1' },
            }
          : {},
    }),
  });

async function rpcResult(res: Response) {
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
}

beforeEach(() => {
  for (const k of Object.keys(tables)) Reflect.deleteProperty(tables, k);
  signedInAs = null;
});

describe('discovery', () => {
  it('protected-resource metadata names the MCP URL exactly and this site as the AS', async () => {
    const r = await resourceMeta().json();
    expect(r.resource).toBe(`${O}/api/v1/mcp`);
    expect(r.authorization_servers[0]).toBe(O);
  });
  it('authorization-server metadata advertises DCR, S256, code, refresh and public clients', async () => {
    const a = await asMeta().json();
    expect(a).toMatchObject({
      issuer: O,
      authorization_endpoint: `${O}/oauth/authorize`,
      token_endpoint: `${O}/api/oauth/token`,
      registration_endpoint: `${O}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });
});

describe('redirect URIs', () => {
  it('allows Claude, ChatGPT, https and loopback http, nothing else', () => {
    for (const ok of [
      CLAUDE,
      CHATGPT,
      'http://localhost:3000/callback',
      'http://127.0.0.1:5555/callback',
    ])
      expect(oauth.isAllowedRedirectUri(ok)).toBe(true);
    for (const bad of [
      'http://evil.com/cb',
      'javascript:alert(1)',
      'https://a.com/cb#frag',
      'https://u:p@a.com/',
      'custom://x',
      7,
    ])
      expect(oauth.isAllowedRedirectUri(bad)).toBe(false);
  });
  it('matches exactly, except any port on loopback', () => {
    const reg = [CLAUDE, 'http://localhost:33418/callback'];
    expect(oauth.redirectUriMatches(reg, 'http://localhost:50123/callback')).toBe(true);
    expect(oauth.redirectUriMatches(reg, 'http://localhost:50123/other')).toBe(false);
    expect(oauth.redirectUriMatches(reg, `${CLAUDE}2`)).toBe(false);
  });
});

describe('registration (RFC 7591)', () => {
  it('registers a public client', async () => {
    const c = await newClient();
    expect(c.client_id).toMatch(/^pux_client_/);
    expect(c.token_endpoint_auth_method).toBe('none');
  });
  it('refuses confidential clients and bad redirects', async () => {
    expect(
      (
        await register(
          json(`${O}/api/oauth/register`, {
            redirect_uris: [CLAUDE],
            token_endpoint_auth_method: 'client_secret_basic',
          })
        )
      ).status
    ).toBe(400);
    const bad = await register(
      json(`${O}/api/oauth/register`, { redirect_uris: ['http://evil.com/cb'] })
    );
    expect((await bad.json()).error).toBe('invalid_redirect_uri');
  });
});

describe('consent POST', () => {
  it('refuses a cross-site POST', async () => {
    const { client_id } = await newClient();
    signedInAs = 'user-1';
    const res = await decide(
      consent({ ...req(client_id, pkce().challenge), decision: 'allow' }, 'https://evil.example')
    );
    expect(res.status).toBe(403);
  });
  it('sends a signed-out user to /login and back', async () => {
    const { client_id } = await newClient();
    const res = await decide(consent({ ...req(client_id, pkce().challenge), decision: 'allow' }));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('redirect')).toMatch(/^\/oauth\/authorize\?/);
  });
  it('never redirects to an unregistered redirect_uri', async () => {
    const { client_id } = await newClient();
    signedInAs = 'user-1';
    const res = await decide(
      consent({ ...req(client_id, pkce().challenge, 'https://evil.com/cb'), decision: 'allow' })
    );
    expect(res.status).toBe(400);
  });
  it('deny returns access_denied with iss', async () => {
    const { client_id } = await newClient();
    signedInAs = 'user-1';
    const res = await decide(consent({ ...req(client_id, pkce().challenge), decision: 'deny' }));
    const u = new URL(res.headers.get('location')!);
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('iss')).toBe(O);
    expect(u.searchParams.get('code')).toBeNull();
  });
  it('sends a request without PKCE back to the client with an error', async () => {
    const { client_id } = await newClient();
    signedInAs = 'user-1';
    const { code_challenge: _c, ...noPkce } = req(client_id, 'x');
    const res = await decide(consent({ ...noPkce, decision: 'allow' }));
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });
});

describe('token endpoint', () => {
  it('code + PKCE (form-encoded) -> tokens -> refresh rotates -> grants list -> disconnect', async () => {
    const { client_id } = await newClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(client_id, challenge, CHATGPT);
    const bad = await token(
      form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CHATGPT,
        client_id,
        code_verifier: pkce().verifier,
      })
    );
    expect((await bad.json()).error).toBe('invalid_grant');

    const code2 = await authorize(client_id, challenge, CHATGPT);
    const res = await token(
      form({
        grant_type: 'authorization_code',
        code: code2,
        redirect_uri: CHATGPT,
        client_id,
        code_verifier: verifier,
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const t = await res.json();
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
    expect(t.access_token.startsWith('pux_oat_')).toBe(true);
    expect(JSON.stringify(tables.oauth_tokens)).not.toContain(t.access_token);
    // Replay of a used code fails.
    expect(
      (
        await token(
          form({
            grant_type: 'authorization_code',
            code: code2,
            redirect_uri: CHATGPT,
            client_id,
            code_verifier: verifier,
          })
        )
      ).status
    ).toBe(400);

    const admin = { from: (x: string) => builder(x) } as never;
    expect(await oauth.resolveAccessToken(admin, t.access_token)).toEqual({ userId: 'user-1' });
    const r2 = await (
      await token(form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id }))
    ).json();
    expect(await oauth.resolveAccessToken(admin, t.access_token)).toBeNull();
    expect(await oauth.resolveAccessToken(admin, r2.access_token)).toEqual({ userId: 'user-1' });
    expect(
      (
        await token(
          form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id })
        )
      ).status
    ).toBe(400);

    signedInAs = 'user-1';
    const grants = (await (await listGrants()).json()).grants;
    expect(grants).toHaveLength(1);
    signedInAs = 'someone-else';
    expect(
      (
        await dropGrant(
          new NextRequest(`${O}/api/oauth/grants?id=${String(grants[0].id)}`, { method: 'DELETE' })
        )
      ).status
    ).toBe(404);
    signedInAs = 'user-1';
    expect(
      (
        await dropGrant(
          new NextRequest(`${O}/api/oauth/grants?id=${String(grants[0].id)}`, { method: 'DELETE' })
        )
      ).status
    ).toBe(200);
    expect(await oauth.resolveAccessToken(admin, r2.access_token)).toBeNull();
  });
  it('RFC 7009 revoke always 200 and ends the grant', async () => {
    const { t } = await fullToken();
    expect((await revoke(form({ token: t.refresh_token }, `${O}/api/oauth/revoke`))).status).toBe(
      200
    );
    expect((await revoke(form({ token: 'garbage' }, `${O}/api/oauth/revoke`))).status).toBe(200);
    expect(
      await oauth.resolveAccessToken({ from: (x: string) => builder(x) } as never, t.access_token)
    ).toBeNull();
  });
  it('loopback redirect on another port (Claude Code)', async () => {
    await fullToken('http://localhost:50999/callback');
  });
  it('rejects unknown grant types', async () => {
    expect((await (await token(form({ grant_type: 'password' }))).json()).error).toBe(
      'unsupported_grant_type'
    );
  });
});

describe('/api/v1/mcp', () => {
  it('unauthenticated -> 401 with WWW-Authenticate resource_metadata', async () => {
    const res = await mcp.POST(rpc('initialize'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${O}/.well-known/oauth-protected-resource"`
    );
  });
  it('a bad or expired OAuth token -> 401', async () => {
    expect((await mcp.POST(rpc('tools/list', 'pux_oat_nope'))).status).toBe(401);
  });
  it('an OAuth access token lists tools, with the list cache fields', async () => {
    const { t } = await fullToken();
    const res = await mcp.POST(rpc('tools/list', t.access_token));
    expect(res.status).toBe(200);
    const body = await rpcResult(res);
    expect(body.result.tools.length).toBe(7);
    for (const tool of body.result.tools) {
      expect(tool.title).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations.openWorldHint).toBe('boolean');
    }
    expect(body.result).toMatchObject({ resultType: 'complete', cacheScope: 'private' });
    expect(typeof body.result.ttlMs).toBe('number');
  });
  it('the existing pairux CLI token still works', async () => {
    const res = await mcp.POST(rpc('tools/list', OLD_KEY));
    expect(res.status).toBe(200);
    expect((await rpcResult(res)).result.tools.length).toBe(7);
  });
  it('a signed-in PairUX session still works', async () => {
    signedInAs = 'web-user';
    expect((await mcp.POST(rpc('tools/list'))).status).toBe(200);
  });
  it('an OAuth token is not accepted as a CLI token or session elsewhere', async () => {
    const { t } = await fullToken();
    signedInAs = null;
    const { requestUser } = await import('@/lib/request-user');
    expect(
      await requestUser(
        new Request(`${O}/api/v1/me`, { headers: { authorization: `Bearer ${t.access_token}` } })
      )
    ).toBeNull();
  });
  it('GET without a credential is also 401 with resource_metadata', async () => {
    const res = await mcp.GET(new Request(`${O}/api/v1/mcp`));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });
  it('initialize names the server', async () => {
    const { t } = await fullToken();
    const body = await rpcResult(await mcp.POST(rpc('initialize', t.access_token)));
    expect(body.result.serverInfo.name).toBe('pairux');
  });
});
