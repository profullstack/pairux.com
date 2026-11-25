/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * Room Q&A: a question queue for any PairUX call.
 *
 * Anyone in the call asks in the Q&A panel and upvotes other questions. A
 * moderator (a host row, the session's host user, or a user the partner named
 * when it opened the room: settings.qaModerators) can pick a question to go
 * next ("bump") or dismiss it. Agents read the queue in their poll and move a
 * question to "answering" (the panel shows "now answering") and "answered":
 * board.saas's AI chair does this on a board call.
 *
 * Who you are: a signed-in user is matched to their participant row by user id;
 * a guest sends their participant id (session_participants.id, the same
 * credential chat and the LiveKit token use). A participant id that belongs to
 * a signed-in user only works for that user.
 */
import { z } from 'zod';
import type { serviceClient } from '@/lib/supabase/service';

type ServiceClient = ReturnType<typeof serviceClient>;

export const QUESTION_STATUSES = ['open', 'answering', 'answered', 'dismissed'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const askQuestionSchema = z.object({
  participantId: z.guid().optional(),
  content: z.string().trim().min(3, 'The question is too short').max(600),
});

export const questionActionSchema = z.object({
  participantId: z.guid().optional(),
  action: z.enum(['vote', 'unvote', 'bump', 'dismiss']),
});

export const agentQuestionUpdateSchema = z.object({
  status: z.enum(QUESTION_STATUSES),
});

export interface SessionRow {
  id: string;
  status: string;
  host_user_id: string | null;
  settings: { qaModerators?: string[] } | null;
}

export interface MemberRow {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  role: string;
  kind?: string | null;
  left_at: string | null;
}

export interface QuestionRow {
  id: string;
  session_id: string;
  participant_id: string | null;
  display_name: string;
  content: string;
  status: QuestionStatus;
  bumped_at: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface QuestionView {
  id: string;
  participant_id: string | null;
  display_name: string;
  content: string;
  status: QuestionStatus;
  votes: number;
  voted: boolean;
  mine: boolean;
  bumped_at: string | null;
  answered_at: string | null;
  created_at: string;
}

export async function loadSession(
  db: ServiceClient,
  sessionId: string
): Promise<SessionRow | null> {
  const { data } = (await (db as any)
    .from('sessions')
    .select('id, status, host_user_id, settings')
    .eq('id', sessionId)
    .maybeSingle()) as { data: SessionRow | null };
  return data;
}

/** The caller's live participant row in this session, or null. */
export async function resolveMember(
  db: ServiceClient,
  sessionId: string,
  { participantId, userId }: { participantId?: string | undefined; userId?: string | null }
): Promise<MemberRow | null> {
  const base = () =>
    (db as any)
      .from('session_participants')
      .select('id, session_id, user_id, display_name, role, kind, left_at')
      .eq('session_id', sessionId)
      .is('left_at', null);
  if (participantId) {
    const { data } = (await base().eq('id', participantId).maybeSingle()) as {
      data: MemberRow | null;
    };
    if (!data) return null;
    if (data.user_id && data.user_id !== userId) return null;
    return data;
  }
  if (userId) {
    const { data } = (await base().eq('user_id', userId).maybeSingle()) as {
      data: MemberRow | null;
    };
    return data;
  }
  return null;
}

export function canModerate(session: SessionRow, member: MemberRow): boolean {
  if (member.role === 'host') return true;
  if (!member.user_id) return false;
  if (member.user_id === session.host_user_id) return true;
  return (session.settings?.qaModerators ?? []).includes(member.user_id);
}

/** Display order: now answering, then open (picked first, most votes, oldest), then answered. */
export function sortQuestions(list: QuestionView[]): QuestionView[] {
  const rank = (q: QuestionView) => (q.status === 'answering' ? 0 : q.status === 'open' ? 1 : 2);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.status === 'open') {
      if (Boolean(a.bumped_at) !== Boolean(b.bumped_at)) return a.bumped_at ? -1 : 1;
      if (a.bumped_at && b.bumped_at && a.bumped_at !== b.bumped_at)
        return a.bumped_at > b.bumped_at ? -1 : 1;
      if (a.votes !== b.votes) return b.votes - a.votes;
    }
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
}

/** Every question in the room except dismissed ones, with vote counts. */
export async function listQuestions(
  db: ServiceClient,
  sessionId: string,
  viewerId: string | null = null
): Promise<QuestionView[]> {
  const { data } = (await (db as any)
    .from('session_questions')
    .select(
      'id, session_id, participant_id, display_name, content, status, bumped_at, answered_at, created_at'
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(200)) as { data: QuestionRow[] | null };
  const rows = (data ?? []).filter((q) => q.status !== 'dismissed');
  const ids = rows.map((q) => q.id);
  const { data: votes } = ids.length
    ? ((await (db as any)
        .from('session_question_votes')
        .select('question_id, participant_id')
        .in('question_id', ids)) as {
        data: { question_id: string; participant_id: string }[] | null;
      })
    : { data: [] };
  const count = new Map<string, number>();
  const mineVoted = new Set<string>();
  for (const v of votes ?? []) {
    count.set(v.question_id, (count.get(v.question_id) ?? 0) + 1);
    if (viewerId && v.participant_id === viewerId) mineVoted.add(v.question_id);
  }
  return sortQuestions(
    rows.map((q) => ({
      id: q.id,
      participant_id: q.participant_id,
      display_name: q.display_name,
      content: q.content,
      status: q.status,
      votes: count.get(q.id) ?? 0,
      voted: mineVoted.has(q.id),
      mine: Boolean(viewerId) && q.participant_id === viewerId,
      bumped_at: q.bumped_at,
      answered_at: q.answered_at,
      created_at: q.created_at,
    }))
  );
}

/** Resolve a partner's moderator emails to user ids (service role only). */
export async function moderatorIdsFor(db: ServiceClient, emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const { data, error } = (await (db.rpc as any)('user_ids_by_email', { p_emails: emails })) as {
    data: { id: string }[] | null;
    error: unknown;
  };
  if (error || !data) return [];
  return data.map((r) => r.id);
}
