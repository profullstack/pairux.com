import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// Types for database rows (not yet in generated Supabase types)
interface ParticipantRow {
  id: string;
  display_name: string;
  role: string;
  control_state: string;
  joined_at: string;
  left_at: string | null;
  session_id: string;
}

interface SessionRow {
  id: string;
  join_code: string;
  status: string;
  mode: string;
  settings: Record<string, unknown>;
  created_at: string;
  session_participants: ParticipantRow[];
}

// GET /api/sessions/[sessionId]/guest?p=participantId - Get session for guest viewer
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const url = new URL(request.url);
    const participantId = url.searchParams.get('p');

    if (!participantId) {
      return errorResponse('Participant ID required', 400);
    }

    const supabase = await createClient();

    // Validate participant exists and belongs to this session
    const { data: participant, error: participantError } = (await supabase
      .from('session_participants')
      .select('id, display_name, role, control_state, joined_at, left_at, session_id')
      .eq('id', participantId)
      .eq('session_id', sessionId)
      .single()) as { data: ParticipantRow | null; error: unknown };

    if (participantError || !participant) {
      return errorResponse('Invalid participant or session', 403);
    }

    // Check participant hasn't left
    if (participant.left_at) {
      return errorResponse('You have left this session', 403);
    }

    // Get session details
    const { data: session, error: sessionError } = (await supabase
      .from('sessions')
      .select(
        `
        id,
        join_code,
        status,
        mode,
        settings,
        created_at,
        session_participants (
          id,
          display_name,
          role,
          control_state,
          joined_at,
          left_at
        )
      `
      )
      .eq('id', sessionId)
      .neq('status', 'ended')
      .single()) as { data: SessionRow | null; error: unknown };

    if (sessionError || !session) {
      return errorResponse('Session not found or has ended', 404);
    }

    // Filter to only active participants
    const activeParticipants = session.session_participants.filter((p) => !p.left_at);

    return successResponse({
      session: {
        id: session.id,
        join_code: session.join_code,
        status: session.status,
        mode: session.mode,
        settings: session.settings,
        created_at: session.created_at,
        session_participants: activeParticipants,
      },
      participant: {
        id: participant.id,
        display_name: participant.display_name,
        role: participant.role,
        control_state: participant.control_state,
        joined_at: participant.joined_at,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
