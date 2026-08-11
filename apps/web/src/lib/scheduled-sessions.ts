/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import type { serviceClient } from '@/lib/supabase/service';

export type ServiceClient = ReturnType<typeof serviceClient>;

export interface InviteeRow {
  id: string;
  scheduled_session_id: string;
  email: string;
  name: string | null;
  rsvp_status: string;
  invite_token: string;
}

export interface OwnedScheduledSession {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  join_code: string;
  status: string;
  scheduled_session_invitees: InviteeRow[];
}

/** Emails are stored lowercased and trimmed so the UNIQUE (session, email) index holds. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Loads a scheduled session along with its invitees, but only if `userId` hosts it.
 * Returns null when the session does not exist or belongs to someone else — callers
 * should treat both the same way so a non-host cannot probe for valid ids.
 */
export async function loadOwnedScheduledSession(
  svc: ServiceClient,
  id: string,
  userId: string
): Promise<OwnedScheduledSession | null> {
  const { data, error } = await (svc as any)
    .from('scheduled_sessions')
    .select(
      '*, scheduled_session_invitees(id, scheduled_session_id, email, name, rsvp_status, invite_token)'
    )
    .eq('id', id)
    .eq('host_user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...(data as OwnedScheduledSession),
    scheduled_session_invitees: (data.scheduled_session_invitees ?? []) as InviteeRow[],
  };
}

/** Strips the invite token so it is never handed to the browser alongside a list. */
export function publicInvitee(invitee: InviteeRow) {
  return {
    id: invitee.id,
    email: invitee.email,
    name: invitee.name,
    rsvp_status: invitee.rsvp_status,
  };
}
