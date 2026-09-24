import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CliAuthError,
  createAuthCode,
  exchangeCode,
  getCliUser,
  isLoopbackRedirect,
  refreshTokens,
  revokeToken,
  sha256Hex,
  verifyPkce,
  type Db,
} from './cli-auth';
import { createMemoryDb } from '@/test/mocks/memory-db';

type MemoryDb = Db & { tables: Record<string, Record<string, unknown>[]> };
const memDb = () => createMemoryDb() as unknown as MemoryDb;

const verifier = 'v'.repeat(20) + '-._~' + 'A1b2C3d4e5F6g7H8i9J0';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'http://127.0.0.1:53682/callback';

async function signIn(db = memDb(), now = new Date('2026-09-24T12:00:00Z')) {
  const code = await createAuthCode(
    db,
    { userId: 'user-1', codeChallenge: challenge, redirectUri },
    now
  );
  const tokens = await exchangeCode(db, { code, codeVerifier: verifier, redirectUri }, now);
  return { db, code, tokens, now };
}

function bearer(token: string) {
  return new Request('http://x/api', { headers: { authorization: `Bearer ${token}` } });
}

describe('verifyPkce', () => {
  it('accepts the verifier that produced the challenge', () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });
  it('rejects another verifier, and short or malformed ones', () => {
    expect(verifyPkce('w'.repeat(43), challenge)).toBe(false);
    expect(verifyPkce('short', challenge)).toBe(false);
    expect(verifyPkce('bad verifier with spaces'.padEnd(50, 'x'), challenge)).toBe(false);
  });
});

describe('isLoopbackRedirect', () => {
  it.each([
    ['http://127.0.0.1:53682/callback', true],
    ['http://localhost:8080/callback', true],
    ['http://[::1]:9000/callback', true],
    ['https://127.0.0.1:53682/callback', false],
    ['http://127.0.0.1/callback', false],
    ['http://evil.com:80/callback', false],
    ['http://127.0.0.1:53682/other', false],
    ['http://127.0.0.1:53682/callback?x=1', false],
    ['http://user@127.0.0.1:53682/callback', false],
    ['not a url', false],
  ])('%s -> %s', (uri, ok) => {
    expect(isLoopbackRedirect(uri)).toBe(ok);
  });
});

describe('authorization code exchange', () => {
  it('stores only hashes and issues a bearer pair', async () => {
    const { db, code, tokens } = await signIn();
    expect(tokens.access_token).toMatch(/^pux_at_/);
    expect(tokens.refresh_token).toMatch(/^pux_rt_/);
    expect(tokens.expires_in).toBe(3600);
    const stored = JSON.stringify(db.tables);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).toContain(sha256Hex(tokens.access_token));
  });

  it('refuses a loopback-less redirect or a non-S256 challenge at authorize time', async () => {
    const db = memDb();
    await expect(
      createAuthCode(db, {
        userId: 'u',
        codeChallenge: challenge,
        redirectUri: 'https://evil.com/cb',
      })
    ).rejects.toBeInstanceOf(CliAuthError);
    await expect(
      createAuthCode(db, { userId: 'u', codeChallenge: 'plain', redirectUri })
    ).rejects.toBeInstanceOf(CliAuthError);
  });

  it('a code works once', async () => {
    const { db, code, now } = await signIn();
    await expect(
      exchangeCode(db, { code, codeVerifier: verifier, redirectUri }, now)
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects the wrong verifier, redirect, or an expired code', async () => {
    const db = memDb();
    const now = new Date('2026-09-24T12:00:00Z');
    const mk = () =>
      createAuthCode(db, { userId: 'u', codeChallenge: challenge, redirectUri }, now);
    await expect(
      exchangeCode(db, { code: await mk(), codeVerifier: 'x'.repeat(43), redirectUri }, now)
    ).rejects.toThrow(/code_verifier/);
    await expect(
      exchangeCode(
        db,
        { code: await mk(), codeVerifier: verifier, redirectUri: 'http://127.0.0.1:1/callback' },
        now
      )
    ).rejects.toThrow(/redirect_uri/);
    const later = new Date(now.getTime() + 6 * 60_000);
    await expect(
      exchangeCode(db, { code: await mk(), codeVerifier: verifier, redirectUri }, later)
    ).rejects.toThrow(/expired/);
  });
});

describe('getCliUser', () => {
  it('resolves a live access token to its user', async () => {
    const { db, tokens, now } = await signIn();
    await expect(getCliUser(db, bearer(tokens.access_token), now)).resolves.toEqual({
      userId: 'user-1',
    });
  });

  it('is null for no header, a Supabase JWT, an expired token, or a revoked one', async () => {
    const { db, tokens, now } = await signIn();
    await expect(getCliUser(db, new Request('http://x'), now)).resolves.toBeNull();
    await expect(getCliUser(db, bearer('eyJhbGciOi.jwt.sig'), now)).resolves.toBeNull();
    const later = new Date(now.getTime() + 2 * 3_600_000);
    await expect(getCliUser(db, bearer(tokens.access_token), later)).resolves.toBeNull();
    await revokeToken(db, tokens.refresh_token, now);
    await expect(getCliUser(db, bearer(tokens.access_token), now)).resolves.toBeNull();
  });
});

describe('refresh rotation', () => {
  it('rotates both tokens and retires the old access token', async () => {
    const { db, tokens, now } = await signIn();
    const next = await refreshTokens(db, tokens.refresh_token, now);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    await expect(getCliUser(db, bearer(next.access_token), now)).resolves.toEqual({
      userId: 'user-1',
    });
    await expect(getCliUser(db, bearer(tokens.access_token), now)).resolves.toBeNull();
  });

  it('replaying a rotated refresh token revokes the whole family', async () => {
    const { db, tokens, now } = await signIn();
    const next = await refreshTokens(db, tokens.refresh_token, now);
    await expect(refreshTokens(db, tokens.refresh_token, now)).rejects.toThrow(/already used/);
    // The thief's replay also logged out the legitimate holder of `next`.
    await expect(getCliUser(db, bearer(next.access_token), now)).resolves.toBeNull();
    await expect(refreshTokens(db, next.refresh_token, now)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});
