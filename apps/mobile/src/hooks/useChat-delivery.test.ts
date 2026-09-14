import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';
import { chatApi } from '../lib/api/chat';
vi.mock('../lib/api/chat');

describe('chat delivery outcomes', () => {
  it('marks history ready only after success and resets it for a different room', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValueOnce({ error: 'Offline' });
    const { result, rerender } = renderHook(
      ({ sessionId, enabled }) => useChat({ sessionId, enabled }),
      {
        initialProps: { sessionId: 'room', enabled: true },
      }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.historyReady).toBe(false);
    rerender({ sessionId: 'room', enabled: false });
    vi.mocked(chatApi.getHistory).mockResolvedValueOnce({ data: { messages: [], hasMore: false } });
    rerender({ sessionId: 'room', enabled: true });
    await waitFor(() => expect(result.current.historyReady).toBe(true));
    rerender({ sessionId: 'other-room', enabled: false });
    expect(result.current.historyReady).toBe(false);
  });

  it.each([
    [{ error: 'Rejected', failureKind: 'rejected' as const }, 'failed'],
    [{ error: 'Network failure' }, 'unknown'],
  ])('distinguishes rejection from uncertainty: %j', async (response, status) => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({ data: { messages: [], hasMore: false } });
    vi.mocked(chatApi.send).mockResolvedValue(response);
    const { result } = renderHook(() => useChat({ sessionId: 'room' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sendMessage('test');
    });
    expect(outcome).toEqual({ status });
  });

  it('cancels before sending when disabled', async () => {
    vi.mocked(chatApi.send).mockClear();
    const { result } = renderHook(() => useChat({ sessionId: 'room', enabled: false }));
    expect(await result.current.sendMessage('draft')).toEqual({ status: 'cancelled' });
    expect(chatApi.send).not.toHaveBeenCalled();
  });

  it('keeps an aborted send uncertain and can send again after re-enabling', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({ data: { messages: [], hasMore: false } });
    vi.mocked(chatApi.send).mockImplementationOnce(
      (_room, _text, _participant, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ error: 'Aborted', failureKind: 'unknown' }),
            { once: true }
          );
        })
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useChat({ sessionId: 'room', enabled }),
      {
        initialProps: { enabled: true },
      }
    );
    let pending!: ReturnType<typeof result.current.sendMessage>;
    act(() => {
      pending = result.current.sendMessage('once');
    });
    expect(result.current.sending).toBe(true);
    rerender({ enabled: false });
    await act(async () => {
      expect(await pending).toEqual({ status: 'unknown' });
    });
    expect(result.current.sending).toBe(false);
    rerender({ enabled: true });
    vi.mocked(chatApi.send).mockResolvedValue({ error: 'Rejected', failureKind: 'rejected' });
    await act(async () => {
      expect(await result.current.sendMessage('manual retry')).toEqual({ status: 'failed' });
    });
    expect(result.current.sending).toBe(false);
  });
});
