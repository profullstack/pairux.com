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

  it('should initialize with loading state', () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({
      data: { messages: [], hasMore: false },
    });

    const { result } = renderHook(() => useChat({ sessionId: 'session-1', enabled: false }));

    expect(result.current.loading).toBe(true);
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
    expect(result.current.loading).toBe(true);
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
});
