import { describe, expect, it } from 'vitest';
import { checkIdToken, sameState } from '@profullstack/coinpay-onboard/oauth';
import {
  beginSignIn,
  canDisconnect,
  decodePending,
  encodePending,
  isPlaceholderEmail,
  resolveCoinpayUser,
  type CoinpayStore,
  type IdentityRow,
} from './coinpay-signin';

const cfg = {
  clientId: 'cp_test',
  clientSecret: 'secret-for-tests',
  base: 'https://coinpayportal.com',
  siteUrl: 'https://pairux.com',
};

function memStore() {
  const users = new Map<string, { id: string; email: string }>([
    ['victim', { id: 'victim', email: 'victim@example.com' }],
  ]);
  const ids = new Map<string, IdentityRow>();
  let n = 0;
  const store: CoinpayStore = {
    identityBySub: async (sub) => ids.get(sub) ?? null,
    identityByUser: async (userId) => [...ids.values()].find((r) => r.user_id === userId) ?? null,
    link: async (row) => {
      if (ids.has(row.coinpay_sub) || [...ids.values()].some((r) => r.user_id === row.user_id))
        return 'conflict';
      ids.set(row.coinpay_sub, row);
      return 'ok';
    },
    unlink: async (userId) => {
      for (const [k, r] of ids) if (r.user_id === userId) ids.delete(k);
    },
    touch: async () => undefined,
    createUser: async ({ email }) => {
      const id = `u${String(++n)}`;
      users.set(id, { id, email });
      return id;
    },
    deleteUser: async (id) => {
      users.delete(id);
    },
  };
  return { store, users, ids };
}

describe('Sign in with CoinPay', () => {
  it('authorize URL carries PKCE S256, state, nonce and the exact redirect', () => {
    const { pending, url } = beginSignIn(cfg, 'login', '/dashboard');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://coinpayportal.com/api/oauth/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('state')).toBe(pending.state);
    expect(u.searchParams.get('nonce')).toBe(pending.nonce);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://pairux.com/api/v1/coinpay/oauth/callback'
    );
    expect(u.searchParams.get('scope')).toBe('openid profile email');
  });

  it('pending cookie round-trips; forged, re-keyed, edited or expired ones are refused', () => {
    const { pending } = beginSignIn(cfg, 'connect', '//evil.com');
    expect(pending.next).toBe('/settings');
    const sealed = encodePending(pending, cfg.clientSecret);
    expect(decodePending(sealed, cfg.clientSecret)).toEqual(pending);
    expect(decodePending(sealed, 'another-key')).toBeNull();
    const sig = sealed.split('.')[1];
    const edited = Buffer.from(JSON.stringify({ ...pending, state: 'evil' })).toString('base64url');
    expect(decodePending(`${edited}.${sig ?? ''}`, cfg.clientSecret)).toBeNull();
    expect(
      decodePending(encodePending({ ...pending, exp: 1 }, cfg.clientSecret), cfg.clientSecret)
    ).toBeNull();
    expect(decodePending(undefined, cfg.clientSecret)).toBeNull();
  });

  it('a CoinPay login carrying an existing user email gets a NEW account, never theirs', async () => {
    const { store, users } = memStore();
    const claims = { sub: 'attacker', email: 'victim@example.com', name: null };
    const r = await resolveCoinpayUser({ mode: 'login', currentUserId: null, claims }, store);
    expect(r).toMatchObject({ ok: true, action: 'created' });
    if (!r.ok) throw new Error('unreachable');
    expect(r.userId).not.toBe('victim');
    expect(isPlaceholderEmail(users.get(r.userId)?.email)).toBe(true);
    const again = await resolveCoinpayUser({ mode: 'login', currentUserId: null, claims }, store);
    expect(again).toEqual({ ok: true, userId: r.userId, action: 'login' });
  });

  it('connecting needs a signed-in session', async () => {
    const { store, ids } = memStore();
    const r = await resolveCoinpayUser(
      { mode: 'connect', currentUserId: null, claims: { sub: 's1', email: null, name: null } },
      store
    );
    expect(r).toEqual({ ok: false, code: 'not_signed_in' });
    expect(ids.size).toBe(0);
  });

  it('connect links the signed-in account; a sub bound elsewhere cannot be taken', async () => {
    const { store } = memStore();
    const claims = { sub: 's1', email: 'x@y.z', name: null };
    expect(
      await resolveCoinpayUser({ mode: 'connect', currentUserId: 'victim', claims }, store)
    ).toEqual({ ok: true, userId: 'victim', action: 'linked' });
    expect(await resolveCoinpayUser({ mode: 'login', currentUserId: null, claims }, store)).toEqual(
      {
        ok: true,
        userId: 'victim',
        action: 'login',
      }
    );
    expect(
      await resolveCoinpayUser({ mode: 'connect', currentUserId: 'other', claims }, store)
    ).toEqual({ ok: false, code: 'linked_elsewhere' });
  });

  it('bad state and nonce are rejected', () => {
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', null)).toBe(false);
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const good = {
      iss: 'https://coinpayportal.com',
      sub: 's',
      aud: 'cp_test',
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: 'n1',
    };
    const tok = `${part({ alg: 'RS256' })}.${part(good)}.sig`;
    expect(checkIdToken({ idToken: tok, clientId: 'cp_test', nonce: 'n1' }).sub).toBe('s');
    expect(() => checkIdToken({ idToken: tok, clientId: 'cp_test', nonce: 'n2' })).toThrow();
  });

  it('disconnect is refused when CoinPay is the only way in', () => {
    expect(canDisconnect('cp-ab@coinpay.pairux.invalid')).toBe(false);
    expect(canDisconnect(null)).toBe(false);
    expect(canDisconnect('real@example.com')).toBe(true);
  });
});
