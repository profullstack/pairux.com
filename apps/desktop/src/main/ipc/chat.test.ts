import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock handlers storage
const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../auth/secure-storage', () => ({
  getStoredAuth: vi.fn().mockReturnValue({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAt: Date.now() + 3600000,
    user: { id: 'user-1', email: 'test@test.com' },
  }),
  isAuthExpired: vi.fn().mockReturnValue(false),
}));

// Mock fetch globally
const mockFetch = vi.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

describe('Chat IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockHandlers.clear();

    const { registerChatHandlers } = await import('./chat');
    registerChatHandlers();
  });

  describe('chat:send', () => {
    it('should send a message and return the result', async () => {
      const mockMessage = {
        id: 'msg-1',
        session_id: 'session-1',
        user_id: 'user-1',
        display_name: 'Test',
        content: 'Hello',
        message_type: 'text',
        created_at: new Date().toISOString(),
        recipient_id: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockMessage }),
      });

      const handler = mockHandlers.get('chat:send');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { sessionId: 'session-1', content: 'Hello' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat/send'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sessionId: 'session-1', content: 'Hello' }),
        })
      );
      expect(result).toEqual({ success: true, message: mockMessage });
    });

    it('should use API_BASE_URL for fetch calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'msg-1' } }),
      });

      const handler = mockHandlers.get('chat:send');
      await handler?.({}, { sessionId: 'session-1', content: 'test' });

      // In test environment, NODE_ENV is 'test', not 'development',
      // so API_BASE_URL should resolve to production URL
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toMatch(/\/api\/chat\/send$/);
    });
  });

  describe('chat:getHistory', () => {
    it('should fetch chat history with correct params', async () => {
      const mockMessages = [
        { id: 'msg-1', content: 'Hello', created_at: new Date().toISOString() },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { messages: mockMessages, hasMore: false } }),
      });

      const handler = mockHandlers.get('chat:getHistory');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { sessionId: 'session-1', limit: 50 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/chat/history');
      expect(calledUrl).toContain('sessionId=session-1');
      expect(calledUrl).toContain('limit=50');
      expect(result).toEqual({
        success: true,
        messages: mockMessages,
        hasMore: false,
      });
    });

    it('should return error when not authenticated', async () => {
      const { getStoredAuth } = await import('../auth/secure-storage');
      (getStoredAuth as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      // Re-register to pick up the mock change
      mockHandlers.clear();
      const { registerChatHandlers } = await import('./chat');
      registerChatHandlers();

      const handler = mockHandlers.get('chat:getHistory');
      const result = await handler?.({}, { sessionId: 'session-1' });

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const handler = mockHandlers.get('chat:getHistory');
      const result = await handler?.({}, { sessionId: 'session-1' });

      expect(result).toEqual({ success: false, error: 'Network error' });
    });
  });
});
