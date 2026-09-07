import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import {
  getValidAccessToken,
  getValidAuth,
  refreshAuthToken,
  refreshAuthSession,
  clearAuthSession,
  commitLoginSession,
  beginAuthMutation,
} from './auth-session';
import { storeAuth, getStoredAuth, type StoredAuth } from './secure-storage';
import {
  refreshSuccessEnvelope,
  SUPABASE_EXPIRES_AT_SECONDS,
  AUTH_USER_ID,
} from '../test/fixtures/server-contracts';

vi.mock('../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

function makeAuth(overrides: Partial<StoredAuth> = {}): StoredAuth {
  return {
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    expiresAt: Date.now() + 3600000,
    user: { id: AUTH_USER_ID, email: 'user@example.com' },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('auth-session', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAuthSession();
  });

  describe('getValidAccessToken', () => {
    it('returns the stored token without a refresh when not expired', async () => {
      await storeAuth(makeAuth());

      const token = await getValidAccessToken();
      expect(token).toBe('access-token-1');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns null when signed out', async () => {
      const token = await getValidAccessToken();
      expect(token).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('refreshes an expired token via /api/auth/refresh and stores ms expiry', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);

      const token = await getValidAccessToken();

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'refresh-token-1' }),
      });
      expect(token).toBe('access-token-2');

      const stored = await getStoredAuth();
      expect(stored).toEqual({
        accessToken: 'access-token-2',
        refreshToken: 'refresh-token-2',
        // Supabase returns expires_at in seconds; storage keeps milliseconds
        expiresAt: SUPABASE_EXPIRES_AT_SECONDS * 1000,
        user: { id: AUTH_USER_ID, email: 'user@example.com' },
      });
    });

    it('deduplicates concurrent refreshes into a single request', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      const gate = deferred<Response>();
      vi.mocked(fetch).mockReturnValue(gate.promise);

      const [first, second] = [getValidAccessToken(), getValidAccessToken()];
      gate.resolve({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);

      expect(await first).toBe('access-token-2');
      expect(await second).toBe('access-token-2');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('returns null and keeps stored auth when the refresh is rejected', async () => {
      const expired = makeAuth({ expiresAt: Date.now() - 1000 });
      await storeAuth(expired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid Refresh Token' }),
      } as Response);

      const token = await getValidAccessToken();
      expect(token).toBeNull();
      // A failed refresh must not log the user out by itself
      expect(await getStoredAuth()).toEqual(expired);
    });

    it('returns null when the refresh envelope has no session', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

      expect(await getValidAccessToken()).toBeNull();
    });
  });

  describe('logout race', () => {
    it('discards a refresh that resolves after clearAuthSession', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      const gate = deferred<Response>();
      vi.mocked(fetch).mockReturnValue(gate.promise);

      const pending = refreshAuthToken();
      await clearAuthSession();
      gate.resolve({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);

      expect(await pending).toBeNull();
      // The logout wins: no tokens may be resurrected
      expect(await getStoredAuth()).toBeNull();
    });
  });

  describe('getValidAuth', () => {
    it('returns the refreshed auth with the original user identity', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);

      const auth = await getValidAuth();
      expect(auth?.user).toEqual({ id: AUTH_USER_ID, email: 'user@example.com' });
      expect(auth?.accessToken).toBe('access-token-2');
    });
  });

  describe('refreshAuthSession failure classification', () => {
    it("reports 'rejected' for a definitive 4xx and keeps stored auth", async () => {
      const expired = makeAuth({ expiresAt: Date.now() - 1000 });
      await storeAuth(expired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid Refresh Token' }),
      } as Response);

      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'rejected' });
      expect(await getStoredAuth()).toEqual(expired);
    });

    it("reports 'transient' for a 5xx so callers do not destroy the session", async () => {
      const expired = makeAuth({ expiresAt: Date.now() - 1000 });
      await storeAuth(expired);
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service unavailable' }),
      } as Response);

      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'transient' });
      expect(await getStoredAuth()).toEqual(expired);
    });

    it("reports 'transient' when the network fails", async () => {
      const expired = makeAuth({ expiresAt: Date.now() - 1000 });
      await storeAuth(expired);
      vi.mocked(fetch).mockRejectedValue(new Error('offline'));

      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'transient' });
      expect(await getStoredAuth()).toEqual(expired);
    });

    it("reports 'signed-out' without touching the network when nothing is stored", async () => {
      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'signed-out' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not claim success when the secure-store write fails', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000 }));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);
      vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keystore unavailable'));

      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'transient' });
      // The mutation queue must survive the rejected write
      await expect(clearAuthSession()).resolves.toBeUndefined();
      expect(await getStoredAuth()).toBeNull();
    });
  });

  describe('envelope validation', () => {
    const invalidSessions: [string, unknown][] = [
      ['an empty accessToken', { accessToken: '', refreshToken: 'r', expiresAt: 100 }],
      ['an empty refreshToken', { accessToken: 'a', refreshToken: '', expiresAt: 100 }],
      ['a missing expiresAt', { accessToken: 'a', refreshToken: 'r' }],
      ['a NaN expiresAt', { accessToken: 'a', refreshToken: 'r', expiresAt: NaN }],
      ['an Infinity expiresAt', { accessToken: 'a', refreshToken: 'r', expiresAt: Infinity }],
      ['a non-string token', { accessToken: 42, refreshToken: 'r', expiresAt: 100 }],
    ];

    it.each(invalidSessions)('never stores a refresh payload with %s', async (_label, session) => {
      const expired = makeAuth({ expiresAt: Date.now() - 1000 });
      await storeAuth(expired);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { session } }),
      } as Response);

      expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'transient' });
      expect(await getStoredAuth()).toEqual(expired);
    });
  });

  describe('session supersession', () => {
    it('starts a fresh refresh for the new session instead of reusing a superseded one', async () => {
      await storeAuth(makeAuth({ expiresAt: Date.now() - 1000, refreshToken: 'old-rt' }));
      const gate = deferred<Response>();
      vi.mocked(fetch).mockReturnValueOnce(gate.promise);
      const first = refreshAuthToken();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

      await clearAuthSession();
      await storeAuth(
        makeAuth({
          expiresAt: Date.now() - 1000,
          refreshToken: 'new-rt',
          user: { id: 'user-b', email: 'b@example.com' },
        })
      );
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => refreshSuccessEnvelope,
      } as Response);

      const second = await refreshAuthToken();
      expect(second?.user.id).toBe('user-b');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toBe(
        JSON.stringify({ refreshToken: 'new-rt' })
      );

      gate.resolve({ ok: true, json: async () => refreshSuccessEnvelope } as Response);
      expect(await first).toBeNull();
      const stored = await getStoredAuth();
      expect(stored?.user.id).toBe('user-b');
      expect(stored?.accessToken).toBe('access-token-2');
    });

    it('discards a login commit when a logout started after the login', async () => {
      const epoch = beginAuthMutation();
      await clearAuthSession();

      const committed = await commitLoginSession(makeAuth(), epoch);
      expect(committed).toBe(false);
      expect(await getStoredAuth()).toBeNull();
    });
  });
});
