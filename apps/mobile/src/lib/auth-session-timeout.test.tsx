import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import RNEventSource from 'react-native-sse';
import { mediaDevices } from 'react-native-webrtc';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { useWebRTCHost } from '../hooks/useWebRTCHost';
import { useWebRTCViewer } from '../hooks/useWebRTCViewer';
import { emitAppStateChange, secureStoreData } from '../test/setup';
import {
  beginAuthMutation,
  clearAuthSession,
  commitLoginSession,
  getValidAccessToken,
  refreshAuthSession,
} from './auth-session';
import { getStoredAuth, storeAuth, type StoredAuth } from './secure-storage';

vi.mock('../config', () => ({ API_BASE_URL: 'https://pairux.invalid' }));

const expired: StoredAuth = {
  accessToken: 'fixture-old-access',
  refreshToken: 'fixture-old-refresh',
  expiresAt: 1,
  user: { id: 'fixture-user', email: 'user@example.invalid' },
};

function envelope() {
  return {
    data: {
      session: {
        accessToken: 'fixture-rotated-access',
        refreshToken: 'fixture-rotated-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    },
  };
}

function successResponse() {
  return { ok: true, json: async () => envelope() } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const cleanups: (() => void)[] = [];

// Model a stalled transport that honors AbortSignal. No real network/native I/O.
function stallRefresh(phase: 'request' | 'body' = 'request') {
  const response = deferred<Response>();
  const body = deferred<unknown>();
  let signal: AbortSignal | null | undefined;
  const abort = () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    if (phase === 'request') response.reject(error);
    else body.reject(error);
  };
  vi.mocked(fetch).mockImplementationOnce((_url, options) => {
    signal = options?.signal;
    signal?.addEventListener('abort', abort, { once: true });
    return phase === 'request'
      ? response.promise
      : Promise.resolve({ ok: true, json: () => body.promise } as Response);
  });
  cleanups.push(() => {
    signal?.removeEventListener('abort', abort);
    response.resolve(successResponse());
    body.resolve(envelope());
  });
  return {
    get signal() {
      return signal;
    },
  };
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('refresh request deadline', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await clearAuthSession();
    await storeAuth(expired);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await advance();
    await clearAuthSession();
    vi.useRealTimers();
  });

  it.each(['request', 'body'] as const)(
    'releases all callers after a stalled %s and allows a fresh retry',
    async (phase) => {
      const stalled = stallRefresh(phase);
      const refreshed = vi.fn();
      const token = vi.fn();
      void refreshAuthSession().then(refreshed);
      void getValidAccessToken().then(token);
      await advance();
      expect(fetch).toHaveBeenCalledTimes(1);

      await advance(9999);
      expect(refreshed).not.toHaveBeenCalled();
      expect(token).not.toHaveBeenCalled();
      await advance(1);
      expect(refreshed).toHaveBeenCalledWith({ auth: null, failure: 'transient' });
      expect(token).toHaveBeenCalledWith(null);
      expect(stalled.signal?.aborted).toBe(true);
      expect(await getStoredAuth()).toEqual(expired);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      vi.mocked(fetch).mockResolvedValueOnce(successResponse());
      expect(await getValidAccessToken()).toBe('fixture-rotated-access');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toBe(
        JSON.stringify({ refreshToken: expired.refreshToken })
      );
      expect((await getStoredAuth())?.refreshToken).toBe('fixture-rotated-refresh');
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['success', 'rejected', 'server error', 'malformed', 'network error'] as const)(
    'clears the deadline after %s',
    async (outcome) => {
      if (outcome === 'network error') {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
      } else {
        vi.mocked(fetch).mockResolvedValueOnce(
          outcome === 'success'
            ? successResponse()
            : ({
                ok: outcome === 'malformed',
                status: outcome === 'rejected' ? 401 : 503,
                json: async () => ({ data: {} }),
              } as Response)
        );
      }
      const result = await refreshAuthSession();
      if (outcome === 'success') {
        expect(result.auth?.accessToken).toBe('fixture-rotated-access');
      } else {
        expect(result).toEqual({
          auth: null,
          failure: outcome === 'rejected' ? 'rejected' : 'transient',
        });
        expect(await getStoredAuth()).toEqual(expired);
      }
      const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(vi.getTimerCount()).toBe(0);
      await advance(10000);
      expect(signal?.aborted).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps an old timeout superseded and gives a new login its own deadline', async () => {
    const oldRequest = stallRefresh();
    const oldResult = vi.fn();
    void refreshAuthSession().then(oldResult);
    await advance(5000);
    await clearAuthSession();
    const replacement = {
      ...expired,
      refreshToken: 'fixture-new-refresh',
      user: { id: 'fixture-new-user', email: 'new@example.invalid' },
    };
    expect(await commitLoginSession(replacement, beginAuthMutation())).toBe(true);
    const newRequest = stallRefresh();
    const newResult = vi.fn();
    void refreshAuthSession().then(newResult);
    await advance();
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(oldResult).toHaveBeenCalledWith({ auth: null, failure: 'superseded' });
    expect(oldRequest.signal?.aborted).toBe(true);
    expect(newRequest.signal?.aborted).toBe(false);
    expect(newResult).not.toHaveBeenCalled();
    expect(await getStoredAuth()).toEqual(replacement);

    // The old flight's finally must not retire the newer flight.
    void refreshAuthSession().then(newResult);
    await advance();
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(newResult).toHaveBeenCalledTimes(2);
    expect(newResult).toHaveBeenCalledWith({ auth: null, failure: 'transient' });
    expect(newRequest.signal?.aborted).toBe(true);
    expect(await getStoredAuth()).toEqual(replacement);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the network deadline before a slow secure-store commit', async () => {
    const write = deferred<undefined>();
    cleanups.push(() => write.resolve(undefined));
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
      await write.promise;
      secureStoreData.set(key, value);
    });
    vi.mocked(fetch).mockResolvedValueOnce(successResponse());
    const completed = vi.fn();
    const pending = refreshAuthSession().then(completed);
    await advance();
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await advance(10000);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    write.resolve(undefined);
    await pending;
    expect(completed).toHaveBeenCalledWith({
      auth: expect.objectContaining({ accessToken: 'fixture-rotated-access' }),
    });
  });

  it('finishes startup loading without deleting the recoverable session', async () => {
    stallRefresh();
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });
    await advance();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(true);
    await advance(10000);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toEqual(expired.user);
    expect(await getStoredAuth()).toEqual(expired);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  const clients = {
    viewer: function useViewer() {
      const viewer = useWebRTCViewer({
        sessionId: 'fixture-session',
        participantId: 'fixture-user',
      });
      return { error: viewer.error, start: viewer.reconnect };
    },
    host: function useHost() {
      const host = useWebRTCHost({ sessionId: 'fixture-session', hostId: 'fixture-user' });
      return {
        error: host.error,
        start: () => {
          void host.startHosting();
        },
      };
    },
  };

  it.each(['viewer', 'host'] as const)(
    'unblocks a %s foreground reconnect and opens SSE on an explicit retry',
    async (role) => {
      stallRefresh();
      const { result, unmount } = renderHook(clients[role]);
      if (role === 'host')
        act(() => {
          result.current.start();
        });
      await advance();
      expect(fetch).toHaveBeenCalledTimes(1);
      act(() => emitAppStateChange('background'));
      act(() => emitAppStateChange('active'));
      await advance();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(RNEventSource).not.toHaveBeenCalled();
      expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
      await advance(10000);
      expect(result.current.error).toBe('Not authenticated. Please log in again.');
      expect(await getStoredAuth()).toEqual(expired);

      vi.mocked(fetch).mockResolvedValueOnce(successResponse());
      act(() => {
        result.current.start();
      });
      await advance();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(RNEventSource).toHaveBeenCalledTimes(1);
      expect(RNEventSource).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/fixture-session/signal/stream?'),
        { headers: { Authorization: 'Bearer fixture-rotated-access' }, pollingInterval: 0 }
      );
      expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
