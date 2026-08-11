/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { updateInviteeSchema } from '@/lib/validations';
import { loadOwnedScheduledSession, publicInvitee } from '@/lib/scheduled-sessions';
import type { InviteeRow } from '@/lib/scheduled-sessions';
import { sendInviteeRemoval } from '@/app/actions/meetings';

interface Params {
  params: Promise<{ id: string; inviteeId: string }>;
}

// PATCH /api/scheduled-sessions/[id]/invitees/[inviteeId] — host edits a name or RSVP
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, inviteeId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const input = updateInviteeSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const session = await loadOwnedScheduledSession(svc, id, user.id);
    if (!session) return errorResponse('Scheduled session not found', 404);

    const existing = session.scheduled_session_invitees.find((i) => i.id === inviteeId);
    if (!existing) return errorResponse('Invitee not found', 404);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.rsvpStatus !== undefined) patch.rsvp_status = input.rsvpStatus;

    const { data, error } = await (svc as any)
      .from('scheduled_session_invitees')
      .update(patch)
      .eq('id', inviteeId)
      .eq('scheduled_session_id', id)
      .select()
      .single();

    if (error || !data) return errorResponse('Invitee not found', 404);
    return successResponse(publicInvitee(data as InviteeRow));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/scheduled-sessions/[id]/invitees/[inviteeId] — remove an invitee.
// Pass ?notify=true to email them that their invitation was withdrawn.
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, inviteeId } = await params;
    const notify = new URL(request.url).searchParams.get('notify') === 'true';

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const session = await loadOwnedScheduledSession(svc, id, user.id);
    if (!session) return errorResponse('Scheduled session not found', 404);

    const existing = session.scheduled_session_invitees.find((i) => i.id === inviteeId);
    if (!existing) return errorResponse('Invitee not found', 404);

    const { error } = await (svc as any)
      .from('scheduled_session_invitees')
      .delete()
      .eq('id', inviteeId)
      .eq('scheduled_session_id', id);

    if (error) return errorResponse(error.message as string, 400);

    if (notify) {
      const emailResult = await sendInviteeRemoval({
        title: session.title,
        scheduledAt: session.scheduled_at,
        inviteeEmail: existing.email,
        inviteeName: existing.name,
      });
      if (!emailResult.ok) {
        console.error('Removal email error:', emailResult.error);
      }
    }

    return successResponse({
      removed: publicInvitee(existing),
      notified: notify,
      invitee_count: session.scheduled_session_invitees.length - 1,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
