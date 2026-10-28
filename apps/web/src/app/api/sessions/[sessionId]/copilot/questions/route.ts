import { errorResponse, successResponse } from '@/lib/api';
import { body, callerAgent, copilotError, text } from '@/lib/copilot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/copilot/questions — mark an open question answered
// (or open again). Body: { participantId, id, answered }.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const { agent } = await callerAgent(request, sessionId, text(input.participantId, 64));
    if (!agent.setQuestion(text(input.id, 64), input.answered !== false))
      return errorResponse('No such question.', 404);
    return successResponse({ openQuestions: agent.state.openQuestions });
  } catch (error) {
    return copilotError(error);
  }
}
