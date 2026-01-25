import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { ControlState } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ sessionId: string; participantId: string }>;
}

interface UpdateControlBody {
  control_state: ControlState;
}

// PATCH /api/sessions/[sessionId]/participants/[participantId]/control - Update control state
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { sessionId, participantId } = await params;
    const body = (await request.json()) as UpdateControlBody;
    const { control_state } = body;

    // Validate control state
    const validStates: ControlState[] = ['view-only', 'requested', 'granted'];
    if (!validStates.includes(control_state)) {
      return errorResponse('Invalid control state', 400);
    }

    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Use RPC function to update control state (handles host verification internally)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data: updatedParticipant, error: updateError } = await (supabase.rpc as any)(
      'update_control_state',
      {
        p_session_id: sessionId,
        p_participant_id: participantId,
        p_control_state: control_state,
      }
    );

    if (updateError) {
      console.error('Update control state error:', updateError);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(updateError.message ?? 'Failed to update control state', 400);
    }

    return successResponse(updatedParticipant);
  } catch (error) {
    return handleApiError(error);
  }
}
