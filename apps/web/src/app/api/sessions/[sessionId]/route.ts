import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/sessions/[sessionId] - Get session details
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();

    // Get session with participants
    const { data, error } = await supabase
      .from('sessions')
      .select('*, session_participants(*)')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errorResponse('Session not found', 404);
      }
      console.error('Get session error:', error);
      return errorResponse(error.message, 400);
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/sessions/[sessionId] - Host leaves session (room stays alive)
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();

    // Check authentication (supports both cookie and Bearer token)
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Host leaves session — room persists for viewers to keep chatting
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('host_leave_session', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('Leave session error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
