import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatApi } from './chat';
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

describe('chatApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(secureStorage.getStoredAuth).mockResolvedValue(mockAuth);
    vi.mocked(secureStorage.isAuthExpired).mockReturnValue(false);
  });

  describe('send', () => {
    it('should POST message to chat API', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: 'msg-1', content: 'Hello', session_id: 'session-1' },
        }),
      } as Response);

      const result = await chatApi.send('session-1', 'Hello', 'participant-1');
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/chat/send',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'session-1',
            content: 'Hello',
            participantId: 'participant-1',
          }),
        })
      );
      expect(result.data?.content).toBe('Hello');
    });
  });

  describe('getHistory', () => {
    it('should GET chat history for session', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            messages: [{ id: 'msg-1', content: 'Hi' }],
            hasMore: false,
          },
        }),
      } as Response);

      const result = await chatApi.getHistory('session-1');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat/history?sessionId=session-1'),
        expect.any(Object)
      );
      expect(result.data?.messages).toHaveLength(1);
      expect(result.data?.hasMore).toBe(false);
    });

    it('should pass limit and before options as query params', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { messages: [], hasMore: false } }),
      } as Response);

      await chatApi.getHistory('session-1', { limit: 50, before: 'msg-5' });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/sessionId=session-1.*limit=50.*before=msg-5/),
        expect.any(Object)
      );
    });
  });
});
