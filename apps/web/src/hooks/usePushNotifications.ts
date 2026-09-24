'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  PushError,
  getSubscription,
  pushSupport,
  subscribe as subscribePush,
  unsubscribe as unsubscribePush,
} from '@profullstack/notifications/client';

interface UsePushNotificationsOptions {
  participantId?: string;
}

interface UsePushNotificationsReturn {
  /** Whether push notifications can work in this browser right now */
  isSupported: boolean;
  /** Why not, in a sentence to show the user (null when supported) */
  unsupportedReason: string | null;
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

export function usePushNotifications(
  options: UsePushNotificationsOptions = {}
): UsePushNotificationsReturn {
  const { participantId } = options;

  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check support and current subscription state on mount. The VAPID key is
  // fetched from the server when subscribing, so a build without it no longer
  // makes every browser look unsupported.
  useEffect(() => {
    const support = pushSupport();
    setIsSupported(support.supported);
    setUnsupportedReason(support.message);
    if (support.permission !== 'unsupported') setPermission(support.permission);
    if (!support.supported) return;

    void getSubscription().then((existing) => {
      setIsSubscribed(existing !== null);
    });
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);
    try {
      await subscribePush({
        vapidKeyUrl: '/api/push/vapid-public-key',
        serviceWorkerUrl: '/sw.js',
        save: async (json) => {
          const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: json.endpoint,
              keys: json.keys,
              ...(participantId ? { participantId } : {}),
            }),
          });
          if (!response.ok) throw new Error('Failed to save subscription on server');
        },
      });
      setPermission('granted');
      setIsSubscribed(true);
      return true;
    } catch (err) {
      if (err instanceof PushError) {
        if (err.reason === 'denied') setPermission('denied');
        setUnsupportedReason(err.message);
      }
      console.error('[Push] Subscribe error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, participantId]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const existing = await getSubscription();
      await unsubscribePush();
      if (existing) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
      }
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
    unsupportedReason,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
  };
}
