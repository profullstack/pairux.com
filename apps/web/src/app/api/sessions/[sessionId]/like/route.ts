/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

async function toggle(rpc: 'like_session' | 'unlike_session', sessionId: string, liked: boolean) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthenticatedUser(supabase);
  if (authError || !user) return errorResponse('Sign in to like', 401);
  const { data, error } = await (supabase.rpc as any)(rpc, { p_session_id: sessionId });
  if (error) return errorResponse(error.message, 400);
  return successResponse({ liked, like_count: Number(data ?? 0) });
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    return await toggle('like_session', sessionId, true);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    return await toggle('unlike_session', sessionId, false);
  } catch (error) {
    return handleApiError(error);
  }
}
