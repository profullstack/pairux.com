import { errorResponse, successResponse } from '@/lib/api';
import { body, callerAgent, copilotError, text } from '@/lib/copilot/http';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const asksByUser = new FixedWindowRateLimiter(30, 60_000);

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/copilot/ask — message the copilot privately.
// Body: { participantId, question }. Answers { answer }.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const question = text(input.question, 2000);
    if (!question) return errorResponse('Ask the copilot something.', 400);
    const { agent, caller } = await callerAgent(request, sessionId, text(input.participantId, 64));
    if (!asksByUser.check(caller.userId).success)
      return errorResponse('Too many questions. Wait a moment.', 429);
    return successResponse({ answer: await agent.ask(question) });
  } catch (error) {
    return copilotError(error);
  }
}
