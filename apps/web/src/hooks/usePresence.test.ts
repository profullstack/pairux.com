import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresence, useMediaSession, useHostTransfer } from './usePresence';

// Mock supabase client
const mockRpc = vi.fn();
const mockSupabase = {
  rpc: mockRpc,
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

describe('usePresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default mock for RPC calls
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() =>
        usePresence({ sessionId: 'test-session', enabled: false })
      );

      expect(result.current.isOnline).toBe(false);
      expect(result.current.lastSeen).toBeNull();
      expect(result.current.hostOnline).toBe(true);
      expect(result.current.hostLastSeen).toBeNull();
    });

    it('should not send heartbeat when disabled', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('should send initial participant heartbeat when enabled', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: false }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockRpc).toHaveBeenCalledWith('update_participant_presence', {
        p_session_id: 'test-session',
      });
    });

    it('should send initial host heartbeat when host', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockRpc).toHaveBeenCalledWith('update_host_presence', {
        p_session_id: 'test-session',
      });
    });
  });

  describe('heartbeat intervals', () => {
    it('should send participant heartbeat every 30 seconds', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: false }));

      // Initial heartbeat
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockRpc).toHaveBeenCalledTimes(2); // participant + host status check

      // After 30 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(mockRpc).toHaveBeenCalledWith('update_participant_presence', {
        p_session_id: 'test-session',
      });
    });

    it('should send host heartbeat every 15 seconds', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: true }));

      // Initial heartbeat
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const initialCalls = mockRpc.mock.calls.length;

      // After 15 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(mockRpc.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe('host status checking', () => {
    it('should check host status for non-host participants', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: false }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockRpc).toHaveBeenCalledWith('get_session_status', {
        p_session_id: 'test-session',
      });
    });

    it('should call onHostOffline when host goes offline', async () => {
      const onHostOffline = vi.fn();
      mockRpc.mockImplementation((method) => {
        if (method === 'get_session_status') {
          return Promise.resolve({
            data: [{ host_online: false, host_last_seen: new Date().toISOString() }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderHook(() =>
        usePresence({
          sessionId: 'test-session',
          enabled: true,
          isHost: false,
          onHostOffline,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onHostOffline).toHaveBeenCalled();
    });

    it('should call onHostOnline when host comes back online', async () => {
      const onHostOnline = vi.fn();
      let callCount = 0;

      mockRpc.mockImplementation((method) => {
        if (method === 'get_session_status') {
          callCount++;
          // First call: host offline, second call: host online
          const hostOnline = callCount > 1;
          return Promise.resolve({
            data: [{ host_online: hostOnline, host_last_seen: new Date().toISOString() }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderHook(() =>
        usePresence({
          sessionId: 'test-session',
          enabled: true,
          isHost: false,
          onHostOnline,
        })
      );

      // First check - host is offline
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Second check after interval - host comes online
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(onHostOnline).toHaveBeenCalled();
    });
  });

  describe('visibility change', () => {
    it('should send heartbeat when page becomes visible', async () => {
      renderHook(() => usePresence({ sessionId: 'test-session', enabled: true, isHost: false }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const initialCalls = mockRpc.mock.calls.length;

      // Simulate visibility change
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockRpc.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe('sendHeartbeat', () => {
    it('should manually send heartbeat', async () => {
      const { result } = renderHook(() =>
        usePresence({ sessionId: 'test-session', enabled: true, isHost: false })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      mockRpc.mockClear();

      await act(async () => {
        await result.current.sendHeartbeat();
      });

      expect(mockRpc).toHaveBeenCalledWith('update_participant_presence', {
        p_session_id: 'test-session',
      });
    });
  });

  describe('cleanup', () => {
    it('should cleanup intervals on unmount', async () => {
      const { unmount } = renderHook(() =>
        usePresence({ sessionId: 'test-session', enabled: true })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      unmount();

      mockRpc.mockClear();

      // Advance timers - should not trigger any more calls
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });

      // No new calls after unmount (visibility handler may still be active briefly)
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});

describe('useMediaSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  describe('startMediaSession', () => {
    it('should start a media session', async () => {
      const mockSession = {
        id: 'media-session-123',
        room_id: 'test-session',
        mode: 'p2p',
      };
      mockRpc.mockResolvedValueOnce({ data: mockSession, error: null });

      const { result } = renderHook(() =>
        useMediaSession({ sessionId: 'test-session', mode: 'p2p' })
      );

      await act(async () => {
        await result.current.startMediaSession();
      });

      expect(mockRpc).toHaveBeenCalledWith('start_media_session', {
        p_room_id: 'test-session',
        p_mode: 'p2p',
        p_capture_source: null,
        p_sfu_endpoint: null,
        p_sfu_room_id: null,
      });
      expect(result.current.mediaSessionId).toBe('media-session-123');
      expect(result.current.isActive).toBe(true);
    });

    it('should handle start errors', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: new Error('Failed to start'),
      });

      const { result } = renderHook(() => useMediaSession({ sessionId: 'test-session' }));

      const session = await act(async () => {
        return await result.current.startMediaSession();
      });

      expect(session).toBeNull();
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('pauseMediaSession', () => {
    it('should pause an active session', async () => {
      const mockSession = { id: 'media-session-123' };
      mockRpc
        .mockResolvedValueOnce({ data: mockSession, error: null }) // start
        .mockResolvedValueOnce({ data: mockSession, error: null }); // pause

      const { result } = renderHook(() => useMediaSession({ sessionId: 'test-session' }));

      await act(async () => {
        await result.current.startMediaSession();
      });

      await act(async () => {
        await result.current.pauseMediaSession();
      });

      expect(mockRpc).toHaveBeenCalledWith('pause_media_session', {
        p_media_session_id: 'media-session-123',
      });
      expect(result.current.isActive).toBe(false);
    });

    it('should return null if no session exists', async () => {
      const { result } = renderHook(() => useMediaSession({ sessionId: 'test-session' }));

      const paused = await act(async () => {
        return await result.current.pauseMediaSession();
      });

      expect(paused).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe('endMediaSession', () => {
    it('should end an active session', async () => {
      const mockSession = { id: 'media-session-123' };
      mockRpc
        .mockResolvedValueOnce({ data: mockSession, error: null }) // start
        .mockResolvedValueOnce({ data: mockSession, error: null }); // end

      const { result } = renderHook(() => useMediaSession({ sessionId: 'test-session' }));

      await act(async () => {
        await result.current.startMediaSession();
      });

      await act(async () => {
        await result.current.endMediaSession();
      });

      expect(mockRpc).toHaveBeenCalledWith('end_media_session', {
        p_media_session_id: 'media-session-123',
      });
      expect(result.current.mediaSessionId).toBeNull();
      expect(result.current.isActive).toBe(false);
    });
  });
});

describe('useHostTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  describe('transferHost', () => {
    it('should transfer host to new participant', async () => {
      const mockSession = { id: 'test-session', host_user_id: 'new-host' };
      mockRpc.mockResolvedValueOnce({ data: mockSession, error: null });

      const { result } = renderHook(() => useHostTransfer('test-session'));

      const transferResult = await act(async () => {
        return await result.current.transferHost('participant-456');
      });

      expect(mockRpc).toHaveBeenCalledWith('transfer_host', {
        p_session_id: 'test-session',
        p_new_host_participant_id: 'participant-456',
      });
      expect(transferResult.success).toBe(true);
      expect(transferResult.session).toEqual(mockSession);
    });

    it('should handle transfer errors', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not authorized' },
      });

      const { result } = renderHook(() => useHostTransfer('test-session'));

      const transferResult = await act(async () => {
        return await result.current.transferHost('participant-456');
      });

      expect(transferResult.success).toBe(false);
      expect(transferResult.error).toBe('Not authorized');
    });
  });

  describe('setBackupHost', () => {
    it('should set a backup host', async () => {
      const mockParticipant = { id: 'participant-456', is_backup_host: true };
      mockRpc.mockResolvedValueOnce({ data: mockParticipant, error: null });

      const { result } = renderHook(() => useHostTransfer('test-session'));

      const setResult = await act(async () => {
        return await result.current.setBackupHost('participant-456', true);
      });

      expect(mockRpc).toHaveBeenCalledWith('set_backup_host', {
        p_session_id: 'test-session',
        p_participant_id: 'participant-456',
        p_is_backup: true,
      });
      expect(setResult.success).toBe(true);
    });

    it('should unset backup host', async () => {
      const mockParticipant = { id: 'participant-456', is_backup_host: false };
      mockRpc.mockResolvedValueOnce({ data: mockParticipant, error: null });

      const { result } = renderHook(() => useHostTransfer('test-session'));

      await act(async () => {
        await result.current.setBackupHost('participant-456', false);
      });

      expect(mockRpc).toHaveBeenCalledWith('set_backup_host', {
        p_session_id: 'test-session',
        p_participant_id: 'participant-456',
        p_is_backup: false,
      });
    });

    it('should handle set backup host errors', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Participant not found' },
      });

      const { result } = renderHook(() => useHostTransfer('test-session'));

      const setResult = await act(async () => {
        return await result.current.setBackupHost('participant-456');
      });

      expect(setResult.success).toBe(false);
      expect(setResult.error).toBe('Participant not found');
    });
  });
});
