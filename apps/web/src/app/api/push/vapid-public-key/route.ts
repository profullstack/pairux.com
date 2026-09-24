import { vapidKeysFromEnv, vapidPublicKeyResponse } from '@profullstack/notifications/server';

/**
 * GET /api/push/vapid-public-key — the VAPID public key, served at runtime.
 *
 * The browser used to get it from NEXT_PUBLIC_VAPID_PUBLIC_KEY compiled into
 * the bundle; when the Docker build did not have it, every browser was told
 * "Push notifications are not supported". Fetching it from here cannot drift
 * from the key the server signs with.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return vapidPublicKeyResponse(vapidKeysFromEnv(process.env));
}
