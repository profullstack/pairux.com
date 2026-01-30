import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authApi } from './auth';
import * as secureStorage from '../secure-storage';

vi.mock('../secure-storage');
vi.mock('../../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should send login request and store auth data', async () => {
      const loginResponse = {
        accessToken: 'token-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 3600000,
        user: { id: 'user-1', email: 'test@example.com' },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => loginResponse,
      } as Response);

      const result = await authApi.login('test@example.com', 'password');

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password' }),
      });
      expect(secureStorage.storeAuth).toHaveBeenCalledWith({
        accessToken: 'token-123',
        refreshToken: 'refresh-123',
        expiresAt: loginResponse.expiresAt,
        user: { id: 'user-1', email: 'test@example.com' },
      });
      expect(result.data).toEqual(expect.objectContaining({ accessToken: 'token-123' }));
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

    it('should return network error on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await authApi.login('test@example.com', 'password');
      expect(result.error).toBe('Network error');
    });
  });

  describe('signup', () => {
    it('should send signup request', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Account created' }),
      } as Response);

      const result = await authApi.signup({
        email: 'new@example.com',
        password: 'password',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'password',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      });
      expect(result.data?.message).toBe('Account created');
    });

    it('should return error for failed signup', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Email already in use' }),
      } as Response);

      const result = await authApi.signup({
        email: 'existing@example.com',
        password: 'password',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(result.error).toBe('Email already in use');
    });
  });

  describe('logout', () => {
    it('should call logout API and clear stored auth', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        user: { id: '1', email: 'test@example.com' },
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
  });
});
