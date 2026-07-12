/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ channelId: string }>;
}

const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = 'room-banners';

// POST /api/channels/[channelId]/image?kind=banner|avatar
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const kind = new URL(request.url).searchParams.get('kind') === 'avatar' ? 'avatar' : 'banner';

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    // RLS lets an owner select their own channel; null => not owner.
    const { data: owned } = (await supabase
      .from('channels')
      .select('id')
      .eq('id', channelId)
      .single()) as { data: { id: string } | null };
    if (!owned) return errorResponse('Channel not found or not yours', 403);

    const form = await request.formData();
    const file = form.get('image');
    if (!(file instanceof File)) return errorResponse('Missing image', 400);
    if (!file.type.startsWith('image/')) return errorResponse('Must be an image', 400);
    if (file.size > MAX_BYTES) return errorResponse('Image too large (max 5 MB)', 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = serviceClient() as any;
    const path = `channels/${channelId}/${kind}.jpg`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (uploadError) return errorResponse('Failed to store image', 502);

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);
    const url = `${String(publicUrl)}?v=${String(Date.now())}`;

    const { error: rpcError } = await (supabase.rpc as any)('update_channel', {
      p_channel_id: channelId,
      p_name: null,
      p_description: null,
      p_avatar_url: kind === 'avatar' ? url : null,
      p_banner_url: kind === 'banner' ? url : null,
    });
    if (rpcError) return errorResponse(rpcError.message, 400);

    return successResponse({ url, kind });
  } catch (error) {
    return handleApiError(error);
  }
}
