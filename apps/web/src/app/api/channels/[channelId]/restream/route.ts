/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ channelId: string }>;
}

interface UpsertBody {
  id?: string;
  platform?: string;
  label?: string;
  rtmpUrl?: string;
  streamKey?: string;
  enabled?: boolean;
}

// GET — list a channel's restream destinations (never returns stream keys).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { data, error } = await (supabase.rpc as any)('list_channel_restream_destinations', {
      p_channel_id: channelId,
    });
    if (error) {
      return errorResponse(error.message, 400);
    }
    return successResponse({ destinations: data });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST — add (no id) or update a destination.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const body = (await request.json().catch(() => ({}))) as UpsertBody;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { data, error } = await (supabase.rpc as any)('upsert_channel_restream_destination', {
      p_channel_id: channelId,
      p_id: body.id ?? null,
      p_platform: body.platform ?? 'custom',
      p_label: body.label ?? null,
      p_rtmp_url: body.rtmpUrl ?? '',
      p_stream_key: body.streamKey ?? null,
      p_enabled: body.enabled ?? true,
    });
    if (error) {
      return errorResponse(error.message, 400);
    }
    return successResponse({ id: data });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH — toggle the channel's restream master switch. Body: { enabled }.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { channelId } = await params;
    const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { error } = await (supabase.rpc as any)('set_channel_restream_enabled', {
      p_channel_id: channelId,
      p_enabled: Boolean(body.enabled),
    });
    if (error) {
      return errorResponse(error.message, 400);
    }
    return successResponse({ enabled: Boolean(body.enabled) });
  } catch (error) {
    return handleApiError(error);
  }
}
