import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionApi, isScheduledLookup } from './sessions';
import * as secureStorage from '../secure-storage';
import {
  joinLookupLiveEnvelope,
  joinLookupScheduledEnvelope,
  joinParticipantEnvelope,
  AUTH_USER_ID,
  PARTICIPANT_ROW_ID,
  SESSION_ID,
} from '../../test/fixtures/server-contracts';

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
        json: async () => joinParticipantEnvelope,
      } as Response);

      const result = await sessionApi.join('ABC123', 'Jane');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/join/ABC123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ displayName: 'Jane' }),
        })
      );
      // The participant row id is NOT the authenticated user id
      expect(result.data?.id).toBe(PARTICIPANT_ROW_ID);
      expect(result.data?.user_id).toBe(AUTH_USER_ID);
      expect(result.data?.session_id).toBe(SESSION_ID);
    });
  });

  describe('lookup', () => {
    it('parses the direct session payload the route returns (no wrapper)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => joinLookupLiveEnvelope,
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
      expect(result.data).toBeDefined();
      if (!result.data || isScheduledLookup(result.data)) {
        throw new Error('Expected a live session lookup result');
      }
      expect(result.data.id).toBe(SESSION_ID);
      expect(result.data.join_code).toBe('ABC123');
      expect(result.data.status).toBe('active');
      expect(result.data.participant_count).toBe(2);
    });

    it('recognizes the scheduled-meeting payload', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => joinLookupScheduledEnvelope,
      } as Response);

      const result = await sessionApi.lookup('ABC123');
      expect(result.data).toBeDefined();
      if (!result.data || !isScheduledLookup(result.data)) {
        throw new Error('Expected a scheduled lookup result');
      }
      expect(result.data.title).toBe('Team Standup');
      expect(result.data.scheduled_at).toBe('2026-09-08T10:00:00.000Z');
    });

    it('surfaces the 404 error for an unknown code', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Session not found or has ended' }),
      } as Response);

      const result = await sessionApi.lookup('ZZZZZZ');
      expect(result.error).toBe('Session not found or has ended');
      expect(result.data).toBeUndefined();
    });
  });
});
