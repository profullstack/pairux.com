/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { effectivePlan, maxListeners, type Plan } from '@pairux/shared-types';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getUniqueJoinCode } from '@/lib/join-code';
import { sendMeetingStartNotices } from '@/lib/meeting-start';

/**
 * POST /api/scheduled-sessions/[id]/start — open the room for a scheduled meeting.
 *
 * Starting used to be three client-side steps that only the dashboard knew:
 * create a session that happens to reuse the scheduled join code, navigate to
 * it, and tell nobody. That left the scheduled row untouched, so a second click
 * hit `create_session`'s "join code already in use", and the invitees who were
 * given a time never learned the host had turned up.
 *
 * One endpoint now owns it, which is also what lets the desktop app start a
 * meeting: it takes a meeting id rather than a session id, so the caller does
 * not have to know the room exists before asking for it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    const { data: meeting } = await (svc as any)
      .from('scheduled_sessions')
      .select(
        'id, title, scheduled_at, duration_minutes, join_code, status, session_id, started_at, scheduled_session_invitees(id, email, name, rsvp_status)'
      )
      .eq('id', id)
      .eq('host_user_id', user.id)
      .maybeSingle();

    if (!meeting) return errorResponse('Scheduled session not found', 404);
    if (meeting.status === 'cancelled')
      return errorResponse('This meeting has been cancelled', 400);
    if (meeting.status === 'completed') {
      return errorResponse('This meeting has already finished', 400);
    }

    const joinCode = meeting.join_code as string;

    // `sessions.join_code` is globally unique and never released, so exactly one
    // room can be holding this meeting's code and it is worth knowing which.
    const { data: holder } = await (svc as any)
      .from('sessions')
      .select('*')
      .eq('join_code', joinCode)
      .maybeSingle();

    const liveHolder = holder && (holder.status as string) !== 'ended' ? holder : null;

    // A live room under this code *is* this meeting: a start that already
    // happened, or a session created straight against the code before this
    // endpoint existed. Either way the host is re-entering rather than starting,
    // and adopting it is what makes a second click harmless — creating would
    // fail on the duplicate code, and a fresh code would strand everyone holding
    // the one they were emailed.
    let session = liveHolder as Record<string, unknown> | null;
    const resumed = Boolean(liveHolder);

    if (!session) {
      // An *ended* room still owns the code, and the unique constraint means
      // nothing else can have it while that is true. Every occurrence of a
      // recurring meeting after the first hits this, as does any one-off the
      // host ends and restarts. The dead room is past being joined by code, so
      // it gives the code back rather than the meeting losing it.
      if (holder) {
        const { error: releaseError } = await (svc as any)
          .from('sessions')
          .update({ join_code: await getUniqueJoinCode(svc) })
          .eq('id', holder.id as string);

        if (releaseError) {
          console.error('Start meeting: could not release the join code:', releaseError);
          return errorResponse('Failed to start the meeting', 400);
        }
      }

      const { data: profile } = (await (svc as any)
        .from('profiles')
        .select('plan, plan_expires_at')
        .eq('id', user.id)
        .single()) as { data: { plan: Plan; plan_expires_at: string | null } | null };

      const plan = effectivePlan(profile?.plan ?? 'free', profile?.plan_expires_at ?? null);

      // Created through the caller's own client rather than the service one:
      // `create_session` reads `auth.uid()` for the host and for the host's
      // participant row, and the service key has no uid to read.
      const { data: created, error: createError } = await (supabase.rpc as any)('create_session', {
        p_settings: {
          quality: 'medium',
          allowControl: false,
          maxParticipants: maxListeners(plan),
        },
        p_mode: 'p2p',
        p_join_code: joinCode,
      });

      if (createError || !created) {
        console.error('Start meeting: create_session error:', createError);
        return errorResponse(
          (createError?.message as string | undefined) ?? 'Failed to start the meeting',
          400
        );
      }

      session = created as Record<string, unknown>;
    }

    const sessionId = session.id as string | undefined;
    if (!sessionId) return errorResponse('Failed to start the meeting', 400);

    // Stamped before the emails go out: the link they carry is only true once
    // the meeting and its room are tied together.
    const startedAt = (meeting.started_at as string | null) ?? new Date().toISOString();

    const { error: stampError } = await (svc as any)
      .from('scheduled_sessions')
      .update({
        session_id: sessionId,
        started_at: startedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('host_user_id', user.id);

    if (stampError) {
      // The room is open and the host can use it; losing the stamp costs the
      // "live now" badge and the notice's idempotency, not the meeting.
      console.error('Start meeting: could not stamp scheduled session:', stampError);
    }

    const { data: hostProfile } = await (svc as any)
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    const hostName = (hostProfile?.display_name as string | undefined) ?? user.email ?? 'Your host';

    const notices = await sendMeetingStartNotices({
      db: svc,
      meeting: {
        id: meeting.id as string,
        title: meeting.title as string,
        scheduled_at: meeting.scheduled_at as string,
        join_code: joinCode,
      },
      invitees: (meeting.scheduled_session_invitees ?? []) as {
        id: string;
        email: string;
        name: string | null;
        rsvp_status: string;
      }[],
      hostName,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com',
    });

    if (notices.errors.length > 0) {
      console.error('Start meeting: some start notices failed:', notices.errors);
    }

    return successResponse({
      session,
      scheduledSessionId: meeting.id as string,
      joinCode,
      startedAt,
      resumed,
      notified: notices.notified,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
