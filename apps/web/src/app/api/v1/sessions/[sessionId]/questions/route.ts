/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import {
  askQuestionSchema,
  canModerate,
  listQuestions,
  loadSession,
  resolveMember,
} from '@/lib/questions';

/**
 * Room Q&A (see lib/questions.ts).
 *
 *   GET  /api/v1/sessions/:sessionId/questions?participantId=<guest participant id>
 *        -> { questions: [...], canModerate, participantId }
 *   POST /api/v1/sessions/:sessionId/questions { content, participantId? } -> 201 question
 */
interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const idSchema = z.guid('Invalid session ID');
const askLimiter = new FixedWindowRateLimiter(6, 60_000);

async function currentUserId(): Promise<string | null> {
  try {
    const { user } = await getAuthenticatedUser(await createClient());
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const sessionId = idSchema.parse((await params).sessionId);
    const participantId = new URL(request.url).searchParams.get('participantId') ?? undefined;
    const db = serviceClient();
    const session = await loadSession(db, sessionId);
    if (!session) return errorResponse('Session not found', 404);
    const member = await resolveMember(db, sessionId, {
      participantId: participantId ? z.guid().parse(participantId) : undefined,
      userId: await currentUserId(),
    });
    if (!member) return errorResponse('Join the call to see its questions', 403);
    return successResponse({
      questions: await listQuestions(db, sessionId, member.id),
      canModerate: canModerate(session, member),
      participantId: member.id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const sessionId = idSchema.parse((await params).sessionId);
    const input = askQuestionSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const session = await loadSession(db, sessionId);
    if (!session) return errorResponse('Session not found', 404);
    if (session.status === 'ended') return errorResponse('The session has ended', 410);
    const member = await resolveMember(db, sessionId, {
      participantId: input.participantId,
      userId: await currentUserId(),
    });
    if (!member) return errorResponse('Join the call to ask a question', 403);
    if (!askLimiter.check(member.id).success) {
      return errorResponse('Too many questions this minute', 429);
    }
    const { data, error } = (await (db as any)
      .from('session_questions')
      .insert({
        session_id: sessionId,
        participant_id: member.id,
        display_name: member.display_name.slice(0, 60),
        content: input.content,
        status: 'open',
        created_at: new Date().toISOString(),
      })
      .select(
        'id, participant_id, display_name, content, status, bumped_at, answered_at, created_at'
      )
      .single()) as { data: Record<string, unknown> | null; error: { message?: string } | null };
    if (error || !data) return errorResponse(error?.message ?? 'Could not save the question', 500);
    return successResponse({ ...data, votes: 0, voted: false, mine: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
