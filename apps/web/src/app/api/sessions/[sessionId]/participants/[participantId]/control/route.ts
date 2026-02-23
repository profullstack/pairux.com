import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { ControlState } from '@pairux/shared-types';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import type { Database, Session } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ sessionId: string; participantId: string }>;
}

interface UpdateControlBody {
  control_state: ControlState;
}

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
      .select('id, host_user_id, current_host_id')
      .eq('id', sessionId)
      .single()) as {
      data: Pick<Session, 'id' | 'host_user_id' | 'current_host_id'> | null;
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
