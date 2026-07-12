/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const Body = z.object({ channelId: z.string().uuid() });

// PATCH /api/sessions/[sessionId]/channel — assign the live to one of my channels
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const { channelId } = Body.parse(await request.json());

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { error } = await (supabase.rpc as any)('set_session_channel', {
      p_session_id: sessionId,
      p_channel_id: channelId,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
