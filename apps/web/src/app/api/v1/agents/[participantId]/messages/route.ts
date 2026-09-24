import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { agentMessageSchema } from '@/lib/agents';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

interface RouteParams {
  params: Promise<{ participantId: string }>;
}

// Same allowance as a person in chat: an agent must not be able to drown the room.
const messagesByAgent = new FixedWindowRateLimiter(10, 60_000);

/**
 * POST /api/v1/agents/[participantId]/messages — the agent says something in
 * the session's public chat. Body: { content } (max 500 chars).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const participantId = z
      .string()
      .uuid()
      .parse((await params).participantId);
    const { content } = agentMessageSchema.parse(await request.json().catch(() => ({})));

    if (!messagesByAgent.check(participantId).success) {
      return errorResponse('Rate limit exceeded. Please wait before sending more messages.', 429);
    }

    const db = serviceClient();
    const { data: agent } = (await db
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

    // The service role has no auth.uid(), so send_chat_message takes its
    // guest branch and checks this participant row is live in the session.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (db.rpc as any)('send_chat_message', {
      p_session_id: agent.session_id,
      p_content: content,
      p_participant_id: agent.id,
      p_recipient_id: null,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // Speaking counts as being present, same as polling.
    await db
      .from('session_participants')
      .update({ last_seen_at: new Date().toISOString(), connection_status: 'connected' } as never)
      .eq('id', agent.id);

    return successResponse(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
