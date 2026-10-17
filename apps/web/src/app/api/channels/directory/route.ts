import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

/**
 * GET /api/channels/directory
 *
 * The public channel directory as JSON: the same anon-readable list /channels
 * renders (via the list_all_channels RPC, safe columns only), so other sites
 * such as pit.world can show PairUX channels. Live channels come first.
 * Query: ?limit=<1..100>
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 60, 1), 100) : 60;

    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_all_channels', { p_limit: limit });

    if (error) {
      console.error('List all channels error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    const response = successResponse(data ?? []);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=60');
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
