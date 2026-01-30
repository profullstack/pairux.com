import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiRequest, getAuthToken } from './api';
import * as secureStorage from './secure-storage';

vi.mock('./secure-storage');
vi.mock('../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

const mockAuth = {
  accessToken: 'test-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3600000,
  user: { id: 'user-1', email: 'test@example.com' },
};

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuthToken', () => {
    it('should return access token when auth is valid', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      const token = await getAuthToken();
      expect(token).toBe('test-token');
    });

    it('should return null when no stored auth', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(null);

      const token = await getAuthToken();
      expect(token).toBeNull();
    });

    it('should return null when auth is expired', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(true);

      const token = await getAuthToken();
      expect(token).toBeNull();
    });
  });

  describe('apiRequest', () => {
    it('should make authenticated request with Bearer token', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: '1' } }),
      } as Response);

      const result = await apiRequest<{ id: string }>('/api/test');
      expect(result.data).toEqual({ id: '1' });
      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/test', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
      });
    });

    it('should return error when not authenticated', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(null);

      const result = await apiRequest('/api/test');
      expect(result.error).toBe('Not authenticated');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should skip auth when requireAuth is false', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'public' }),
      } as Response);

      const result = await apiRequest('/api/public', {}, false);
      expect(result.data).toBe('public');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/public',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        })
      );
    });

    it('should return error for non-ok response', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      } as Response);

      const result = await apiRequest('/api/missing');
      expect(result.error).toBe('Not found');
    });

    it('should return generic error for non-ok response without error message', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const result = await apiRequest('/api/broken');
      expect(result.error).toBe('Request failed with status 500');
    });

    it('should return network error on fetch failure', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockRejectedValue(new Error('Network unreachable'));

      const result = await apiRequest('/api/test');
      expect(result.error).toBe('Network unreachable');
    });

    it('should pass custom headers and options', async () => {
      vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: true }),
      } as Response);

      await apiRequest('/api/test', {
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      });

      expect(fetch).toHaveBeenCalledWith('https://pairux.com/api/test', {
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
      });
    });
  });
});
