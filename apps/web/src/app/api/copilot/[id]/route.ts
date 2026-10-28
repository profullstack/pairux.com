import { errorResponse, successResponse } from '@/lib/api';
import { copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/copilot/:id — one copilot's notes, transcript, follow-ups and review.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return errorResponse('Not found', 404);
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to see your copilot notes.', 401);
    const runtime = runtimeOrThrow();
    const stored = await runtime.store.get(id, user.id);
    if (!stored) return errorResponse('Not found', 404);
    // A live one is read from memory: the database copy lags up to 30 s.
    const live = runtime.get(stored.state.sessionId, user.id);
    return successResponse({ copilot: live?.state ?? stored.state, title: stored.title });
  } catch (error) {
    return copilotError(error);
  }
}
