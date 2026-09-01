import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { ControlState } from '@pairux/shared-types';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import type { Database, Session } from '@pairux/shared-types';
import { DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk';

interface RouteParams {
  params: Promise<{ sessionId: string; participantId: string }>;
}

interface UpdateControlBody {
  control_state: ControlState;
}

type ControlSignalState = Extract<ControlState, 'granted' | 'view-only'>;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase service role configuration');
  }
  return createSupabaseAdminClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeLiveKitServiceUrl(url: string): string {
  if (url.startsWith('wss://')) return `https://${url.slice('wss://'.length)}`;
  if (url.startsWith('ws://')) return `http://${url.slice('ws://'.length)}`;
  return url;
}

/**
 * Find the LiveKit identity belonging to a `session_participants` row.
 *
 * A participant row id is not a LiveKit identity, and the two have never
 * matched: the desktop client joins as the auth user id and the web client as a
 * freshly generated UUID. Addressing a data packet to the row id therefore
 * reached nobody at all, in either client — the signal below has been silently
 * dropped since it was written.
 *
 * What every client does carry is the `userId` its token embeds in metadata, so
 * that is what the row is matched against. Identity is still checked directly
 * first, so a client that ever does join under the row id keeps working.
 */
async function resolveLiveKitIdentity(
  roomService: RoomServiceClient,
  roomName: string,
  participantId: string,
  targetUserId: string | null
): Promise<string | null> {
  const participants = await roomService.listParticipants(roomName);

  for (const participant of participants) {
    if (participant.identity === participantId) return participant.identity;
  }

  if (targetUserId === null) return null;

  for (const participant of participants) {
    try {
      const meta = JSON.parse(participant.metadata || '{}') as { userId?: string | null };
      if (meta.userId === targetUserId) return participant.identity;
    } catch {
      // Metadata is client-supplied; a malformed blob is not a reason to fail.
    }
  }

  return null;
}

async function sendLiveKitControlSignal(
  sessionId: string,
  participantId: string,
  targetUserId: string | null,
  controlState: ControlSignalState
): Promise<void> {
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const livekitApiKey = process.env.LIVEKIT_API_KEY;
  const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    console.warn('[ControlAPI] LiveKit control signal skipped (missing config)', {
      sessionId,
      participantId,
      controlState,
    });
    return;
  }

  const roomService = new RoomServiceClient(
    normalizeLiveKitServiceUrl(livekitUrl),
    livekitApiKey,
    livekitApiSecret
  );

  const roomName = `session-${sessionId}`;
  const identity = await resolveLiveKitIdentity(roomService, roomName, participantId, targetUserId);

  if (identity === null) {
    console.warn('[ControlAPI] LiveKit control signal skipped (participant not in room)', {
      sessionId,
      participantId,
      controlState,
      roomName,
    });
    return;
  }

  // The recipient checks that a control message is addressed to it before
  // acting, so this has to name the identity it is delivered to rather than the
  // database row id.
  const payload = new TextEncoder().encode(
    JSON.stringify({
      type: controlState === 'granted' ? 'control-grant' : 'control-revoke',
      participantId: identity,
      timestamp: Date.now(),
    })
  );

  await roomService.sendData(roomName, payload, DataPacket_Kind.RELIABLE, {
    destinationIdentities: [identity],
  });

  console.info('[ControlAPI] LiveKit control signal sent', {
    sessionId,
    participantId,
    identity,
    controlState,
    roomName,
  });
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

    // Check authentication (supports both cookie and Bearer token)
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const { data: session, error: sessionError } = (await supabase
      .from('sessions')
      .select('id, host_user_id, current_host_id, mode')
      .eq('id', sessionId)
      .single()) as {
      data: (Pick<Session, 'id' | 'host_user_id' | 'current_host_id'> & { mode?: string }) | null;
      error: unknown;
    };

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    const isHostOrCurrentHost =
      session.host_user_id === user.id || session.current_host_id === user.id;

    // Interim presenter-friendly rule: any authenticated active participant can grant/revoke
    // control. Kicking remains host-only in the separate route.
    const { data: actingParticipant, error: actingParticipantError } = (await supabase
      .from('session_participants')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .is('left_at', null)
      .single()) as { data: { id: string } | null; error: unknown };

    if (!isHostOrCurrentHost && (actingParticipantError || !actingParticipant)) {
      return errorResponse('Not authorized to manage control in this session', 403);
    }

    const admin = getSupabaseAdmin();
    // Supabase generated types in this route context infer `never` for update payloads.
    // Cast the query builder to keep the route strongly validated elsewhere.
    const adminParticipants = admin.from('session_participants') as unknown as {
      update: (value: { control_state: ControlState }) => {
        eq: (
          column: string,
          value: string
        ) => {
          eq: (
            column: string,
            value: string
          ) => {
            is: (
              column: string,
              value: null
            ) => {
              select: (columns: string) => {
                single: () => Promise<{ data: unknown; error: { message?: string } | null }>;
              };
            };
          };
        };
      };
    };

    const { data: updatedParticipant, error: updateError } = await adminParticipants
      .update({ control_state })
      .eq('id', participantId)
      .eq('session_id', sessionId)
      .is('left_at', null)
      .select('*')
      .single();

    if (updateError) {
      console.error('Update control state error:', updateError);
      return errorResponse(updateError.message ?? 'Failed to update control state', 400);
    }

    console.info('[ControlAPI] Control state updated', {
      sessionId,
      participantId,
      controlState: control_state,
      actorUserId: user.id,
      mode: session.mode,
    });

    if ((control_state === 'granted' || control_state === 'view-only') && session.mode === 'sfu') {
      try {
        // The updated row carries the user the grant is about, which is what
        // maps this participant onto a LiveKit identity.
        const targetUserId =
          typeof (updatedParticipant as { user_id?: unknown } | null)?.user_id === 'string'
            ? (updatedParticipant as { user_id: string }).user_id
            : null;
        await sendLiveKitControlSignal(sessionId, participantId, targetUserId, control_state);
      } catch (signalError) {
        console.error('[ControlAPI] Failed to send LiveKit control signal', {
          sessionId,
          participantId,
          controlState: control_state,
          error: signalError instanceof Error ? signalError.message : String(signalError),
        });
      }
    }

    // If control was requested, notify the host via push (non-blocking)
    if (control_state === 'requested') {
      void import('@/lib/push').then(async ({ sendPushToUser }) => {
        const { data: session } = await supabase
          .from('sessions')
          .select('host_user_id')
          .eq('id', sessionId)
          .single();

        const hostId = (session as { host_user_id?: string } | null)?.host_user_id;
        if (hostId) {
          const name =
            (updatedParticipant as { display_name?: string }).display_name ?? 'A participant';
          void sendPushToUser(hostId, 'controlRequest', {
            title: 'Control Request',
            body: `${name} wants to control your screen`,
            url: `/session/${sessionId}`,
            tag: `control-${sessionId}`,
          });
        }
      });
    }

    return successResponse(updatedParticipant);
  } catch (error) {
    return handleApiError(error);
  }
}
