import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from './useChat';

// Get the mock API from setup
const mockElectronAPI = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } })
  .electronAPI;

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadHistory', () => {
    it('should load chat history on mount', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          user_id: 'user-1',
          display_name: 'Alice',
          content: 'Hello',
          message_type: 'user',
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'msg-2',
          session_id: 'session-123',
          user_id: 'user-2',
          display_name: 'Bob',
          content: 'Hi there',
          message_type: 'user',
          created_at: '2024-01-01T10:01:00Z',
        },
      ];

      mockElectronAPI.invoke.mockResolvedValue({
        success: true,
        messages: mockMessages,
        hasMore: true,
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('chat:getHistory', {
        sessionId: 'session-123',
      });
      expect(result.current.messages).toEqual(mockMessages);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.isConnected).toBe(true);
    });

    it('should handle load history error', async () => {
      mockElectronAPI.invoke.mockResolvedValue({
        success: false,
        error: 'Session not found',
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Session not found');
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should send a message successfully', async () => {
      const existingMessage = {
        id: 'msg-1',
        session_id: 'session-123',
        user_id: 'user-1',
        display_name: 'Alice',
        content: 'Hello',
        message_type: 'user',
        created_at: '2024-01-01T10:00:00Z',
      };

      const newMessage = {
        id: 'msg-new',
        session_id: 'session-123',
        user_id: 'user-1',
        display_name: 'Alice',
        content: 'New message',
        message_type: 'user',
        created_at: '2024-01-01T10:02:00Z',
      };

      mockElectronAPI.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'chat:getHistory') {
          return {
            success: true,
            messages: [existingMessage],
            hasMore: false,
          };
        }
        if (channel === 'chat:send') {
          return {
            success: true,
            message: newMessage,
          };
        }
        return { success: false, error: 'Unknown channel' };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('New message');
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('chat:send', {
        sessionId: 'session-123',
        content: 'New message',
      });
      expect(result.current.messages).toContainEqual(newMessage);
    });

    it('should trim message content', async () => {
      mockElectronAPI.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'chat:getHistory') {
          return { success: true, messages: [], hasMore: false };
        }
        if (channel === 'chat:send') {
          return {
            success: true,
            message: { id: 'msg-1', content: 'Hello', created_at: '2024-01-01T10:00:00Z' },
          };
        }
        return { success: false, error: 'Unknown channel' };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('  Hello  ');
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('chat:send', {
        sessionId: 'session-123',
        content: 'Hello',
      });
    });

    it('should not send empty messages', async () => {
      mockElectronAPI.invoke.mockResolvedValue({
        success: true,
        messages: [],
        hasMore: false,
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const callCount = mockElectronAPI.invoke.mock.calls.length;

      await act(async () => {
        await result.current.sendMessage('   ');
      });

      // Should not make another API call
      expect(mockElectronAPI.invoke.mock.calls.length).toBe(callCount);
    });

    it('should throw error on send failure', async () => {
      mockElectronAPI.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'chat:getHistory') {
          return { success: true, messages: [], hasMore: false };
        }
        if (channel === 'chat:send') {
          return { success: false, error: 'Rate limit exceeded' };
        }
        return { success: false, error: 'Unknown channel' };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.sendMessage('Hello');
        })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should not add duplicate messages', async () => {
      const message = {
        id: 'msg-1',
        session_id: 'session-123',
        user_id: 'user-1',
        display_name: 'Alice',
        content: 'Hello',
        message_type: 'user',
        created_at: '2024-01-01T10:00:00Z',
      };

      mockElectronAPI.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'chat:getHistory') {
          return { success: true, messages: [message], hasMore: false };
        }
        if (channel === 'chat:send') {
          return { success: true, message: message }; // Same message returned
        }
        return { success: false, error: 'Unknown channel' };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      // Should still only have one message
      expect(result.current.messages.filter((m) => m.id === 'msg-1')).toHaveLength(1);
    });
  });

  describe('loadMore', () => {
    it('should load more messages with pagination', async () => {
      const initialMessages = [
        {
          id: 'msg-2',
          session_id: 'session-123',
          user_id: 'user-1',
          display_name: 'Alice',
          content: 'Message 2',
          message_type: 'user',
          created_at: '2024-01-01T10:01:00Z',
        },
      ];

      const olderMessages = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          user_id: 'user-2',
          display_name: 'Bob',
          content: 'Message 1',
          message_type: 'user',
          created_at: '2024-01-01T10:00:00Z',
        },
      ];

      let callCount = 0;
      mockElectronAPI.invoke.mockImplementation(async (channel: string, _args: unknown) => {
        if (channel === 'chat:getHistory') {
          callCount++;
          if (callCount === 1) {
            // Initial load
            return { success: true, messages: initialMessages, hasMore: true };
          }
          // Load more
          return { success: true, messages: olderMessages, hasMore: false };
        }
        return { success: false, error: 'Unknown channel' };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages).toEqual(initialMessages);
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.messages).toEqual([...olderMessages, ...initialMessages]);
      expect(result.current.hasMore).toBe(false);
    });

    it('should not load more when hasMore is false', async () => {
      mockElectronAPI.invoke.mockResolvedValue({
        success: true,
        messages: [{ id: 'msg-1', created_at: '2024-01-01T10:00:00Z' }],
        hasMore: false,
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const callCount = mockElectronAPI.invoke.mock.calls.length;

      await act(async () => {
        await result.current.loadMore();
      });

      // Should not make another API call
      expect(mockElectronAPI.invoke.mock.calls.length).toBe(callCount);
    });
  });

  describe('reconnect', () => {
    it('should reload history and clear error', async () => {
      let callCount = 0;
      mockElectronAPI.invoke.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { success: false, error: 'Connection failed' };
        }
        return {
          success: true,
          messages: [{ id: 'msg-1', created_at: '2024-01-01T10:00:00Z' }],
          hasMore: false,
        };
      });

      const { result } = renderHook(() =>
        useChat({ sessionId: 'session-123', autoConnect: false })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Connection failed');

      act(() => {
        result.current.reconnect();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
        expect(result.current.isConnected).toBe(true);
      });
    });
  });
});
