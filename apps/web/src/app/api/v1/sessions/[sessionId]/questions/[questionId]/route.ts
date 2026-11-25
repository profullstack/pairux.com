/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import {
  canModerate,
  listQuestions,
  loadSession,
  questionActionSchema,
  resolveMember,
} from '@/lib/questions';

/**
 * POST /api/v1/sessions/:sessionId/questions/:questionId { action, participantId? }
 *   vote | unvote  anyone in the call (not on their own question)
 *   bump           a moderator: this question goes next
 *   dismiss        a moderator, or whoever asked it
 * -> the room's questions after the change.
 */
interface RouteParams {
  params: Promise<{ sessionId: string; questionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const p = await params;
    const sessionId = z.guid('Invalid session ID').parse(p.sessionId);
    const questionId = z.guid('Invalid question ID').parse(p.questionId);
    const input = questionActionSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const session = await loadSession(db, sessionId);
    if (!session) return errorResponse('Session not found', 404);
    let userId: string | null = null;
    try {
      userId = (await getAuthenticatedUser(await createClient())).user?.id ?? null;
    } catch {
      userId = null;
    }
    const member = await resolveMember(db, sessionId, {
      participantId: input.participantId,
      userId,
    });
    if (!member) return errorResponse('Join the call first', 403);
    const { data: question } = (await (db as any)
      .from('session_questions')
      .select('id, session_id, participant_id, status')
      .eq('id', questionId)
      .eq('session_id', sessionId)
      .maybeSingle()) as {
      data: { id: string; participant_id: string | null; status: string } | null;
    };
    if (!question) return errorResponse('Question not found', 404);

    const moderator = canModerate(session, member);
    if (input.action === 'vote' || input.action === 'unvote') {
      if (question.participant_id === member.id)
        return errorResponse('You cannot vote for your own question', 400);
      if (input.action === 'vote') {
        await (db as any).from('session_question_votes').upsert(
          {
            question_id: question.id,
            participant_id: member.id,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'question_id,participant_id', ignoreDuplicates: true }
        );
      } else {
        await (db as any)
          .from('session_question_votes')
          .delete()
          .eq('question_id', question.id)
          .eq('participant_id', member.id);
      }
    } else if (input.action === 'bump') {
      if (!moderator) return errorResponse('Only the host can pick the next question', 403);
      if (question.status !== 'open')
        return errorResponse('Only an open question can be picked', 409);
      await (db as any)
        .from('session_questions')
        .update({ bumped_at: new Date().toISOString() })
        .eq('id', question.id);
    } else {
      if (!moderator && question.participant_id !== member.id) {
        return errorResponse('Only the host or whoever asked can remove a question', 403);
      }
      await (db as any)
        .from('session_questions')
        .update({ status: 'dismissed' })
        .eq('id', question.id);
    }
    return successResponse({
      questions: await listQuestions(db, sessionId, member.id),
      canModerate: moderator,
      participantId: member.id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
