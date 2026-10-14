/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface MeetingCaller {
  sessionId: string;
  hostUserId: string;
  participantId: string;
  userId: string | null;
  isHost: boolean;
}
export class MeetingAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The same rule as /api/livekit/token: the owner; a signed-in user with a live
 * participant row; or a guest holding a live participant id in a public, live
 * room. Translation is only for people who are in the meeting. */
export async function authorizeMeetingCaller(
  sessionId: string,
  participantId: string
): Promise<MeetingCaller> {
  if (!UUID.test(sessionId) || (participantId && !UUID.test(participantId)))
    throw new MeetingAccessError('Invalid meeting or participant.', 400);
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  const svc = serviceClient() as any;
  const { data: session } = await svc
    .from('sessions')
    .select('id, host_user_id, status, is_public, current_host_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) throw new MeetingAccessError('Session not found', 404);
  if (session.status === 'ended') throw new MeetingAccessError('Session has ended', 400);
  const isHost = Boolean(user) && session.host_user_id === user?.id;
  if (!isHost) {
    let query = svc
      .from('session_participants')
      .select('id')
      .eq('session_id', sessionId)
      .is('left_at', null);
    if (user) query = query.eq('user_id', user.id);
    else {
      if (!session.is_public || !session.current_host_id || !participantId)
        throw new MeetingAccessError('Sign in to join this room', 401);
      query = query.eq('id', participantId);
    }
    const { data: rows } = await query.limit(1);
    if (!rows?.length) throw new MeetingAccessError('Not authorized for this session', 403);
  }
  return {
    sessionId,
    hostUserId: session.host_user_id,
    participantId,
    userId: user?.id ?? null,
    isHost,
  };
}
