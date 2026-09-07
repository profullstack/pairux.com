import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { isAuthExpired, type StoredAuth } from '@/lib/secure-storage';
import {
  readAuthSession as getStoredAuth,
  refreshAuthSession,
  clearAuthSession,
} from '@/lib/auth-session';
import { authApi } from '@/lib/api/auth';
import { AUTH_USER_ID } from '../test/fixtures/server-contracts';

vi.mock('@/lib/secure-storage');
vi.mock('@/lib/auth-session');
vi.mock('@/lib/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
  },
}));

const storedAuth: StoredAuth = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  expiresAt: Date.now() + 3600000,
  user: { id: AUTH_USER_ID, email: 'user@example.com' },
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderAuth() {
  return renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    ),
  });
}

describe('AuthContext session restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores a valid stored session', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(false);

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(storedAuth.user);
    expect(refreshAuthSession).not.toHaveBeenCalled();
  });

  it('refreshes an expired stored session instead of forcing a re-login', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(true);
    vi.mocked(refreshAuthSession).mockResolvedValue({
      auth: { ...storedAuth, accessToken: 'access-token-2' },
    });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(refreshAuthSession).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(storedAuth.user);
    expect(clearAuthSession).not.toHaveBeenCalled();
  });

  it('signs out only when the server definitively rejects the refresh token', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(true);
    vi.mocked(refreshAuthSession).mockResolvedValue({ auth: null, failure: 'rejected' });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(clearAuthSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored session when the refresh fails transiently (offline start)', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(true);
    vi.mocked(refreshAuthSession).mockResolvedValue({ auth: null, failure: 'transient' });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A network hiccup is not a logout: the refresh token may still be good
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(storedAuth.user);
  });

  it('leaves auth state alone when the restore refresh was superseded', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(true);
    vi.mocked(refreshAuthSession).mockResolvedValue({ auth: null, failure: 'superseded' });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A concurrent login/logout owns the state; restore must not clear it
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it('stays signed out with no stored session', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(null);

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(refreshAuthSession).not.toHaveBeenCalled();
  });
});

describe('AuthContext lifecycle races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finishes loading if a login supersedes restore but fails', async () => {
    const restore = deferred<StoredAuth | null>();
    vi.mocked(getStoredAuth).mockReturnValueOnce(restore.promise);
    vi.mocked(authApi.login).mockResolvedValueOnce({ error: 'Invalid credentials' });
    const { result } = renderAuth();
    await act(async () => {
      await result.current.login('fixture@example.com', 'fixture-password');
    });
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      restore.resolve(null);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('does not resurrect the user when a login resolves after a logout', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(null);
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    const loginGate = deferred<{ data?: StoredAuth; error?: string }>();
    vi.mocked(authApi.login).mockReturnValueOnce(loginGate.promise);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let loginPromise!: Promise<{ error?: string }>;
    act(() => {
      loginPromise = result.current.login('new@example.com', 'password');
    });
    await act(async () => {
      await result.current.logout();
    });
    await act(async () => {
      loginGate.resolve({
        data: {
          ...storedAuth,
          user: { id: 'late-user', email: 'late@example.com' },
        },
      });
      await loginPromise;
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('does not let a slow restore overwrite a fresh login', async () => {
    const restoreGate = deferred<StoredAuth | null>();
    vi.mocked(getStoredAuth).mockReturnValueOnce(restoreGate.promise);
    vi.mocked(isAuthExpired).mockReturnValue(false);
    vi.mocked(authApi.login).mockResolvedValue({
      data: { ...storedAuth, user: { id: 'fresh-user', email: 'fresh@example.com' } },
    });

    const { result } = renderAuth();
    await act(async () => {
      await result.current.login('fresh@example.com', 'password');
    });
    expect(result.current.user?.id).toBe('fresh-user');

    await act(async () => {
      // The pre-login stored session finally loads — it is stale now
      restoreGate.resolve(storedAuth);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user?.id).toBe('fresh-user');
  });

  it('signs out immediately even while the logout network call is pending', async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(storedAuth);
    vi.mocked(isAuthExpired).mockReturnValue(false);
    vi.mocked(authApi.logout).mockReturnValue(new Promise<void>(() => undefined));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => {
      void result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
