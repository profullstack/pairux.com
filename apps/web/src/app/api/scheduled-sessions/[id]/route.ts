/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { updateScheduledMeetingSchema } from '@/lib/validations';
import { sendMeetingCancellation } from '@/app/actions/meetings';

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

// PATCH /api/scheduled-sessions/[id] — update title/description/time
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const input = updateScheduledMeetingSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    const { data, error } = await (svc as any)
      .from('scheduled_sessions')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('host_user_id', user.id)
      .select()
      .single();

    if (error || !data) return errorResponse('Scheduled session not found', 404);
    return successResponse(data);
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
