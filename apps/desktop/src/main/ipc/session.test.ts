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

describe('Session IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockHandlers.clear();

    const { registerSessionHandlers } = await import('./session');
    registerSessionHandlers();
  });

  describe('session:create', () => {
    it('should create a session via API', async () => {
      const mockSession = {
        id: 'session-1',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockSession }),
      });

      const handler = mockHandlers.get('session:create');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { allowGuestControl: false, maxParticipants: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(result).toEqual({ success: true, session: mockSession });
    });

    it('should use API_BASE_URL not APP_URL for fetch URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'session-1' } }),
      });

      const handler = mockHandlers.get('session:create');
      await handler?.({}, {});

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toMatch(/\/api\/sessions$/);
    });

    it('should return error when not authenticated', async () => {
      const { getStoredAuth } = await import('../auth/secure-storage');
      (getStoredAuth as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      mockHandlers.clear();
      const { registerSessionHandlers } = await import('./session');
      registerSessionHandlers();

      const handler = mockHandlers.get('session:create');
      const result = await handler?.({}, {});

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('session:get', () => {
    it('should fetch session with participants', async () => {
      const mockData = {
        id: 'session-1',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
        session_participants: [
          {
            id: 'p-1',
            session_id: 'session-1',
            user_id: 'user-1',
            display_name: 'Host',
            role: 'host',
            control_state: 'view-only',
            is_backup_host: false,
            connection_status: 'connected',
            last_seen_at: new Date().toISOString(),
            joined_at: new Date().toISOString(),
            left_at: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      });

      const handler = mockHandlers.get('session:get');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { sessionId: 'session-1' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/sessions/session-1');

      expect(result).toEqual({
        success: true,
        session: expect.objectContaining({ id: 'session-1' }),
        participants: mockData.session_participants,
      });
    });
  });

  describe('session:end', () => {
    it('should end session via DELETE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'session-1', status: 'ended' } }),
      });

      const handler = mockHandlers.get('session:end');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { sessionId: 'session-1' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/session-1'),
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  describe('session:join', () => {
    it('should join session with join code', async () => {
      const mockParticipant = {
        id: 'p-2',
        session_id: 'session-1',
        user_id: 'user-2',
        display_name: 'Viewer',
        role: 'viewer',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockParticipant }),
      });

      const handler = mockHandlers.get('session:join');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { joinCode: 'abc123', displayName: 'Viewer' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/sessions/join/ABC123');
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  describe('session:lookup', () => {
    it('should lookup session by join code', async () => {
      const mockSession = {
        id: 'session-1',
        join_code: 'ABC123',
        status: 'active',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { session: mockSession } }),
      });

      const handler = mockHandlers.get('session:lookup');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { joinCode: 'abc123' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/sessions/join/ABC123');
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });
});
