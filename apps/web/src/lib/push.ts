import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_PREFERENCES = {
  pushEnabled: true,
  controlRequest: true,
  chatMessage: true,
  participantJoined: true,
  participantLeft: true,
  hostDisconnected: true,
  creatorLive: true,
};

export type PushEventType = keyof Omit<typeof DEFAULT_PREFERENCES, 'pushEnabled'>;

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// Lazy-initialize web-push with VAPID details
let initialized = false;

function initWebPush(): boolean {
  if (initialized) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    console.warn('[Push] Missing VAPID environment variables, push notifications disabled');
    return false;
  }

  webpush.setVapidDetails('mailto:support@pairux.com', publicKey, privateKey);
  initialized = true;
  return true;
}

// Server-side Supabase admin client (bypasses RLS)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Get notification preferences from profiles.settings.notifications
 */
async function getUserPreferences(userId: string): Promise<typeof DEFAULT_PREFERENCES> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from('profiles').select('settings').eq('id', userId).single();

  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const notifPrefs = (settings.notifications ?? {}) as Record<string, unknown>;

  return { ...DEFAULT_PREFERENCES, ...notifPrefs };
}

/**
 * Send push notification to all devices for a user.
 * Checks user preferences before sending.
 * Cleans up stale subscriptions (410/404).
 */
export async function sendPushToUser(
  userId: string,
  eventType: PushEventType,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!initWebPush()) return { sent: 0, failed: 0 };

  const prefs = await getUserPreferences(userId);
  if (!prefs.pushEnabled || !prefs[eventType]) {
    return { sent: 0, failed: 0 };
  }

  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return sendToSubscriptions(supabase, subscriptions, payload);
}

/**
 * Send push notification to a guest participant.
 */
export async function sendPushToParticipant(
  participantId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!initWebPush()) return { sent: 0, failed: 0 };

  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('participant_id', participantId)
    .is('user_id', null);

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return sendToSubscriptions(supabase, subscriptions, payload);
}

/**
 * Send push notification to all active participants in a session.
 */
export async function sendPushToSession(
  sessionId: string,
  eventType: PushEventType,
  payload: PushPayload,
  excludeUserIds: string[] = [],
  excludeParticipantIds: string[] = []
): Promise<{ sent: number; failed: number }> {
  if (!initWebPush()) return { sent: 0, failed: 0 };

  const supabase = getSupabaseAdmin();

  const { data: participants } = await supabase
    .from('session_participants')
    .select('id, user_id')
    .eq('session_id', sessionId)
    .is('left_at', null);

  if (!participants) return { sent: 0, failed: 0 };

  let totalSent = 0;
  let totalFailed = 0;

  for (const participant of participants) {
    const pUserId = participant.user_id as string | null;
    const pId = participant.id as string;

    if (pUserId && excludeUserIds.includes(pUserId)) continue;
    if (excludeParticipantIds.includes(pId)) continue;

    let result;
    if (pUserId) {
      result = await sendPushToUser(pUserId, eventType, payload);
    } else {
      result = await sendPushToParticipant(pId, payload);
    }

    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return { sent: totalSent, failed: totalFailed };
}

// Internal: send to a list of subscription rows and clean up stale ones
async function sendToSubscriptions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  const jsonPayload = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          jsonPayload
        );
        sent++;
      } catch (err: unknown) {
        const error = err as { statusCode?: number };
        if (error.statusCode === 404 || error.statusCode === 410) {
          staleIds.push(sub.id);
        }
        failed++;
      }
    })
  );

  // Remove stale subscriptions
  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds);
  }

  return { sent, failed };
}
