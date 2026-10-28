import { errorResponse, successResponse } from '@/lib/api';
import { writeFollowUps, writeReview } from '@/lib/copilot/agent';
import { copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { requestUser } from '@/lib/request-user';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const writesByUser = new FixedWindowRateLimiter(20, 60_000);

interface RouteParams {
  params: Promise<{ id: string; action: string }>;
}

// POST /api/copilot/:id/follow-ups | /api/copilot/:id/review — write (or
// rewrite) the follow-ups or the conversation review from what was heard.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, action } = await params;
    if (!UUID.test(id) || (action !== 'follow-ups' && action !== 'review'))
      return errorResponse('Not found', 404);
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in first.', 401);
    if (!writesByUser.check(user.id).success)
      return errorResponse('Too many requests. Wait a moment.', 429);
    const runtime = runtimeOrThrow();
    const stored = await runtime.store.get(id, user.id);
    if (!stored) return errorResponse('Not found', 404);
    if (!(await runtime.accounts.eligible(user.id)))
      return errorResponse('The AI copilot is part of PairUX Pro.', 403);
    const live = runtime.get(stored.state.sessionId, user.id);
    const state = live?.state ?? stored.state;
    const ctx = await runtime.context(state.sessionId, user.id, state.mode);
    if (action === 'follow-ups') {
      state.followUps = await writeFollowUps(runtime.llm, ctx, state, stored.participantId);
      if (!state.followUps) return errorResponse('Nothing was heard to follow up on.', 400);
    } else {
      state.review = await writeReview(runtime.llm, ctx, state, stored.participantId);
    }
    await runtime.store.save(state);
    return successResponse({ followUps: state.followUps, review: state.review });
  } catch (error) {
    return copilotError(error);
  }
}
