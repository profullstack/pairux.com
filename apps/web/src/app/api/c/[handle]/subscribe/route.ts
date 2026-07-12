/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ handle: string }>;
}

async function toggle(
  rpc: 'subscribe_channel' | 'unsubscribe_channel',
  handle: string,
  subscribed: boolean
) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthenticatedUser(supabase);
  if (authError || !user) return errorResponse('Sign in to subscribe', 401);
  const { data, error } = await (supabase.rpc as any)(rpc, { p_handle: handle });
  if (error) return errorResponse(error.message, 400);
  return successResponse({ subscribed, subscriber_count: Number(data ?? 0) });
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { handle } = await params;
    return await toggle('subscribe_channel', handle, true);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { handle } = await params;
    return await toggle('unsubscribe_channel', handle, false);
  } catch (error) {
    return handleApiError(error);
  }
}
