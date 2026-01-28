/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// temporary Serwist import at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

// Cast to ServiceWorkerGlobalScope for push/notification APIs
const sw = self as unknown as ServiceWorkerGlobalScope;

// Handle incoming push notifications
sw.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json() as {
      title: string;
      body: string;
      url?: string;
      tag?: string;
    };

    event.waitUntil(
      sw.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/apple-touch-icon-72x72.png',
        tag: payload.tag ?? 'pairux-notification',
        data: { url: payload.url ?? '/' },
      })
    );
  } catch (err) {
    console.error('[SW] Push event error:', err);
  }
});

// Handle notification click - focus or open the target URL
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data as { url?: string }).url ?? '/';

  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return sw.clients.openWindow(url);
    })
  );
});

serwist.addEventListeners();
