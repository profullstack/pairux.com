/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ username: string }>;
}

async function toggle(
  rpc: 'follow_creator' | 'unfollow_creator',
  username: string,
  following: boolean
) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthenticatedUser(supabase);
  if (authError || !user) {
    return errorResponse('Sign in to follow creators', 401);
  }
  const { data, error } = await (supabase.rpc as any)(rpc, { p_username: username });
  if (error) {
    return errorResponse(error.message, 400);
  }
  return successResponse({ following, follower_count: Number(data ?? 0) });
}

// POST /api/u/[username]/follow — follow the creator
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    return await toggle('follow_creator', username, true);
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/u/[username]/follow — unfollow
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    return await toggle('unfollow_creator', username, false);
  } catch (error) {
    return handleApiError(error);
  }
}
