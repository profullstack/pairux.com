import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { PublicProfile, PublicRoom } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ username: string }>;
}

/**
 * GET /api/u/[username]
 *
 * Public profile card for a user plus their currently-published rooms.
 * Anon-readable — safe columns only (via get_public_profile + list_public_rooms RPCs).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data: profiles, error: profileError } = await (supabase.rpc as any)(
      'get_public_profile',
      { p_username: username }
    );

    if (profileError) {
      console.error('Get public profile error:', profileError);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(profileError.message, 400);
    }

    const profileRows = (profiles as PublicProfile[] | null) ?? [];
    const profile = profileRows[0];
    if (!profile) {
      return errorResponse('Profile not found', 404);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data: rooms, error: roomsError } = await (supabase.rpc as any)('list_public_rooms', {
      p_limit: 100,
      p_username: username,
    });

    if (roomsError) {
      console.error('List user public rooms error:', roomsError);
      return errorResponse((roomsError as { message?: string }).message ?? 'Failed', 400);
    }

    return successResponse({ profile, rooms: (rooms as PublicRoom[] | null) ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}
