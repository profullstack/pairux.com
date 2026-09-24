/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { normalizeWebsiteUrl } from '@/lib/channel-website';

interface RouteParams {
  params: Promise<{ channelId: string }>;
}

const Body = z.object({
  name: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  avatar_url: z.string().url().max(600).optional(),
  banner_url: z.string().url().max(600).optional(),
  // Free text from the owner; normalized below. '' (or null) clears it.
  website_url: z.string().max(2048).nullable().optional(),
});

// PATCH /api/channels/[channelId] — update editable fields (owner only)
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const body = Body.parse(await request.json());

    // undefined = leave unchanged (null to the RPC); '' tells the RPC to clear.
    let website: string | null = null;
    if (body.website_url !== undefined) {
      const normalized = normalizeWebsiteUrl(body.website_url);
      if (!normalized.ok) return errorResponse(normalized.error, 400);
      website = normalized.url ?? '';
    }

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { error } = await (supabase.rpc as any)('update_channel', {
      p_channel_id: channelId,
      p_name: body.name ?? null,
      p_description: body.description ?? null,
      p_avatar_url: body.avatar_url ?? null,
      p_banner_url: body.banner_url ?? null,
      p_website_url: website,
    });
    if (error) {
      // update_channel only touches rows where owner_id = auth.uid().
      if (/not yours/i.test(error.message)) {
        return errorResponse('Only the channel owner can change this channel', 403);
      }
      return errorResponse(error.message, 400);
    }
    return successResponse({ ok: true, website_url: website === '' ? null : website });
  } catch (error) {
    return handleApiError(error);
  }
}
