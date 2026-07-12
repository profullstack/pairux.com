import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ channelId: string; destId: string }>;
}

// DELETE — remove a restream destination.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { channelId, destId } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('delete_channel_restream_destination', {
      p_channel_id: channelId,
      p_id: destId,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
