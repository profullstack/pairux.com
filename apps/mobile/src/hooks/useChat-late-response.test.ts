import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@pairux/shared-types';
import { useChat } from './useChat';
import { CHAT_REQUEST_TIMEOUT_MS } from '../lib/api/chat';

vi.mock('../lib/auth-session', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
}));

describe('late responses through the actual chat transport and hook', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['resolve', 'reject'] as const)(
    'does not commit or resend a timed-out message when its body later %ss',
    async (completion) => {
      const message = {
        id: 'committed-message',
        session_id: 'room',
        content: 'once',
        created_at: '2026-01-01T00:00:00.000Z',
        user_id: 'user',
      } as ChatMessage;
      let history: ChatMessage[] = [];
      let completeBody!: () => void;
      const posts = vi.fn();
      vi.mocked(fetch).mockImplementation((_url, options) => {
        if (options?.method === 'POST') {
          posts();
          return Promise.resolve({
            ok: true,
            json: () =>
              new Promise((resolve, reject) => {
                completeBody = () =>
                  completion === 'resolve'
                    ? resolve({ data: message })
                    : reject(new DOMException('Aborted', 'AbortError'));
              }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { messages: history, hasMore: false } }),
        } as Response);
      });
      const { result, unmount } = renderHook(() => useChat({ sessionId: 'room' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.historyReady).toBe(true);
      let pending!: ReturnType<typeof result.current.sendMessage>;
      act(() => {
        pending = result.current.sendMessage('once');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
      });
      expect(await pending).toEqual({ status: 'unknown' });
      expect(result.current.sending).toBe(false);
      await act(async () => {
        completeBody();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.messages).toEqual([]);
      expect(result.current.sending).toBe(false);
      expect(posts).toHaveBeenCalledTimes(1);
      // Only a later history read may reconcile an already committed server row.
      history = [message];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(result.current.messages).toEqual([message]);
      expect(posts).toHaveBeenCalledTimes(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
