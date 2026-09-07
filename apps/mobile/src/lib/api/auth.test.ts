import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authApi } from './auth';
import { clearAuthSession } from '../auth-session';
import * as secureStorage from '../secure-storage';
import {
  loginSuccessEnvelope,
  signupNeedsConfirmationEnvelope,
  signupConfirmedEnvelope,
  SUPABASE_EXPIRES_AT_SECONDS,
  AUTH_USER_ID,
} from '../../test/fixtures/server-contracts';

vi.mock('../secure-storage');
vi.mock('../../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('parses the wrapped { data: { user, session } } envelope and stores ms expiry', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => loginSuccessEnvelope,
      } as Response);

      const result = await authApi.login('user@example.com', 'password');

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'password' }),
      });
      expect(secureStorage.storeAuth).toHaveBeenCalledWith({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
        // Supabase returns expires_at in seconds; storage keeps milliseconds
        expiresAt: SUPABASE_EXPIRES_AT_SECONDS * 1000,
        user: { id: AUTH_USER_ID, email: 'user@example.com' },
      });
      expect(result.data).toEqual(
        expect.objectContaining({
          accessToken: 'access-token-1',
          expiresAt: SUPABASE_EXPIRES_AT_SECONDS * 1000,
        })
      );
    });

    it('should return error for failed login', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid credentials' }),
      } as Response);

      const result = await authApi.login('bad@example.com', 'wrong');
      expect(result.error).toBe('Invalid credentials');
      expect(secureStorage.storeAuth).not.toHaveBeenCalled();
    });

    it('rejects an OK response without the expected envelope', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        // Flat legacy shape — not what the server sends
        json: async () => ({ accessToken: 'x', refreshToken: 'y', expiresAt: 1, user: {} }),
      } as Response);

      const result = await authApi.login('user@example.com', 'password');
      expect(result.error).toBe('Invalid response from server');
      expect(secureStorage.storeAuth).not.toHaveBeenCalled();
    });

    it('should return network error on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await authApi.login('user@example.com', 'password');
      expect(result.error).toBe('Network error');
    });

    it('rejects a login envelope with an empty access token', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: loginSuccessEnvelope.data.user,
            session: { accessToken: '', refreshToken: 'r', expiresAt: SUPABASE_EXPIRES_AT_SECONDS },
          },
        }),
      } as Response);

      const result = await authApi.login('user@example.com', 'password');
      expect(result.error).toBe('Invalid response from server');
      expect(secureStorage.storeAuth).not.toHaveBeenCalled();
    });

    it('rejects a login envelope with a missing expiry (would store NaN)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: loginSuccessEnvelope.data.user,
            session: { accessToken: 'a', refreshToken: 'r' },
          },
        }),
      } as Response);

      const result = await authApi.login('user@example.com', 'password');
      expect(result.error).toBe('Invalid response from server');
      expect(secureStorage.storeAuth).not.toHaveBeenCalled();
    });

    it('fails instead of storing when a logout wins the race against the login', async () => {
      const gate = deferred<Response>();
      vi.mocked(fetch).mockReturnValueOnce(gate.promise);

      const pending = authApi.login('user@example.com', 'password');
      await clearAuthSession();
      gate.resolve({ ok: true, json: async () => loginSuccessEnvelope } as Response);

      const result = await pending;
      expect(result.error).toBe('Sign-in was interrupted. Please try again.');
      expect(secureStorage.storeAuth).not.toHaveBeenCalled();
    });

    it('returns an error when the login session cannot be persisted', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => loginSuccessEnvelope,
      } as Response);
      vi.mocked(secureStorage.storeAuth).mockRejectedValueOnce(new Error('keystore unavailable'));

      const result = await authApi.login('user@example.com', 'password');
      expect(result.error).toBe('keystore unavailable');
      expect(result.data).toBeUndefined();
    });
  });

  describe('signup', () => {
    it('sends confirmPassword to the server and parses the wrapped envelope', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => signupNeedsConfirmationEnvelope,
      } as Response);

      const result = await authApi.signup({
        email: 'new@example.com',
        password: 'Password1',
        confirmPassword: 'Password1',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'Password1',
          confirmPassword: 'Password1',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      });
      expect(result.data).toEqual({
        message: 'Check your email to confirm your account',
        needsConfirmation: true,
      });
    });

    it('reports when the account is created without email confirmation', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => signupConfirmedEnvelope,
      } as Response);

      const result = await authApi.signup({
        email: 'new@example.com',
        password: 'Password1',
        confirmPassword: 'Password1',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(result.data).toEqual({
        message: 'Account created successfully',
        needsConfirmation: false,
      });
    });

    it('should return error for failed signup', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Passwords do not match' }),
      } as Response);

      const result = await authApi.signup({
        email: 'existing@example.com',
        password: 'Password1',
        confirmPassword: 'Password2',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(result.error).toBe('Passwords do not match');
    });
  });

  describe('logout', () => {
    it('should call logout API and clear stored auth', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        user: { id: AUTH_USER_ID, email: 'user@example.com' },
      });
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await authApi.logout();
      expect(secureStorage.clearStoredAuth).toHaveBeenCalled();
    });

    it('should clear stored auth even if API call fails', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(null);
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await authApi.logout();
      expect(secureStorage.clearStoredAuth).toHaveBeenCalled();
    });

    it('completes locally with the captured token even when the revoke request hangs', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue({
        accessToken: 'expired-access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
        user: { id: AUTH_USER_ID, email: 'user@example.com' },
      });
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(true);
      // The revoke request never answers; local logout must not wait for it
      vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => undefined));

      await authApi.logout();

      expect(secureStorage.clearStoredAuth).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe('https://pairux.com/api/auth/logout');
      // The token is captured as-is: signing out must never mint new tokens
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer expired-access');
    });
  });
});
