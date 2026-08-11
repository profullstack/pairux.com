/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { addInviteesSchema, MAX_INVITEES } from '@/lib/validations';
import { loadOwnedScheduledSession, normalizeEmail, publicInvitee } from '@/lib/scheduled-sessions';
import type { InviteeRow } from '@/lib/scheduled-sessions';
import { sendMeetingInvites } from '@/app/actions/meetings';
import { randomBytes } from 'crypto';

// GET /api/scheduled-sessions/[id]/invitees — list invitees for a meeting you host
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const session = await loadOwnedScheduledSession(svc, id, user.id);
    if (!session) return errorResponse('Scheduled session not found', 404);

    return successResponse(session.scheduled_session_invitees.map(publicInvitee));
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/scheduled-sessions/[id]/invitees — add invitees and email them their invite
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const input = addInviteesSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const session = await loadOwnedScheduledSession(svc, id, user.id);
    if (!session) return errorResponse('Scheduled session not found', 404);
    if (session.status !== 'pending') {
      return errorResponse(`Cannot invite to a ${session.status} meeting`, 409);
    }

    // Collapse duplicates inside the request itself, keeping the first name given
    const requested = new Map<string, { email: string; name: string | null }>();
    for (const entry of input.invitees) {
      const email = normalizeEmail(entry.email);
      if (!requested.has(email)) {
        requested.set(email, { email, name: entry.name ?? null });
      }
    }

    const existingEmails = new Set(
      session.scheduled_session_invitees.map((i) => normalizeEmail(i.email))
    );
    const skipped = [...requested.keys()].filter((email) => existingEmails.has(email));
    const toAdd = [...requested.values()].filter((i) => !existingEmails.has(i.email));

    if (toAdd.length === 0) {
      return successResponse({
        added: [],
        skipped,
        invitee_count: session.scheduled_session_invitees.length,
      });
    }

    if (existingEmails.size + toAdd.length > MAX_INVITEES) {
      return errorResponse(
        `This meeting can hold at most ${String(MAX_INVITEES)} invitees (currently ${String(existingEmails.size)})`,
        400
      );
    }

    const { data: inserted, error: insertErr } = await (svc as any)
      .from('scheduled_session_invitees')
      .insert(
        toAdd.map((i) => ({
          scheduled_session_id: id,
          email: i.email,
          name: i.name,
          invite_token: randomBytes(24).toString('hex'),
        }))
      )
      .select();

    if (insertErr) {
      return errorResponse(insertErr.message as string, 400);
    }

    const added = (inserted ?? []) as InviteeRow[];

    // Only the newly added get an email — re-inviting the whole list would spam existing invitees
    if (added.length > 0) {
      const { data: profile } = await (svc as any)
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();

      const hostName = (profile?.display_name as string | undefined) ?? user.email ?? 'Someone';

      const emailResult = await sendMeetingInvites({
        scheduledSessionId: id,
        title: session.title,
        ...(session.description !== null && { description: session.description }),
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        joinCode: session.join_code,
        hostName,
        invitees: added.map((i) => ({ email: i.email, name: i.name, token: i.invite_token })),
      });
      if (!emailResult.ok) {
        console.error('Invite email error:', emailResult.error);
      }
    }

    return successResponse(
      {
        added: added.map(publicInvitee),
        skipped,
        invitee_count: existingEmails.size + added.length,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
