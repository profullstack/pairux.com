import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
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
        // No live session — check if this is a scheduled (pending) meeting
        const svc = serviceClient();
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
        const { data: scheduled } = await (svc as any)
          .from('scheduled_sessions')
          .select(
            'id, join_code, title, description, scheduled_at, duration_minutes, status, scheduled_session_invitees(name, rsvp_status)'
          )
          .eq('join_code', joinCode.toUpperCase())
          .eq('status', 'pending')
          .single();

        if (!scheduled) {
          return errorResponse('Session not found or has ended', 404);
        }

        const invitees: { name: string | null; rsvp_status: string }[] = Array.isArray(
          scheduled.scheduled_session_invitees
        )
          ? (scheduled.scheduled_session_invitees as any[]).map((i: any) => ({
              name: (i.name as string | null) ?? null,
              rsvp_status: i.rsvp_status as string,
            }))
          : [];

        return successResponse({
          scheduled: true,
          id: scheduled.id as string,
          join_code: scheduled.join_code as string,
          title: scheduled.title as string,
          description: (scheduled.description as string | null) ?? null,
          scheduled_at: scheduled.scheduled_at as string,
          duration_minutes: scheduled.duration_minutes as number,
          invitees,
        });
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
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

    // Joining your own session — typically from a phone to drive the machine
    // that is presenting — should not require requesting control from yourself
    // and walking back to the laptop to approve it. The owner arrives with
    // control already granted.
    //
    // This is a second participant row for the same user; the host's own row
    // stays role 'host' and is what the desktop excludes when deciding whose
    // input to inject.
    if (data) {
      const joined = data as { id?: string; session_id?: string; user_id?: string | null };
      if (joined.id && joined.user_id) {
        try {
          const { data: owned } = (await supabase
            .from('sessions')
            .select('host_user_id, current_host_id')
            .eq('id', joined.session_id ?? '')
            .single()) as {
            data: { host_user_id: string | null; current_host_id: string | null } | null;
          };

          const isOwner =
            owned?.host_user_id === joined.user_id || owned?.current_host_id === joined.user_id;

          if (isOwner) {
            // Supabase's generated types infer `never` for update payloads in
            // this route context; describe just the shape we use.
            const participants = supabase.from('session_participants') as unknown as {
              update: (value: { control_state: string }) => {
                eq: (column: string, value: string) => Promise<unknown>;
              };
            };
            await participants.update({ control_state: 'granted' }).eq('id', joined.id);
          }
        } catch (grantError) {
          // Never fail a join over this: the owner can still request control.
          console.warn('[Join] Could not auto-grant control to the owner', grantError);
        }
      }
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
