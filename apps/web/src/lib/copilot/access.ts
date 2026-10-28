/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CopilotAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface CopilotCaller {
  userId: string;
  sessionId: string;
  /** The caller's own participant id in this meeting, '' when not found. */
  participantId: string;
  isHost: boolean;
  sessionStatus: string;
  title: string | null;
}

/**
 * A signed-in user (cookie, desktop Bearer or `pairux` CLI token) who is the
 * meeting's host or a live participant in it. The copilot is personal, so
 * guests without an account cannot run one.
 */
export async function authorizeCopilotCaller(
  request: Request,
  sessionId: string,
  participantId = ''
): Promise<CopilotCaller> {
  const user = await requestUser(request);
  if (!user) throw new CopilotAccessError('Sign in to use the AI copilot.', 401);
  return authorizeUserInMeeting(user.id, sessionId, participantId);
}

/** The same rule for a user already known (MCP, CLI): host or live participant. */
export async function authorizeUserInMeeting(
  userId: string,
  sessionId: string,
  participantId = ''
): Promise<CopilotCaller> {
  if (!UUID.test(sessionId)) throw new CopilotAccessError('Invalid meeting.', 400);
  const user = { id: userId };
  const db = serviceClient() as any;
  const { data: session } = await db
    .from('sessions')
    .select('id, host_user_id, status, subject')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) throw new CopilotAccessError('Session not found', 404);
  const { data: rows } = await db
    .from('session_participants')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .is('left_at', null);
  const own = ((rows ?? []) as { id: string }[]).map((row) => row.id);
  const isHost = session.host_user_id === user.id;
  if (!isHost && !own.length)
    throw new CopilotAccessError('Join this meeting to use the AI copilot in it.', 403);
  const claimed = UUID.test(participantId) && own.includes(participantId) ? participantId : '';
  return {
    userId: user.id,
    sessionId,
    participantId: claimed !== '' ? claimed : (own[0] ?? ''),
    isHost,
    sessionStatus: String(session.status),
    title: session.subject ?? null,
  };
}
