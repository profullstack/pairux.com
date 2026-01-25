import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from './useSession';

// Get the mock API from setup
const mockElectronAPI = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } })
  .electronAPI;

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useSession());

    expect(result.current.session).toBeNull();
    expect(result.current.participants).toEqual([]);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.isEnding).toBe(false);
    expect(result.current.error).toBeNull();
  });

  describe('createSession', () => {
    it('should create a session successfully', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: { quality: 'medium', allowControl: false, maxParticipants: 5 },
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockElectronAPI.invoke.mockResolvedValueOnce({
        success: true,
        session: mockSession,
      });

      const { result } = renderHook(() => useSession());

      let returnedSession;
      await act(async () => {
        returnedSession = await result.current.createSession({ allowGuestControl: false });
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('session:create', {
        allowGuestControl: false,
      });
      expect(returnedSession).toEqual(mockSession);
      expect(result.current.session).toEqual(mockSession);
      expect(result.current.error).toBeNull();
    });

    it('should handle session creation error', async () => {
      mockElectronAPI.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Not authenticated',
      });

      const { result } = renderHook(() => useSession());

      let returnedSession;
      await act(async () => {
        returnedSession = await result.current.createSession();
      });

      expect(returnedSession).toBeNull();
      expect(result.current.session).toBeNull();
      expect(result.current.error).toBe('Not authenticated');
    });

    it('should set isCreating during creation', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockElectronAPI.invoke.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useSession());

      act(() => {
        void result.current.createSession();
      });

      expect(result.current.isCreating).toBe(true);

      await act(async () => {
        resolvePromise!({ success: true, session: { id: 'test' } });
        await promise;
      });

      expect(result.current.isCreating).toBe(false);
    });

    it('should pass mode parameter when creating session with p2p', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        mode: 'p2p',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockElectronAPI.invoke.mockResolvedValueOnce({
        success: true,
        session: mockSession,
      });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.createSession({ mode: 'p2p' });
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('session:create', {
        mode: 'p2p',
      });
    });

    it('should pass mode parameter when creating session with sfu', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        mode: 'sfu',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockElectronAPI.invoke.mockResolvedValueOnce({
        success: true,
        session: mockSession,
      });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.createSession({ mode: 'sfu', maxParticipants: 10 });
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('session:create', {
        mode: 'sfu',
        maxParticipants: 10,
      });
    });
  });

  describe('endSession', () => {
    it('should end session successfully', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockElectronAPI.invoke
        .mockResolvedValueOnce({ success: true, session: mockSession })
        .mockResolvedValueOnce({ success: true });

      const { result } = renderHook(() => useSession());

      // First create a session
      await act(async () => {
        await result.current.createSession();
      });

      expect(result.current.session).not.toBeNull();

      // Then end it
      await act(async () => {
        await result.current.endSession();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('session:end', {
        sessionId: 'session-123',
      });
      expect(result.current.session).toBeNull();
      expect(result.current.participants).toEqual([]);
    });

    it('should handle end session error', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      mockElectronAPI.invoke
        .mockResolvedValueOnce({ success: true, session: mockSession })
        .mockResolvedValueOnce({ success: false, error: 'Session not found' });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.createSession();
      });

      await act(async () => {
        await result.current.endSession();
      });

      expect(result.current.error).toBe('Session not found');
      // Session should still be set since ending failed
      expect(result.current.session).not.toBeNull();
    });

    it('should not call API if no session exists', async () => {
      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.endSession();
      });

      expect(mockElectronAPI.invoke).not.toHaveBeenCalled();
    });
  });

  describe('refreshSession', () => {
    it('should refresh session and participants', async () => {
      const mockSession = {
        id: 'session-123',
        join_code: 'ABC123',
        host_user_id: 'user-1',
        status: 'active',
        settings: {},
        created_at: new Date().toISOString(),
        ended_at: null,
      };

      const mockParticipants = [
        {
          id: 'p-1',
          session_id: 'session-123',
          user_id: 'user-1',
          display_name: 'Host',
          is_host: true,
          joined_at: new Date().toISOString(),
          left_at: null,
        },
      ];

      mockElectronAPI.invoke
        .mockResolvedValueOnce({ success: true, session: mockSession })
        .mockResolvedValueOnce({
          success: true,
          session: { ...mockSession, status: 'active' },
          participants: mockParticipants,
        });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.createSession();
      });

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('session:get', {
        sessionId: 'session-123',
      });
      expect(result.current.participants).toEqual(mockParticipants);
    });
  });

  describe('clearError', () => {
    it('should clear the error', async () => {
      mockElectronAPI.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Some error',
      });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.createSession();
      });

      expect(result.current.error).toBe('Some error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
