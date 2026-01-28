'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UsePushNotificationsOptions {
  participantId?: string;
}

interface UsePushNotificationsReturn {
  /** Whether push notifications are supported in this browser */
  isSupported: boolean;
  /** Current notification permission state */
  permission: NotificationPermission;
  /** Whether the user is currently subscribed */
  isSubscribed: boolean;
  /** Whether a subscribe/unsubscribe operation is in progress */
  isLoading: boolean;
  /** Request permission and subscribe to push notifications */
  subscribe: () => Promise<boolean>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<boolean>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

export function usePushNotifications(
  options: UsePushNotificationsOptions = {}
): UsePushNotificationsReturn {
  const { participantId } = options;

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  // Check support and current subscription state on mount
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      !!VAPID_PUBLIC_KEY;

    setIsSupported(supported);

    if (!supported) return;

    setPermission(Notification.permission);

    void navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        subscriptionRef.current = existing;
        setIsSubscribed(true);
      }
    });
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        return false;
      }

      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      subscriptionRef.current = subscription;

      const json = subscription.toJSON();
      const keys = json.keys as { p256dh: string; auth: string } | undefined;

      if (!keys?.p256dh || !keys.auth) {
        throw new Error('Missing subscription keys');
      }

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          ...(participantId ? { participantId } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save subscription on server');
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error('[Push] Subscribe error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, participantId]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const subscription = subscriptionRef.current;
      if (!subscription) return true;

      await subscription.unsubscribe();

      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      subscriptionRef.current = null;
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error('[Push] Unsubscribe error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
  };
}
