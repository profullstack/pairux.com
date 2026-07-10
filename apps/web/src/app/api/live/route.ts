import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

/**
 * GET /api/live
 *
 * Public directory of rooms that hosts have explicitly published to /live.
 * Anon-readable — returns safe columns only (via the list_public_rooms RPC).
 * Query: ?limit=<1..100>
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_public_rooms', {
      p_limit: limit,
      p_username: null,
      // The live directory shows only rooms with a host connected right now.
      p_live_only: true,
    });

    if (error) {
      console.error('List public rooms error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse(data ?? []);
  } catch (error) {
    return handleApiError(error);
  }
}
