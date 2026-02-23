import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock handlers storage
const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockStoredAuth = {
  accessToken: 'test-token',
  refreshToken: 'test-refresh',
  expiresAt: Date.now() + 3600000,
  user: { id: 'user-1', email: 'test@test.com' },
};

vi.mock('../auth/secure-storage', () => ({
  storeAuth: vi.fn(),
  getStoredAuth: vi.fn().mockReturnValue(mockStoredAuth),
  clearStoredAuth: vi.fn(),
  isAuthExpired: vi.fn().mockReturnValue(false),
  getValidAuth: vi.fn().mockResolvedValue(mockStoredAuth),
}));

// Mock fetch globally
const mockFetch = vi.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

describe('Auth IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockHandlers.clear();

    const { registerAuthHandlers } = await import('./auth');
    registerAuthHandlers();
  });

  describe('auth:login', () => {
    it('should login via API_BASE_URL', async () => {
      const mockResponse = {
        data: {
          user: { id: 'user-1', email: 'test@test.com' },
          session: {
            accessToken: 'token-123',
            refreshToken: 'refresh-123',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const handler = mockHandlers.get('auth:login');
      expect(handler).toBeDefined();

      const result = await handler?.({}, { email: 'test@test.com', password: 'password' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/auth/login');

      expect(result).toEqual({
        success: true,
        user: { id: 'user-1', email: 'test@test.com' },
      });
    });

    it('should handle login failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      const handler = mockHandlers.get('auth:login');
      const result = await handler?.({}, { email: 'test@test.com', password: 'wrong' });

      expect(result).toEqual({
        success: false,
        error: 'Invalid credentials',
      });
    });
  });

  describe('auth:logout', () => {
    it('should logout via API_BASE_URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const handler = mockHandlers.get('auth:logout');
      expect(handler).toBeDefined();

      const result = await handler?.();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/auth/logout');

      expect(result).toEqual({ success: true });
    });
  });

  describe('auth:getSession', () => {
    it('should return stored user info', async () => {
      const handler = mockHandlers.get('auth:getSession');
      expect(handler).toBeDefined();

      const result = await handler?.();
      expect(result).toEqual({
        user: { id: 'user-1', email: 'test@test.com' },
        profile: null,
      });
    });

    it('should return null when no stored auth', async () => {
      const { getValidAuth } = await import('../auth/secure-storage');
      (getValidAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      mockHandlers.clear();
      const { registerAuthHandlers } = await import('./auth');
      registerAuthHandlers();

      const handler = mockHandlers.get('auth:getSession');
      const result = await handler?.();
      expect(result).toEqual({ user: null, profile: null });
    });
  });

  describe('auth:validateSession', () => {
    it('should return valid when token is not expired', async () => {
      const handler = mockHandlers.get('auth:validateSession');
      expect(handler).toBeDefined();

      const result = await handler?.();
      expect(result).toEqual({
        valid: true,
        user: { id: 'user-1', email: 'test@test.com' },
      });
    });

    it('should try refresh and return invalid when expired and refresh fails', async () => {
      const { isAuthExpired, clearStoredAuth, getValidAuth } =
        await import('../auth/secure-storage');
      (isAuthExpired as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
      (getValidAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      mockHandlers.clear();
      const { registerAuthHandlers } = await import('./auth');
      registerAuthHandlers();

      const handler = mockHandlers.get('auth:validateSession');
      const result = await handler?.();

      expect(clearStoredAuth).toHaveBeenCalled();
      expect(result).toEqual({ valid: false, user: null });
    });

    it('should return valid when token is expired but refresh succeeds', async () => {
      const refreshedAuth = {
        ...mockStoredAuth,
        accessToken: 'refreshed-token',
      };
      const { isAuthExpired, getValidAuth } = await import('../auth/secure-storage');
      (isAuthExpired as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
      (getValidAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(refreshedAuth);

      mockHandlers.clear();
      const { registerAuthHandlers } = await import('./auth');
      registerAuthHandlers();

      const handler = mockHandlers.get('auth:validateSession');
      const result = await handler?.();

      expect(result).toEqual({
        valid: true,
        user: { id: 'user-1', email: 'test@test.com' },
      });
    });
  });

  describe('auth:openExternal', () => {
    it('should use APP_URL for relative URLs (user-facing links)', async () => {
      const { shell } = await import('electron');
      const handler = mockHandlers.get('auth:openExternal');
      expect(handler).toBeDefined();

      await handler?.({}, '/signup');

      // openExternal uses APP_URL (always production) for user-facing links
      expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('/signup'));
    });

    it('should pass through absolute URLs unchanged', async () => {
      const { shell } = await import('electron');
      const handler = mockHandlers.get('auth:openExternal');

      await handler?.({}, 'https://example.com/page');

      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
    });
  });
});
