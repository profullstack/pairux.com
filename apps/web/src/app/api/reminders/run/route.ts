import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { runMeetingReminders } from '@/lib/meeting-reminders-runner';

/**
 * The tick that sends meeting reminders.
 *
 * Called once a minute by pg_cron via pg_net. It lives here rather than in the
 * database because everything it needs -- the Resend client, the web-push
 * library, the VAPID keys -- is already wired up in this app, and a second copy
 * of that inside Postgres would be a second thing to keep in step.
 *
 * There is no user session behind this request, so it is authorised by a shared
 * secret instead. Without `REMINDERS_CRON_SECRET` set the route refuses
 * everything: an endpoint that mails a meeting's whole invitee list is not one
 * to leave open because a variable was forgotten on a new environment.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Compare in constant time, and only after the lengths match.
 *
 * `timingSafeEqual` throws on differing lengths, which would both crash the
 * route and leak the secret's length through the error; the explicit check
 * turns that into an ordinary refusal.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorised(request: Request): boolean {
  const expected = process.env.REMINDERS_CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;

  return secretMatches(token, expected);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorised(request)) {
    // Deliberately identical whether the secret is wrong or unset: the caller
    // is a cron job, not a person who needs help debugging.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runMeetingReminders();

    // Errors inside the run are reported rather than thrown: one meeting whose
    // host has been deleted should not make the whole tick look like a failure,
    // and pg_cron's log is the only place anybody will see this.
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[reminders] run failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
