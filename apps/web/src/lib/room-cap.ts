/**
 * Room capacity: what happens when a host's plan is full.
 *
 * The cap itself lives in two places that already enforce it: join_session
 * (RAISE 'Session is full' once settings.maxParticipants signed-in seats are
 * taken) and the LiveKit token mint (resolveUserPlan + maxListeners). This
 * module turns a refusal into an upgrade moment: the joiner gets a polite
 * "the host's plan is full", and the host is told (push + a flag on the
 * session that the host page shows as an upgrade prompt).
 *
 * Server-only (it pushes). The client-safe plan helpers live in lib/plans.ts.
 */

/** What a blocked joiner reads. Never names the host's plan or price. */
export const ROOM_FULL_MESSAGE =
  "This room is full: the host's plan has no seats left. The host has been told, so try again in a little while.";

/** join_session raises this when the signed-in seats are all taken. */
export function isRoomFullError(message: string | null | undefined): boolean {
  return typeof message === 'string' && /session is full/i.test(message);
}

/** Session settings keys written when a joiner is turned away. */
export interface CapRefusalSettings {
  capRefusedAt?: string;
  capRefusedCount?: number;
}

interface SessionsTable {
  from: (table: 'sessions') => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<{
          data: { settings: Record<string, unknown> | null; host_user_id: string } | null;
        }>;
      };
    };
    update: (value: { settings: Record<string, unknown> }) => {
      eq: (column: string, value: string) => Promise<unknown>;
    };
  };
}

/**
 * Remember that someone was turned away, so the host page can show the
 * upgrade prompt, and push the host. Best effort: never fails the request.
 */
export async function recordCapRefusal(db: unknown, sessionId: string): Promise<void> {
  try {
    const sessions = db as SessionsTable;
    const { data } = await sessions
      .from('sessions')
      .select('settings, host_user_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (!data) return;

    const settings = data.settings ?? {};
    const previous = Number(settings.capRefusedCount ?? 0);
    await sessions
      .from('sessions')
      .update({
        settings: {
          ...settings,
          capRefusedAt: new Date().toISOString(),
          capRefusedCount: (Number.isFinite(previous) ? previous : 0) + 1,
        },
      })
      .eq('id', sessionId);

    const { sendPushToUser } = await import('@/lib/push');
    await sendPushToUser(data.host_user_id, 'participantJoined', {
      title: 'Your room is full',
      body: 'Someone just tried to join and was turned away. Upgrade to make room.',
      url: `/host/${sessionId}`,
      tag: `room-full-${sessionId}`,
    });
  } catch (err) {
    console.warn('[room-cap] could not record refusal', err);
  }
}
