/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const BUCKET = 'room-banners';

/**
 * POST /api/sessions/[sessionId]/banner
 *
 * Upload the room's /live banner (multipart form-data, field "banner"). The
 * desktop publish modal cover-crops the image to 16:9 before sending. Host-only;
 * stored in the public room-banners bucket and saved to sessions.banner_url.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Only the room's creator/host may set the banner.
    const { data: session } = (await supabase
      .from('sessions')
      .select('id, creator_id, host_user_id, current_host_id')
      .eq('id', sessionId)
      .single()) as {
      data: {
        creator_id: string | null;
        host_user_id: string;
        current_host_id: string | null;
      } | null;
    };
    if (!session) return errorResponse('Room not found', 404);
    const isHost =
      session.creator_id === user.id ||
      session.host_user_id === user.id ||
      session.current_host_id === user.id;
    if (!isHost) return errorResponse('You are not the host of this room', 403);

    const form = await request.formData();
    const file = form.get('banner');
    if (!(file instanceof File)) {
      return errorResponse('Missing banner file', 400);
    }
    if (!file.type.startsWith('image/')) {
      return errorResponse('Banner must be an image', 400);
    }
    if (file.size > MAX_BYTES) {
      return errorResponse('Banner is too large (max 5 MB)', 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = serviceClient() as any;
    const path = `${sessionId}.jpg`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (uploadError) {
      console.error('[banner] upload failed:', uploadError);
      return errorResponse('Failed to store banner', 502);
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);
    // Cache-bust so a replaced banner shows immediately.
    const bannerUrl = `${String(publicUrl)}?v=${String(Date.now())}`;

    const { error: updateError } = await admin
      .from('sessions')
      .update({ banner_url: bannerUrl })
      .eq('id', sessionId);
    if (updateError) {
      console.error('[banner] update failed:', updateError);
      return errorResponse('Failed to save banner', 500);
    }

    return successResponse({ banner_url: bannerUrl });
  } catch (error) {
    return handleApiError(error);
  }
}
