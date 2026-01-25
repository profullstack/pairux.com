import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { Session, SessionParticipant } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ sessionId: string; participantId: string }>;
}

// DELETE /api/sessions/[sessionId]/participants/[participantId] - Kick a participant
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId, participantId } = await params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Verify user is the session host
    const { data: session, error: sessionError } = (await supabase
      .from('sessions')
      .select('host_user_id, current_host_id')
      .eq('id', sessionId)
      .single()) as {
      data: Pick<Session, 'host_user_id' | 'current_host_id'> | null;
      error: unknown;
    };

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    const isHost = session.host_user_id === user.id || session.current_host_id === user.id;
    if (!isHost) {
      return errorResponse('Only the host can remove participants', 403);
    }

    // Verify participant exists and belongs to this session
    const { data: participant, error: participantError } = (await supabase
      .from('session_participants')
      .select('id, role')
      .eq('id', participantId)
      .eq('session_id', sessionId)
      .is('left_at', null)
      .single()) as { data: Pick<SessionParticipant, 'id' | 'role'> | null; error: unknown };

    if (participantError || !participant) {
      return errorResponse('Participant not found', 404);
    }

    // Cannot kick the host
    if (participant.role === 'host') {
      return errorResponse('Cannot remove the host', 400);
    }

    // Mark participant as left using raw SQL via RPC
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase.rpc as any)('kick_participant', {
      p_session_id: sessionId,
      p_participant_id: participantId,
    });

    if (updateError) {
      console.error('Kick participant error:', updateError);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(updateError.message ?? 'Failed to remove participant', 400);
    }

    return successResponse({ success: true, participantId });
  } catch (error) {
    return handleApiError(error);
  }
}
