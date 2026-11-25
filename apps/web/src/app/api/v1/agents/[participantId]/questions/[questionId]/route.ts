/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { agentQuestionUpdateSchema } from '@/lib/questions';

/**
 * PATCH /api/v1/agents/:participantId/questions/:questionId { status }
 *
 * An agent in the room moves a Q&A question along: "answering" shows it as
 * "now answering" in everyone's panel, "answered" marks it done, "open" puts it
 * back in the queue, "dismissed" removes it. The question must be in the
 * agent's own session.
 */
interface RouteParams {
  params: Promise<{ participantId: string; questionId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const p = await params;
    const participantId = z.guid('Invalid participant ID').parse(p.participantId);
    const questionId = z.guid('Invalid question ID').parse(p.questionId);
    const { status } = agentQuestionUpdateSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const { data: agent } = (await (db as any)
      .from('session_participants')
      .select('id, session_id, left_at')
      .eq('id', participantId)
      .eq('kind', 'agent')
      .maybeSingle()) as {
      data: { id: string; session_id: string; left_at: string | null } | null;
    };
    if (!agent) return errorResponse('Agent not found', 404);
    if (agent.left_at)
      return errorResponse('This agent has left or was removed from the session', 410);
    const { data: question } = (await (db as any)
      .from('session_questions')
      .select('id, session_id')
      .eq('id', questionId)
      .eq('session_id', agent.session_id)
      .maybeSingle()) as { data: { id: string } | null };
    if (!question) return errorResponse('Question not found in this session', 404);
    const patch: Record<string, unknown> = { status };
    if (status === 'answered') patch.answered_at = new Date().toISOString();
    await (db as any).from('session_questions').update(patch).eq('id', question.id);
    return successResponse({ id: question.id, status });
  } catch (error) {
    return handleApiError(error);
  }
}
