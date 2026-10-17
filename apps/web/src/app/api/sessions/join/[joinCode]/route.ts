import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { guestJoinSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { ROOM_FULL_MESSAGE, isRoomFullError, recordCapRefusal, roomFullKind } from '@/lib/room-cap';

// Joining performs database work and can trigger a host notification. Bound it
// by source IP and room code so a shared public link cannot be used to fan out
// an unbounded burst of work.
const joinLookupsByIp = new FixedWindowRateLimiter(120, 60_000);
const joinAttemptsByIpAndCode = new FixedWindowRateLimiter(12, 60_000);

interface RouteParams {
  params: Promise<{ joinCode: string }>;
}

// GET /api/sessions/join/[joinCode] - Lookup session by join code
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { joinCode } = await params;
    const lookupLimit = joinLookupsByIp.check(getClientIp(request));
    if (!lookupLimit.success) {
      return errorResponse(
        `Too many lookup requests. Try again in ${String(lookupLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }
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

    // Seats as join_session counts them: participants (the host included) and
    // listeners, against the owner's plan right now.
    let participantCount = 1;
    let listenerCount = 0;
    try {
      const { data: usage } = (await serviceClient().rpc(
        'session_seat_usage' as never,
        {
          p_session_id: sessionData.id,
        } as never
      )) as {
        data: { participants: number; listeners: number }[] | null;
      };
      const row = usage?.[0];
      if (row) {
        participantCount = row.participants;
        listenerCount = row.listeners;
      }
    } catch (usageError) {
      console.warn('[Join] seat usage lookup failed', usageError);
    }

    return successResponse({
      ...sessionData,
      participant_count: participantCount,
      listener_count: listenerCount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/sessions/join/[joinCode] - Join a session
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { joinCode } = await params;
    const joinLimit = joinAttemptsByIpAndCode.check(
      `${getClientIp(request)}:${joinCode.toUpperCase()}`
    );
    if (!joinLimit.success) {
      return errorResponse(
        `Too many join attempts. Try again in ${String(joinLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }
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
    const joinSession = (): Promise<{ data: unknown; error: { message: string } | null }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      (supabase.rpc as any)('join_session', {
        p_join_code: joinCode.toUpperCase(),
        p_display_name: displayName,
      });
    const { data, error } = await joinSession();

    // The room has no seat of the joiner's kind left on the owner's plan
    // (join_session reads the plan live, so an upgrade counts at once). The
    // joiner is told politely and the host gets the upgrade prompt (see
    // lib/room-cap.ts).
    if (error && isRoomFullError(error.message)) {
      const kind = roomFullKind(error.message);
      try {
        const svc = serviceClient();
        const { data: room } = (await svc
          .from('sessions')
          .select('id')
          .eq('join_code', joinCode.toUpperCase())
          .neq('status', 'ended')
          .maybeSingle()) as { data: { id: string } | null };
        if (room) await recordCapRefusal(svc, room.id, kind);
      } catch (capError) {
        // Never let the upgrade bookkeeping turn a "room full" into a 500.
        console.warn('[Join] room-full handling failed', capError);
      }
      return errorResponse(ROOM_FULL_MESSAGE, 403);
    }

    if (error) {
      console.error('Join session error:', error);
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
