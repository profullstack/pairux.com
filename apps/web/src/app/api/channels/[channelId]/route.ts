/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ channelId: string }>;
}

const Body = z.object({
  name: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  avatar_url: z.string().url().max(600).optional(),
  banner_url: z.string().url().max(600).optional(),
});

// PATCH /api/channels/[channelId] — update editable fields (owner only)
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const body = Body.parse(await request.json());

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { error } = await (supabase.rpc as any)('update_channel', {
      p_channel_id: channelId,
      p_name: body.name ?? null,
      p_description: body.description ?? null,
      p_avatar_url: body.avatar_url ?? null,
      p_banner_url: body.banner_url ?? null,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
