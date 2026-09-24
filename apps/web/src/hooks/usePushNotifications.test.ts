import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  class PushError extends Error {
    reason: string;
    constructor(reason: string, message = reason) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    PushError,
    pushSupport: vi.fn(),
    getSubscription: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
});

vi.mock('@profullstack/notifications/client', () => mocks);

import { usePushNotifications } from './usePushNotifications';

const subscriptionJson = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
};

const mockSubscription = { endpoint: subscriptionJson.endpoint };

const SUPPORTED = { supported: true, reason: null, message: null, permission: 'default' };

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pushSupport.mockReturnValue(SUPPORTED);
    mocks.getSubscription.mockResolvedValue(null);
    mocks.unsubscribe.mockResolvedValue(true);
    // The package hands the new subscription to `save`; PairUX's save POSTs it.
    mocks.subscribe.mockImplementation(
      async (opts: { save: (json: typeof subscriptionJson) => Promise<void> }) => {
        await opts.save(subscriptionJson);
        return mockSubscription;
      }
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response);
  });

  it('should detect browser support', () => {
    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(true);
    expect(result.current.unsupportedReason).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should detect unsupported browser and say why', () => {
    mocks.pushSupport.mockReturnValue({
      supported: false,
      reason: 'ios-needs-install',
      message: 'On iPhone and iPad, add this site to your Home Screen.',
      permission: 'unsupported',
    });

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.unsupportedReason).toMatch(/Home Screen/);
  });

  it('should start as not subscribed', () => {
    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSubscribed).toBe(false);
  });

  it('should detect existing subscription on mount', async () => {
    mocks.getSubscription.mockResolvedValueOnce(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isSubscribed).toBe(true);
  });

  it('should subscribe with the runtime VAPID key endpoint', async () => {
    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(true);
    expect(mocks.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        vapidKeyUrl: '/api/push/vapid-public-key',
        serviceWorkerUrl: '/sw.js',
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should return false when permission is denied', async () => {
    mocks.subscribe.mockRejectedValueOnce(
      new mocks.PushError('denied', 'Notifications are blocked for this site.')
    );

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.permission).toBe('denied');
  });

  it('should return false when not supported', async () => {
    mocks.pushSupport.mockReturnValue({
      supported: false,
      reason: 'no-push-manager',
      message: 'This browser does not support push notifications.',
      permission: 'unsupported',
    });

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('should unsubscribe successfully', async () => {
    mocks.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isSubscribed).toBe(true);

    let success = false;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(false);
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/push/unsubscribe',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should return true when unsubscribing with no existing subscription', async () => {
    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(true);
    expect(global.fetch).not.toHaveBeenCalledWith('/api/push/unsubscribe', expect.anything());
  });

  it('should include participantId when provided', async () => {
    const { result } = renderHook(() =>
      usePushNotifications({ participantId: 'guest-participant-1' })
    );

    await act(async () => {
      await result.current.subscribe();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({
        body: expect.stringContaining('guest-participant-1'),
      })
    );
  });

  it('should handle subscribe error gracefully', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle server error on subscribe', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    } as Response);

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
  });
});
