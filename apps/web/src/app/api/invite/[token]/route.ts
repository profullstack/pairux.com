/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

// GET /api/invite/[token] — fetch meeting info for RSVP page
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const svc = serviceClient();

    const { data, error } = await (svc as any)
      .from('scheduled_session_invitees')
      .select(
        'id, email, name, rsvp_status, invite_token, scheduled_sessions(id, title, description, scheduled_at, duration_minutes, join_code, status, host_user_id)'
      )
      .eq('invite_token', token)
      .single();

    if (error || !data) return errorResponse('Invite not found', 404);

    const meeting = data.scheduled_sessions;
    if (!meeting) return errorResponse('Meeting not found', 404);

    // Fetch host name separately

    const hostUserId = meeting.host_user_id as string;

    const { data: profile } = await (svc as any)
      .from('profiles')
      .select('display_name')
      .eq('id', hostUserId)
      .maybeSingle();

    return successResponse({
      invitee: {
        id: data.id as string,

        email: data.email as string,

        name: data.name as string | null,

        rsvpStatus: data.rsvp_status as string,
      },
      meeting: {
        id: meeting.id as string,

        title: meeting.title as string,

        description: meeting.description as string | null,

        scheduledAt: meeting.scheduled_at as string,

        durationMinutes: meeting.duration_minutes as number,

        joinCode: meeting.join_code as string,

        status: meeting.status as string,

        hostName: (profile?.display_name as string | undefined) ?? 'Your host',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/invite/[token] — submit RSVP
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = (await request.json().catch(() => ({}))) as { rsvpStatus?: string };
    const rsvpStatus = body.rsvpStatus;

    if (!rsvpStatus || !['accepted', 'declined'].includes(rsvpStatus)) {
      return errorResponse('rsvpStatus must be "accepted" or "declined"', 400);
    }

    const svc = serviceClient();

    const { data, error } = await (svc as any)
      .from('scheduled_session_invitees')
      .update({ rsvp_status: rsvpStatus })
      .eq('invite_token', token)
      .select()
      .single();

    if (error || !data) return errorResponse('Invite not found', 404);

    return successResponse({ rsvpStatus });
  } catch (error) {
    return handleApiError(error);
  }
}
