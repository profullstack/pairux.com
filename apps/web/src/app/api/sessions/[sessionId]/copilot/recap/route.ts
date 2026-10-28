import { errorResponse, successResponse } from '@/lib/api';
import { body, callerAgent, copilotError, text } from '@/lib/copilot/http';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const recapsByUser = new FixedWindowRateLimiter(30, 60_000);

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/copilot/recap — "zoned out?": what was said in the
// last `seconds` (default 30, at most 300). Body: { participantId, seconds }.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const seconds = Math.min(300, Math.max(10, Number(input.seconds) || 30));
    const { agent, caller } = await callerAgent(request, sessionId, text(input.participantId, 64));
    if (!recapsByUser.check(caller.userId).success)
      return errorResponse('Too many recaps. Wait a moment.', 429);
    return successResponse({ recap: await agent.recap(seconds), seconds });
  } catch (error) {
    return copilotError(error);
  }
}
