import { errorResponse, successResponse } from '@/lib/api';
import { copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/copilot — the caller's copilots, newest first (history).
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to see your copilot notes.', 401);
    const runtime = runtimeOrThrow();
    return successResponse({ copilots: await runtime.store.list(user.id) });
  } catch (error) {
    return copilotError(error);
  }
}
