import { sendPush, vapidKeysFromEnv, type VapidKeys } from '@profullstack/notifications/server';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_PREFERENCES = {
  pushEnabled: true,
  controlRequest: true,
  chatMessage: true,
  participantJoined: true,
  participantLeft: true,
  hostDisconnected: true,
  creatorLive: true,
  directMessage: true,
  // Meeting reminders, one key per lead time so a host can keep the day-before
  // nudge and drop the one that fires while they are already walking to their
  // desk. The same four keys gate the emailed reminder — see
  // `meeting-reminders.ts`, which reads them from the same place — so turning
  // one off here silences that lead time on both channels rather than only in
  // the browser.
  meetingReminder1Day: true,
  meetingReminder1Hour: true,
  meetingReminder15Min: true,
  meetingReminder1Min: true,
};

export type PushEventType = keyof Omit<typeof DEFAULT_PREFERENCES, 'pushEnabled'>;

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const PUSH_SUBJECT = 'mailto:support@pairux.com';

// VAPID keys, read at RUN time. `process.env.NEXT_PUBLIC_…` written out in
// code is replaced by Next at build time (even on the server), so a key that
// was missing from the build compiled to undefined and silently disabled every
// push; vapidKeysFromEnv looks the names up dynamically instead.
let vapidKeys: VapidKeys | null = null;

function initWebPush(): boolean {
  if (vapidKeys) return true;
  vapidKeys = vapidKeysFromEnv(process.env);
  if (!vapidKeys) {
    console.warn('[Push] Missing VAPID keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY); push disabled');
    return false;
  }
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

  const keys = vapidKeys;
  if (!keys) return { sent: 0, failed: subscriptions.length };

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { keys, subject: PUSH_SUBJECT }
      );
      if (result.sent) sent++;
      else failed++;
      if (result.gone) staleIds.push(sub.id);
    })
  );

  // Remove stale subscriptions
  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds);
  }

  return { sent, failed };
}
