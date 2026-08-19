/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-condition */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { scheduleMeetingSchema } from '@/lib/validations';
import { sendMeetingInvites } from '@/app/actions/meetings';
import { getUniqueJoinCode } from '@/lib/join-code';
import { ruleFromRow, type RecurrenceRow } from '@/lib/recurrence';
import { rollForwardHostSeries } from '@/lib/recurrence-rollforward';
import { randomBytes } from 'crypto';
import {
  earliestPossibleCurrentMeetingStart,
  isScheduledMeetingCurrent,
  type ScheduledMeetingTiming,
} from '@/lib/scheduled-meeting-timing';

interface ScheduledSessionInvitee {
  id: string;
  email: string;
  name: string | null;
  rsvp_status: string;
}

interface ScheduledSessionRow extends ScheduledMeetingTiming {
  scheduled_session_invitees: ScheduledSessionInvitee[] | null;
  [key: string]: unknown;
}

// POST /api/scheduled-sessions — create a scheduled meeting + send invites
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const input = scheduleMeetingSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    // Get host display name for the invite email

    const { data: profile } = await (svc as any)
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    const hostName = (profile?.display_name as string | undefined) ?? user.email ?? 'Someone';

    const joinCode = await getUniqueJoinCode(svc);

    const { data: scheduled, error: insertErr } = await (svc as any)
      .from('scheduled_sessions')
      .insert({
        host_user_id: user.id,
        title: input.title,
        description: input.description ?? null,
        scheduled_at: input.scheduledAt,
        duration_minutes: input.durationMinutes,
        join_code: joinCode,
        // A recurring meeting is one row: scheduled_at tracks the next occurrence
        // and the anchor keeps the day of the month stable for monthly series.
        recurrence_freq: input.recurrenceFreq ?? null,
        recurrence_interval: input.recurrenceFreq ? (input.recurrenceInterval ?? 1) : 1,
        recurrence_count: input.recurrenceFreq ? (input.recurrenceCount ?? 0) : 0,
        occurrences_elapsed: 0,
        recurrence_anchor_at: input.scheduledAt,
      })
      .select()
      .single();

    if (insertErr) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return errorResponse(insertErr.message, 400);
    }

    const scheduledId = scheduled.id as string;

    // Insert invitees
    const inviteeEmails = input.inviteeEmails ?? [];
    let invitees: { id: string; email: string; name: string | null; invite_token: string }[] = [];

    if (inviteeEmails.length > 0) {
      const inviteeRows = inviteeEmails.map((email) => ({
        scheduled_session_id: scheduledId,
        email: email.toLowerCase().trim(),
        invite_token: randomBytes(24).toString('hex'),
      }));

      const { data: insertedInvitees, error: inviteErr } = await (svc as any)
        .from('scheduled_session_invitees')
        .insert(inviteeRows)
        .select();

      if (inviteErr) {
        console.error('Invitee insert error:', inviteErr);
      } else {
        invitees = (insertedInvitees as any[]) ?? [];
      }

      // Send invite emails
      if (invitees.length > 0) {
        const emailResult = await sendMeetingInvites({
          scheduledSessionId: scheduledId,
          title: input.title,
          description: input.description,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          joinCode,
          hostName,
          recurrence: ruleFromRow(scheduled as RecurrenceRow),
          invitees: invitees.map((i) => ({ email: i.email, name: i.name, token: i.invite_token })),
        });
        if (!emailResult.ok) {
          console.error('Email send error:', emailResult.error);
        }
      }
    }

    return successResponse({ ...scheduled, invitee_count: invitees.length }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/scheduled-sessions — list the current user's scheduled meetings
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') ?? 'upcoming'; // upcoming | all | past

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    // A recurring meeting whose occurrence has finished sits in the past until it
    // is rolled forward — exactly what an "upcoming" query filters out — so
    // advance this host's series before reading.
    await rollForwardHostSeries(svc, user.id);

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    let query = (svc as any)
      .from('scheduled_sessions')
      .select('*, scheduled_session_invitees(id, email, name, rsvp_status)')
      .eq('host_user_id', user.id)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true });

    if (filter === 'upcoming') {
      // Include meetings that have started but are still within their scheduled
      // duration. The old scheduled_at >= now filter made a meeting disappear
      // exactly when its host needed the Start Now action.
      query = query.gte('scheduled_at', earliestPossibleCurrentMeetingStart(nowMs));
    } else if (filter === 'past') {
      query = query.lt('scheduled_at', now);
    }

    const { data, error } = await query;

    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return errorResponse(error.message, 400);
    }

    const sessions = data as ScheduledSessionRow[];
    let rows = sessions;
    if (filter === 'upcoming') {
      rows = sessions.filter((session) => isScheduledMeetingCurrent(session, nowMs));
    } else if (filter === 'past') {
      rows = sessions.filter((session) => !isScheduledMeetingCurrent(session, nowMs));
    }

    const result = rows.map((s) => ({
      ...s,

      invitee_count: Array.isArray(s.scheduled_session_invitees)
        ? s.scheduled_session_invitees.length
        : 0,

      invitees: s.scheduled_session_invitees,
      scheduled_session_invitees: undefined,
    }));

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
