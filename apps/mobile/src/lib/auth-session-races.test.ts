import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { secureStoreData } from '../test/setup';
import { authApi } from './api/auth';
import { clearAuthSession, getValidAccessToken, refreshAuthToken } from './auth-session';
import { getStoredAuth, storeAuth } from './secure-storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const oldAuth = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: 1,
  user: { id: 'old-user', email: 'old@example.com' },
};
const freshSession = {
  accessToken: 'refreshed-old-access',
  refreshToken: 'refreshed-old-refresh',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) }) as Response;

describe('session mutation races', () => {
  beforeEach(async () => {
    await clearAuthSession();
    await storeAuth(oldAuth);
    vi.clearAllMocks();
  });

  it('does not let an old refresh overwrite a completed login for a different user', async () => {
    const gate = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(gate.promise);
    const pending = refreshAuthToken();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.mocked(fetch).mockResolvedValueOnce(
      response({
        user: { id: 'new-user', email: 'new@example.com' },
        session: { ...freshSession, accessToken: 'new-access', refreshToken: 'new-refresh' },
      })
    );
    const login = await authApi.login('new@example.com', 'fixture-password');
    expect(login.error).toBeUndefined();
    gate.resolve(response({ session: freshSession }));
    await pending;
    expect((await getStoredAuth())?.user.id).toBe('new-user');
    expect((await getStoredAuth())?.accessToken).toBe('new-access');
  });

  it('serializes logout behind an already-started secure storage write', async () => {
    const writeGate = deferred<undefined>();
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
      await writeGate.promise;
      secureStoreData.set(key, value);
    });
    vi.mocked(fetch).mockResolvedValueOnce(response({ session: freshSession }));
    const pending = refreshAuthToken();
    await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1));
    const clearing = clearAuthSession();
    writeGate.resolve(undefined);
    await Promise.all([pending, clearing]);
    expect(await getStoredAuth()).toBeNull();
  });

  it.each([false, true])(
    'discards a superseded native login write when the newer login succeeds=%s',
    async (newerSucceeds) => {
      await clearAuthSession();
      vi.clearAllMocks();
      const writeGate = deferred<undefined>();
      vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
        await writeGate.promise;
        secureStoreData.set(key, value);
      });
      const loginResponse = (id: string) =>
        response({
          user: { id, email: `${id}@example.com` },
          session: { ...freshSession, accessToken: `${id}-access`, refreshToken: `${id}-refresh` },
        });
      vi.mocked(fetch).mockResolvedValueOnce(loginResponse('older'));
      const older = authApi.login('older@example.com', 'fixture-password');
      await vi.waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1));
      vi.mocked(fetch).mockResolvedValueOnce(
        newerSucceeds
          ? loginResponse('newer')
          : ({
              ok: false,
              status: 401,
              json: async () => ({ error: 'Invalid credentials' }),
            } as Response)
      );
      const newer = authApi.login('newer@example.com', 'fixture-password');
      writeGate.resolve(undefined);
      expect((await older).error).toBeDefined();
      const result = await newer;
      if (newerSucceeds) {
        expect(result.data?.user.id).toBe('newer');
        expect((await getStoredAuth())?.user.id).toBe('newer');
        expect(await getValidAccessToken()).toBe('newer-access');
      } else {
        expect(result.error).toBeDefined();
        expect(await getStoredAuth()).toBeNull();
        expect(await getValidAccessToken()).toBeNull();
      }
    }
  );
});
