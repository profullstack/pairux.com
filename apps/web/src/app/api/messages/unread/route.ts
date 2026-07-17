/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, handleApiError } from '@/lib/api';

// GET /api/messages/unread — total unread DM count for the header badge.
// Returns 0 (not 401) for signed-out users so the badge poll stays quiet.
export async function GET() {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return successResponse({ unread: 0 });

    const { data, error } = await (supabase.rpc as any)('get_dm_unread_count');
    if (error) return successResponse({ unread: 0 });

    return successResponse({ unread: Number(data ?? 0) });
  } catch (error) {
    return handleApiError(error);
  }
}
