import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from './useChat';
import { chatApi } from '../lib/api/chat';
import type { ChatMessage } from '@pairux/shared-types';

vi.mock('../lib/api/chat');

const mockMessage: ChatMessage = {
  id: 'msg-1',
  session_id: 'session-1',
  user_id: 'user-1',
  display_name: 'Test User',
  content: 'Hello world',
  message_type: 'text',
  created_at: new Date().toISOString(),
  recipient_id: null,
};

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize without loading when disabled', () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: false }));

    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.sending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch messages when enabled', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [mockMessage], hasMore: false },
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.content).toBe('Hello world');
    });
  });

  it('should not fetch when disabled', () => {
    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: false }));

    expect(chatApi.getHistory).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('should send messages', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });
    vi.mocked(chatApi.send).mockResolvedValue({
      data: mockMessage,
    });

    const { result } = renderHook(() =>
      useChat({ sessionId: 'session-1', participantId: 'participant-1', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('Hello world');
    });

    expect(chatApi.send).toHaveBeenCalledWith('session-1', 'Hello world', 'participant-1');
    expect(result.current.messages).toHaveLength(1);
  });

  it('should not send empty messages', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(chatApi.send).not.toHaveBeenCalled();
  });

  it('should deduplicate messages', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [mockMessage, mockMessage], hasMore: false },
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
  });

  it('should handle fetch errors', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      error: 'Server error',
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));

    await waitFor(() => {
      expect(result.current.error).toBe('Server error');
    });
  });

  it('should handle send errors', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });
    vi.mocked(chatApi.send).mockResolvedValue({
      error: 'Send failed',
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.error).toBe('Send failed');
  });

  it('ignores history returned by a previous session generation', async () => {
    let resolveOldHistory!: (value: {
      data: { messages: ChatMessage[]; hasMore: boolean };
    }) => void;
    vi.mocked(chatApi.getHistory)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldHistory = resolve;
        })
      )
      .mockResolvedValueOnce({
        data: {
          messages: [{ ...mockMessage, id: 'msg-new', session_id: 'session-2' }],
          hasMore: false,
        },
      });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChat({ sessionId, enabled: true }),
      { initialProps: { sessionId: 'session-1' } }
    );

    rerender({ sessionId: 'session-2' });
    await waitFor(() => {
      expect(result.current.messages.map((message) => message.id)).toEqual(['msg-new']);
    });

    await act(async () => {
      resolveOldHistory({ data: { messages: [mockMessage], hasMore: false } });
      await Promise.resolve();
    });

    expect(result.current.messages.map((message) => message.id)).toEqual(['msg-new']);
  });

  it('does not overlap polling requests within the same generation', async () => {
    vi.useFakeTimers();
    let resolveFirstPoll!: (value: { data: { messages: ChatMessage[]; hasMore: boolean } }) => void;
    vi.mocked(chatApi.getHistory)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPoll = resolve;
        })
      )
      .mockResolvedValue({ data: { messages: [], hasMore: false } });

    try {
      renderHook(() => useChat({ sessionId: 'session-1', enabled: true }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(chatApi.getHistory).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(chatApi.getHistory).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFirstPoll({ data: { messages: [], hasMore: false } });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(chatApi.getHistory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a send response after the active session changes', async () => {
    let resolveSend!: (value: { data: ChatMessage }) => void;
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });
    vi.mocked(chatApi.send).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChat({ sessionId, enabled: true }),
      { initialProps: { sessionId: 'session-1' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('old session message');
    });
    rerender({ sessionId: 'session-2' });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      resolveSend({ data: mockMessage });
      await sendPromise;
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sending).toBe(false);
  });

  it('clears a stale sending state when chat is disabled and re-enabled', async () => {
    let resolveSend!: (value: { data: ChatMessage }) => void;
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });
    vi.mocked(chatApi.send).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useChat({ sessionId: 'session-1', enabled }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('message before disable');
    });
    expect(result.current.sending).toBe(true);

    rerender({ enabled: false });
    expect(result.current.sending).toBe(false);
    rerender({ enabled: true });

    await act(async () => {
      resolveSend({ data: mockMessage });
      await sendPromise;
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sending).toBe(false);
  });
});
