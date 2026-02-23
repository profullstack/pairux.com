import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string; participantId: string }>;
}

// PATCH /api/sessions/[sessionId]/participants/[participantId]/host - Transfer host role
export async function PATCH(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId, participantId } = await params;
    const supabase = await createClient();

    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    interface RpcResult {
      data: unknown;
      error: { message?: string } | null;
    }

    // transfer_host validates that caller is current host or creator and target is active/authenticated
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: 'transfer_host',
        args: { p_session_id: string; p_new_host_participant_id: string }
      ) => Promise<RpcResult>
    )('transfer_host', {
      p_session_id: sessionId,
      p_new_host_participant_id: participantId,
    });

    if (error) {
      console.error('Transfer host error:', error);
      const message = typeof error.message === 'string' ? error.message : 'Failed to transfer host';
      return errorResponse(message, 400);
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
