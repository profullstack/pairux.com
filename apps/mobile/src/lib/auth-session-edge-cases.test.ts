import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import {
  beginAuthMutation,
  clearAuthSession,
  commitLoginSession,
  getValidAccessToken,
  parseSessionEnvelope,
  readAuthSession,
  refreshAuthSession,
} from './auth-session';
import { storeAuth } from './secure-storage';
import { authApi } from './api/auth';
import { getStoredAuth } from './secure-storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const auth = {
  accessToken: 'fixture-access',
  refreshToken: 'fixture-refresh',
  expiresAt: Date.now() + 3600000,
  user: { id: 'fixture-user', email: 'fixture@example.com' },
};

describe('session read boundaries', () => {
  beforeEach(async () => {
    await clearAuthSession();
    await storeAuth(auth);
    vi.clearAllMocks();
  });

  it('does not return an access token from a storage read completed after logout', async () => {
    const gate = deferred<string | null>();
    vi.mocked(SecureStore.getItemAsync).mockImplementationOnce(() => gate.promise);
    const pending = getValidAccessToken();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1));
    await clearAuthSession();
    gate.resolve(JSON.stringify(auth));
    expect(await pending).toBeNull();
  });

  it('treats a refresh rate limit as temporary, not a revoked session', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    expect(await refreshAuthSession()).toMatchObject({ auth: null, failure: 'transient' });
  });

  it('rejects an expiry that overflows during conversion to milliseconds', () => {
    expect(
      parseSessionEnvelope({
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresAt: Number.MAX_VALUE,
      })
    ).toBeNull();
  });

  it('lets the newest login intent win even when the earlier response arrives first', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const loginA = authApi.login('a@example.com', 'fixture-password');
    const loginB = authApi.login('b@example.com', 'fixture-password');
    const response = (id: string) =>
      ({
        ok: true,
        json: async () => ({
          data: {
            user: { id, email: `${id}@example.com` },
            session: {
              accessToken: `${id}-access`,
              refreshToken: `${id}-refresh`,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            },
          },
        }),
      }) as Response;
    first.resolve(response('a'));
    expect((await loginA).data).toBeUndefined();
    second.resolve(response('b'));
    expect((await loginB).data?.user.id).toBe('b');
    expect((await getStoredAuth())?.user.id).toBe('b');
  });

  it('does not return a token while the logout deletion is pending', async () => {
    const gate = deferred<undefined>();
    const originalDelete = vi.mocked(SecureStore.deleteItemAsync).getMockImplementation()!;
    vi.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async (key) => {
      await gate.promise;
      return originalDelete(key);
    });
    const logout = clearAuthSession();
    await vi.waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1));
    const reading = getValidAccessToken();
    gate.resolve(undefined);
    await logout;
    expect(await reading).toBeNull();
  });

  it('blocks stored tokens and refresh after logout deletion fails', async () => {
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(clearAuthSession()).rejects.toThrow('Storage unavailable');
    expect(await getStoredAuth()).toEqual(auth);
    expect(await readAuthSession()).toBeNull();
    expect(await getValidAccessToken()).toBeNull();
    expect(await refreshAuthSession()).toEqual({ auth: null, failure: 'signed-out' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not unblock a failed logout just because another login was attempted', async () => {
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(clearAuthSession()).rejects.toThrow();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' }),
    } as Response);
    expect((await authApi.login('bad@example.com', 'bad-password')).error).toBeDefined();
    expect(await getValidAccessToken()).toBeNull();
  });

  it('allows a successfully committed login after logout deletion failed', async () => {
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(clearAuthSession()).rejects.toThrow();
    const replacement = { ...auth, accessToken: 'replacement-access' };
    expect(await commitLoginSession(replacement, beginAuthMutation())).toBe(true);
    expect(await getValidAccessToken()).toBe('replacement-access');
  });
});
