import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Set VAPID key before module load (vi.hoisted runs before imports)
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkOs-qy7505aFNGpOTN_4Bz8T5RA8ZjqO1QjAPGeZs';
});

import { usePushNotifications } from './usePushNotifications';

const mockSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  toJSON: () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
    keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

const mockPushManager = {
  getSubscription: vi.fn().mockResolvedValue(null),
  subscribe: vi.fn().mockResolvedValue(mockSubscription),
};

const mockRegistration = {
  pushManager: mockPushManager,
};

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushManager.getSubscription.mockResolvedValue(null);
    mockPushManager.subscribe.mockResolvedValue(mockSubscription);
    mockSubscription.unsubscribe.mockResolvedValue(true);

    // Mock browser APIs
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default' as NotificationPermission,
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(mockRegistration),
      },
      writable: true,
      configurable: true,
    });

    // Ensure PushManager exists
    Object.defineProperty(window, 'PushManager', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response);
  });

  it('should detect browser support', () => {
    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('should detect unsupported browser', () => {
    // Must delete the property so 'PushManager' in window returns false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).PushManager;

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(false);
  });

  it('should start as not subscribed', () => {
    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSubscribed).toBe(false);
  });

  it('should detect existing subscription on mount', async () => {
    mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isSubscribed).toBe(true);
  });

  it('should subscribe successfully', async () => {
    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should return false when permission is denied', async () => {
    (window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'denied'
    );

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
  });

  it('should return false when not supported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).PushManager;

    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
  });

  it('should unsubscribe successfully', async () => {
    mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

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
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
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
