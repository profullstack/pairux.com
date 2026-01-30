import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionApi } from './sessions';
import * as secureStorage from '../secure-storage';

vi.mock('../secure-storage');
vi.mock('../../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

const mockAuth = {
  accessToken: 'test-token',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3600000,
  user: { id: 'user-1', email: 'test@example.com' },
};

describe('sessionApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
    vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);
  });

  describe('create', () => {
    it('should POST to create a new session', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'session-1', join_code: 'ABC123' } }),
      } as Response);

      const result = await sessionApi.create({ allowGuestControl: true });

      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ allowGuestControl: true }),
        })
      );
      expect(result.data).toEqual({ id: 'session-1', join_code: 'ABC123' });
    });
  });

  describe('get', () => {
    it('should GET session by ID', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'session-1' } }),
      } as Response);

      const result = await sessionApi.get('session-1');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/session-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result.data).toEqual({ id: 'session-1' });
    });
  });

  describe('list', () => {
    it('should GET all sessions', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'session-1' }, { id: 'session-2' }] }),
      } as Response);

      const result = await sessionApi.list();
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('end', () => {
    it('should DELETE session', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'session-1', status: 'ended' } }),
      } as Response);

      await sessionApi.end('session-1');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/session-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('join', () => {
    it('should POST to join a session by code', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'participant-1', user_id: 'user-1' } }),
      } as Response);

      const result = await sessionApi.join('ABC123', 'Jane');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/join/ABC123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ displayName: 'Jane' }),
        })
      );
      expect(result.data).toEqual({ id: 'participant-1', user_id: 'user-1' });
    });
  });

  describe('lookup', () => {
    it('should GET session info by join code', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { session: { id: 'session-1' } } }),
      } as Response);

      const result = await sessionApi.lookup('ABC123');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/join/ABC123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result.data?.session).toEqual({ id: 'session-1' });
    });
  });
});
