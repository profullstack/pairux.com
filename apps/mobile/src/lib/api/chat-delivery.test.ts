import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatApi, CHAT_REQUEST_TIMEOUT_MS } from './chat';
import { getAuthToken } from '../api';
import { getValidAccessToken } from '../auth-session';
vi.mock('../auth-session', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
}));

describe('bounded chat requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('finishes waiting even if native fetch ignores abort and never resolves', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const pending = chatApi.send('room', 'once');
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ failureKind: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a response whose body never finishes parsing', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
    const pending = chatApi.send('room', 'once');
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ failureKind: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not send a request that was cancelled before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await chatApi.send('room', 'unused', undefined, controller.signal)).toMatchObject({
      failureKind: 'unknown',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never sends a late POST if authentication finishes after the deadline', async () => {
    let finishAuth!: (value: string) => void;
    vi.mocked(getValidAccessToken).mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuth = resolve;
      })
    );
    const pending = chatApi.send('room', 'must not be posted later');
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ failureKind: 'unknown' });
    finishAuth('late-token');
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not POST after cancellation while authentication is pending', async () => {
    let finishAuth!: (value: string) => void;
    vi.mocked(getValidAccessToken).mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuth = resolve;
      })
    );
    const controller = new AbortController();
    const pending = chatApi.send('room', 'cancelled draft', undefined, controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual({ error: 'Chat request interrupted', failureKind: 'unknown' });
    finishAuth('late-token');
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['fetch', 'body'] as const)(
    'handles the %s rejection produced by a deadline abort',
    async (stage) => {
      const rejected = vi.fn();
      vi.mocked(fetch).mockImplementation((_url, options) => {
        const waitForAbort = () =>
          new Promise<never>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => {
                rejected();
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });
        if (stage === 'fetch') return waitForAbort();
        const response = new Response(null, { status: 200 });
        vi.spyOn(response, 'json').mockImplementation(waitForAbort);
        return Promise.resolve(response);
      });
      const pending = chatApi.send('room', 'once');
      await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
      expect(await pending).toEqual({ error: 'Chat request interrupted', failureKind: 'unknown' });
      await vi.advanceTimersByTimeAsync(1);
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('removes cancellation listeners and deadlines after a successful send', async () => {
    const response = { data: { id: 'confirmed-message', session_id: 'room' } };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => response } as Response);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await chatApi.send('room', 'once', undefined, controller.signal)).toEqual(response);
    const listener = add.mock.calls.find(([event]) => event === 'abort')?.[1];
    expect(listener).toBeTypeOf('function');
    expect(remove).toHaveBeenCalledWith('abort', listener);
    controller.abort();
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled history requests without creating additional requests', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const pending = chatApi.getHistory('room', { limit: 25 });
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ error: 'Chat request interrupted', failureKind: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0]?.[0];
    if (!request) throw new Error('Expected a history request');
    const url = new URL(request instanceof Request ? request.url : request);
    expect(url.pathname).toBe('/api/chat/history');
    expect(url.searchParams.get('sessionId')).toBe('room');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 404, 413, 422, 429])(
    'classifies explicit %s rejection without retry',
    async (status) => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: 'Rejected' }),
      } as Response);
      expect(await chatApi.send('room', 'test')).toMatchObject({ failureKind: 'rejected' });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([408, 500, 502, 504])('keeps ambiguous %s failure unknown', async (status) => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: 'Uncertain' }),
    } as Response);
    expect(await chatApi.send('room', 'test')).toMatchObject({ failureKind: 'unknown' });
  });

  it('still uses the existing auth flow', async () => {
    expect(await getAuthToken()).toBe('test-token');
  });
});
