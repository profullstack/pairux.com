import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypingIndicator } from './useTypingIndicator';

// Mock Supabase channel
const mockSend = vi.fn().mockResolvedValue('ok');
const mockSubscribe = vi.fn().mockReturnThis();
const mockOn = vi.fn().mockReturnThis();
const mockRemoveChannel = vi.fn();
const mockChannelFn = vi.fn();

let broadcastHandler: ((msg: { payload: unknown }) => void) | null = null;

const mockChannel = {
  send: mockSend,
  subscribe: mockSubscribe,
  on: mockOn,
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    channel: mockChannelFn,
    removeChannel: mockRemoveChannel,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  broadcastHandler = null;

  mockChannelFn.mockReturnValue(mockChannel);

  // Capture the broadcast handler when channel.on is called
  mockOn.mockImplementation(
    (_type: string, _filter: unknown, handler: (msg: { payload: unknown }) => void) => {
      broadcastHandler = handler;
      return mockChannel;
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const defaultOptions = {
  sessionId: 'session-1',
  participantId: 'user-1',
  displayName: 'Alice',
};

describe('useTypingIndicator', () => {
  describe('initialization', () => {
    it('should initialize with empty typing users', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      expect(result.current.typingUsers).toEqual([]);
    });

    it('should create a channel with self: false', () => {
      renderHook(() => useTypingIndicator(defaultOptions));

      expect(mockChannelFn).toHaveBeenCalledWith('typing:session-1', {
        config: { broadcast: { self: false } },
      });
    });

    it('should subscribe to the channel', () => {
      renderHook(() => useTypingIndicator(defaultOptions));
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('should listen for broadcast typing events', () => {
      renderHook(() => useTypingIndicator(defaultOptions));
      expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'typing' }, expect.any(Function));
    });
  });

  describe('emitTyping', () => {
    it('should send typing broadcast', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        result.current.emitTyping();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'typing',
        payload: { participantId: 'user-1', displayName: 'Alice', isTyping: true },
      });
    });

    it('should debounce rapid typing events (1s)', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        result.current.emitTyping();
      });

      expect(mockSend).toHaveBeenCalledTimes(1);

      // Call again within 1s debounce window
      act(() => {
        vi.advanceTimersByTime(500);
        result.current.emitTyping();
      });

      // Should NOT have sent a second broadcast
      expect(mockSend).toHaveBeenCalledTimes(1);

      // After 1s, should allow a new send
      act(() => {
        vi.advanceTimersByTime(600);
        result.current.emitTyping();
      });

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should auto-send stop typing after 3s inactivity', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        result.current.emitTyping();
      });

      // Initial typing send
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Advance 3s for auto-stop
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Should have sent isTyping: false
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenLastCalledWith({
        type: 'broadcast',
        event: 'typing',
        payload: { participantId: 'user-1', displayName: 'Alice', isTyping: false },
      });
    });

    it('should not send if participantId is undefined', () => {
      const { result } = renderHook(() =>
        useTypingIndicator({ ...defaultOptions, participantId: undefined })
      );

      act(() => {
        result.current.emitTyping();
      });

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should not send if displayName is undefined', () => {
      const { result } = renderHook(() =>
        useTypingIndicator({ ...defaultOptions, displayName: undefined })
      );

      act(() => {
        result.current.emitTyping();
      });

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('stopTyping', () => {
    it('should send stop typing broadcast immediately', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        result.current.emitTyping();
      });

      act(() => {
        result.current.stopTyping();
      });

      expect(mockSend).toHaveBeenLastCalledWith({
        type: 'broadcast',
        event: 'typing',
        payload: { participantId: 'user-1', displayName: 'Alice', isTyping: false },
      });
    });

    it('should reset debounce timer so next emitTyping sends immediately', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        result.current.emitTyping();
      });
      act(() => {
        result.current.stopTyping();
      });

      mockSend.mockClear();

      // Next emitTyping should send immediately (lastEmitRef reset to 0)
      act(() => {
        result.current.emitTyping();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'typing',
        payload: { participantId: 'user-1', displayName: 'Alice', isTyping: true },
      });
    });
  });

  describe('receiving typing events', () => {
    it('should add typing user when receiving isTyping: true', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      expect(result.current.typingUsers).toEqual([{ participantId: 'user-2', displayName: 'Bob' }]);
    });

    it('should remove typing user when receiving isTyping: false', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      expect(result.current.typingUsers).toHaveLength(1);

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: false },
        });
      });

      expect(result.current.typingUsers).toEqual([]);
    });

    it('should auto-clear typing user after 3s timeout', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      expect(result.current.typingUsers).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.typingUsers).toEqual([]);
    });

    it('should handle multiple typing users', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-3', displayName: 'Charlie', isTyping: true },
        });
      });

      expect(result.current.typingUsers).toHaveLength(2);
      expect(result.current.typingUsers).toEqual(
        expect.arrayContaining([
          { participantId: 'user-2', displayName: 'Bob' },
          { participantId: 'user-3', displayName: 'Charlie' },
        ])
      );
    });

    it('should reset timeout when same user types again', () => {
      const { result } = renderHook(() => useTypingIndicator(defaultOptions));

      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      // Advance 2s (not yet expired)
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.typingUsers).toHaveLength(1);

      // User types again, resetting the 3s timeout
      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      // Advance another 2s (would have expired if timeout wasn't reset)
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.typingUsers).toHaveLength(1);

      // Now advance to full 3s from last event
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.typingUsers).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should remove channel on unmount', () => {
      const { unmount } = renderHook(() => useTypingIndicator(defaultOptions));

      unmount();

      expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
    });

    it('should clear typing timeouts on unmount', () => {
      const { result, unmount } = renderHook(() => useTypingIndicator(defaultOptions));

      // Add a typing user to create a timeout
      act(() => {
        broadcastHandler?.({
          payload: { participantId: 'user-2', displayName: 'Bob', isTyping: true },
        });
      });

      expect(result.current.typingUsers).toHaveLength(1);

      unmount();

      // Should not throw or cause issues
    });

    it('should clear emit auto-stop timeout on unmount', () => {
      const { result, unmount } = renderHook(() => useTypingIndicator(defaultOptions));

      // Start typing to create auto-stop timeout
      act(() => {
        result.current.emitTyping();
      });

      unmount();

      // Advancing timers should not cause issues
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    });
  });

  describe('session changes', () => {
    it('should recreate channel when sessionId changes', () => {
      const { rerender } = renderHook(
        ({ sessionId }) => useTypingIndicator({ ...defaultOptions, sessionId }),
        { initialProps: { sessionId: 'session-1' } }
      );

      // Remove channel from first session
      const firstChannelRemoveCount = mockRemoveChannel.mock.calls.length;

      rerender({ sessionId: 'session-2' });

      // Should have removed the old channel
      expect(mockRemoveChannel.mock.calls.length).toBeGreaterThan(firstChannelRemoveCount);

      // Should have created a new channel
      expect(mockChannelFn).toHaveBeenCalledWith('typing:session-2', {
        config: { broadcast: { self: false } },
      });
    });
  });
});
