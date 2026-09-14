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
