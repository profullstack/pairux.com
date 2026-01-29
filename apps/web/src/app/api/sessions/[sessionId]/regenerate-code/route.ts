import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/[sessionId]/regenerate-code - Generate new join code
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();

    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('regenerate_join_code', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('Regenerate join code error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
