/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { updateScheduledMeetingSchema } from '@/lib/validations';
import {
  sendMeetingCancellation,
  sendMeetingInvites,
  sendMeetingUpdate,
  sendInviteeRemoval,
} from '@/app/actions/meetings';
import { randomBytes } from 'crypto';

// GET /api/scheduled-sessions/[id]
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    const { data, error } = await (svc as any)
      .from('scheduled_sessions')
      .select('*, scheduled_session_invitees(id, email, name, rsvp_status, invite_token)')
      .eq('id', id)
      .eq('host_user_id', user.id)
      .single();

    if (error || !data) return errorResponse('Scheduled session not found', 404);
    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}

interface ExistingInvitee {
  id: string;
  email: string;
  name: string | null;
  invite_token: string;
}

// Did any detail that invitees care about actually change?
function detailsChanged(before: any, after: any): boolean {
  if ((before.title as string) !== (after.title as string)) return true;
  if ((before.description ?? null) !== (after.description ?? null)) return true;
  if ((before.duration_minutes as number) !== (after.duration_minutes as number)) return true;
  return (
    new Date(before.scheduled_at as string).getTime() !==
    new Date(after.scheduled_at as string).getTime()
  );
}

// PATCH /api/scheduled-sessions/[id] — edit the meeting and/or its invitee list.
// `inviteeEmails` is the complete desired list: addresses not already invited get an
// invite email, addresses that disappear are removed and told so.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const { inviteeEmails, ...fields } = updateScheduledMeetingSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    const { data: existing } = await (svc as any)
      .from('scheduled_sessions')
      .select('*, scheduled_session_invitees(id, email, name, invite_token)')
      .eq('id', id)
      .eq('host_user_id', user.id)
      .single();

    if (!existing) return errorResponse('Scheduled session not found', 404);
    if (existing.status === 'cancelled') {
      return errorResponse('This meeting has been cancelled', 400);
    }

    let updated = existing;

    if (Object.keys(fields).length > 0) {
      const { data, error } = await (svc as any)
        .from('scheduled_sessions')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('host_user_id', user.id)
        .select()
        .single();

      if (error || !data) return errorResponse('Scheduled session not found', 404);
      updated = data;
    }

    const currentInvitees: ExistingInvitee[] = existing.scheduled_session_invitees ?? [];
    let added: ExistingInvitee[] = [];
    let removed: ExistingInvitee[] = [];

    if (inviteeEmails) {
      const desired = new Set(inviteeEmails);
      const alreadyInvited = new Set(currentInvitees.map((i) => i.email.toLowerCase()));

      removed = currentInvitees.filter((i) => !desired.has(i.email.toLowerCase()));
      const toAdd = inviteeEmails.filter((email) => !alreadyInvited.has(email));

      if (removed.length > 0) {
        const { error: deleteErr } = await (svc as any)
          .from('scheduled_session_invitees')
          .delete()
          .in(
            'id',
            removed.map((i) => i.id)
          );
        if (deleteErr) {
          console.error('Invitee delete error:', deleteErr);
          removed = [];
        }
      }

      if (toAdd.length > 0) {
        const { data: inserted, error: insertErr } = await (svc as any)
          .from('scheduled_session_invitees')
          .insert(
            toAdd.map((email) => ({
              scheduled_session_id: id,
              email,
              invite_token: randomBytes(24).toString('hex'),
            }))
          )
          .select();

        if (insertErr) {
          console.error('Invitee insert error:', insertErr);
        } else {
          added = (inserted ?? []) as ExistingInvitee[];
        }
      }
    }

    // Host display name for the emails below
    const { data: profile } = await (svc as any)
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    const hostName = (profile?.display_name as string | undefined) ?? user.email ?? 'Someone';

    const joinCode = updated.join_code as string;
    const description = (updated.description as string | null) ?? undefined;

    if (added.length > 0) {
      const inviteResult = await sendMeetingInvites({
        scheduledSessionId: id,
        title: updated.title as string,
        description,
        scheduledAt: updated.scheduled_at as string,
        durationMinutes: updated.duration_minutes as number,
        joinCode,
        hostName,
        invitees: added.map((i) => ({ email: i.email, name: i.name, token: i.invite_token })),
      });
      if (!inviteResult.ok) console.error('Invite email error:', inviteResult.error);
    }

    if (removed.length > 0) {
      await sendInviteeRemoval({
        title: updated.title as string,
        scheduledAt: updated.scheduled_at as string,
        inviteeEmails: removed.map((i) => i.email),
      });
    }

    // Invitees who were already on the list only need a heads-up if something moved.
    const removedIds = new Set(removed.map((i) => i.id));
    const retained = currentInvitees.filter((i) => !removedIds.has(i.id));

    if (retained.length > 0 && detailsChanged(existing, updated)) {
      await sendMeetingUpdate({
        title: updated.title as string,
        description,
        scheduledAt: updated.scheduled_at as string,
        previousScheduledAt: existing.scheduled_at as string,
        durationMinutes: updated.duration_minutes as number,
        joinCode,
        hostName,
        inviteeEmails: retained.map((i) => i.email),
      });
    }

    const { data: invitees } = await (svc as any)
      .from('scheduled_session_invitees')
      .select('id, email, name, rsvp_status')
      .eq('scheduled_session_id', id);

    const inviteeList = (invitees ?? []) as unknown[];

    return successResponse({
      ...updated,
      scheduled_session_invitees: undefined,
      invitees: inviteeList,
      invitee_count: inviteeList.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/scheduled-sessions/[id] — cancel a scheduled meeting
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    // Fetch before cancelling so we can send cancellation emails

    const { data: existing } = await (svc as any)
      .from('scheduled_sessions')
      .select('*, scheduled_session_invitees(email, name)')
      .eq('id', id)
      .eq('host_user_id', user.id)
      .single();

    if (!existing) return errorResponse('Scheduled session not found', 404);

    const { error } = await (svc as any)
      .from('scheduled_sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('host_user_id', user.id);

    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return errorResponse(error.message, 400);
    }

    // Send cancellation emails to invitees

    const invitees: { email: string; name: string | null }[] =
      existing.scheduled_session_invitees ?? [];
    if (invitees.length > 0) {
      await sendMeetingCancellation({
        title: existing.title as string,

        scheduledAt: existing.scheduled_at as string,
        inviteeEmails: invitees.map((i) => i.email),
      });
    }

    return successResponse({ cancelled: true });
  } catch (error) {
    return handleApiError(error);
  }
}
