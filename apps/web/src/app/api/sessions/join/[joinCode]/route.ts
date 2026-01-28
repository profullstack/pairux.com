import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { guestJoinSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ joinCode: string }>;
}

// GET /api/sessions/join/[joinCode] - Lookup session by join code
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { joinCode } = await params;
    const supabase = await createClient();

    // Lookup session by join code
    const { data, error } = await supabase
      .from('sessions')
      .select('id, join_code, status, settings, created_at')
      .eq('join_code', joinCode.toUpperCase())
      .neq('status', 'ended')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errorResponse('Session not found or has ended', 404);
      }
      console.error('Lookup session error:', error);
      return errorResponse(error.message, 400);
    }

    // Type assertion for data since TypeScript can't infer it correctly
    const sessionData = data as {
      id: string;
      join_code: string;
      status: string;
      settings: unknown;
      created_at: string;
    };

    // Get participant count
    const { count } = await supabase
      .from('session_participants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionData.id)
      .is('left_at', null);

    return successResponse({
      ...sessionData,
      participant_count: count ?? 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/sessions/join/[joinCode] - Join a session
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { joinCode } = await params;
    const body = (await request.json().catch(() => ({}))) as { displayName?: string };

    const supabase = await createClient();

    // Check if user is authenticated (supports both cookie and Bearer token)
    const { user } = await getAuthenticatedUser(supabase);

    // If not authenticated, require display name
    let displayName: string | undefined;
    if (!user) {
      const parsed = guestJoinSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse('Display name is required for guests', 400);
      }
      displayName = parsed.data.displayName;
    } else {
      // Authenticated user can optionally provide display name
      displayName = body.displayName ?? undefined;
    }

    // Join session using RPC function
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('join_session', {
      p_join_code: joinCode.toUpperCase(),
      p_display_name: displayName,
    });

    if (error) {
      console.error('Join session error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // Notify host that a participant joined (non-blocking)
    if (data) {
      const participant = data as {
        display_name?: string;
        session_id?: string;
      };
      const participantSessionId = participant.session_id;
      if (participantSessionId) {
        void import('@/lib/push')
          .then(async ({ sendPushToUser }) => {
            const { data: session } = await supabase
              .from('sessions')
              .select('host_user_id')
              .eq('id', participantSessionId)
              .single();

            const hostId = (session as { host_user_id?: string } | null)?.host_user_id;
            if (hostId) {
              void sendPushToUser(hostId, 'participantJoined', {
                title: 'Participant Joined',
                body: `${participant.display_name ?? 'Someone'} joined your session`,
                url: `/session/${participantSessionId}`,
                tag: `join-${participantSessionId}`,
              });
            }
          })
          .catch(() => {
            // Non-critical: push notification failed silently
          });
      }
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
