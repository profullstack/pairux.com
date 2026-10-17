import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { serviceClient } from '@/lib/supabase/service';

/** Seats in use and the owner's caps right now (session_seat_usage). */
export interface RoomCapacity {
  plan: 'free' | 'plus' | 'pro' | 'team';
  participant_cap: number;
  listener_cap: number;
  participants: number;
  listeners: number;
}

/**
 * The room's capacity, for its owner only (it names their plan). The host's
 * upgrade prompt polls this; null for anyone else or on any failure.
 */
async function capacityFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  hostUserId: string | undefined
): Promise<RoomCapacity | null> {
  try {
    const { user } = await getAuthenticatedUser(supabase);
    if (!user || !hostUserId || user.id !== hostUserId) return null;
    const { data } = (await serviceClient().rpc(
      'session_seat_usage' as never,
      {
        p_session_id: sessionId,
      } as never
    )) as { data: RoomCapacity[] | null };
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

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

    const capacity = await capacityFor(
      supabase,
      sessionId,
      (data as { host_user_id?: string }).host_user_id
    );
    return successResponse(capacity ? { ...(data as object), capacity } : data);
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

    // Host left → stop any server-side recording + external restream for this
    // session (the egress also self-stops when the room empties; best-effort).
    void import('@/lib/livekit-recording').then(({ stopSessionRecording }) =>
      stopSessionRecording(sessionId)
    );
    void import('@/lib/channel-restream').then(({ stopChannelRestream }) =>
      stopChannelRestream(sessionId)
    );
    // The call is over: hand any AI analysis capture to the report job.
    // Best-effort: the report job also picks up captures whose uploads stopped.
    void import('@/lib/call-analysis/store')
      .then(({ queueSessionAnalyses }) => queueSessionAnalyses(sessionId))
      .catch((error: unknown) => {
        console.error('[call-analysis] could not queue analyses for session end:', error);
      });

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
