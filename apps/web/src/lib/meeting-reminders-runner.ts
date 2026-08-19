import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createEmailer } from '@profullstack/emailer';

import { dueLead, timeUntil, wantsReminder, REMINDER_PREF_KEYS } from './meeting-reminders';
import { sendPushToUser } from './push';

/**
 * Send whatever meeting reminders are due right now.
 *
 * Called once a minute by pg_cron through `/api/reminders/run`. Everything
 * about *when* a reminder is due lives in `meeting-reminders.ts` and is tested
 * without a database; this module is the part that has to talk to Postgres,
 * Resend and the push service, and its job is mostly to be careful about
 * claiming before sending.
 */

/** How far ahead to look. Nothing can be due beyond the widest lead time. */
const HORIZON_MINUTES = 1440;

/** Meetings examined per run, newest deadline first. */
const MEETING_LIMIT = 200;

export interface ReminderSummary {
  meetings: number;
  emails: number;
  pushes: number;
  skipped: number;
  errors: string[];
}

interface MeetingRow {
  id: string;
  host_user_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  join_code: string;
}

interface InviteeRow {
  id: string;
  email: string;
  name: string | null;
  rsvp_status: string;
}

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Take the slot for one message, returning false if somebody already had it.
 *
 * This is the whole concurrency story. The unique constraint on
 * `meeting_reminders` is claimed *before* the message goes out, so two runs of
 * the cron overlapping -- or one run retried after a timeout -- cannot both
 * send. Postgres reports the loser as 23505 and it simply moves on.
 *
 * The cost is that a crash between this returning true and the send completing
 * loses that reminder for good. That is the intended trade: see the migration.
 */
async function claim(
  db: SupabaseClient,
  row: {
    scheduled_session_id: string;
    occurrence_at: string;
    lead_minutes: number;
    recipient_kind: 'host' | 'invitee';
    recipient_key: string;
    channel: 'email' | 'push';
  }
): Promise<boolean> {
  const { error } = await db.from('meeting_reminders').insert(row);
  if (!error) return true;
  // 23505 is unique_violation: somebody else already claimed it, which is a
  // normal outcome here rather than a failure worth reporting.
  if (error.code === '23505') return false;
  throw new Error(`claim failed: ${error.message}`);
}

/**
 * Lead times already sent for one occurrence, indexed by recipient and channel.
 *
 * Read once per meeting rather than once per recipient: a meeting with thirty
 * invitees would otherwise cost thirty round trips to answer a question one
 * indexed read covers.
 */
async function alreadySent(
  db: SupabaseClient,
  sessionId: string,
  occurrenceAt: string
): Promise<Map<string, Set<number>>> {
  const { data } = await db
    .from('meeting_reminders')
    .select('recipient_kind, recipient_key, channel, lead_minutes')
    .eq('scheduled_session_id', sessionId)
    .eq('occurrence_at', occurrenceAt);

  const byRecipient = new Map<string, Set<number>>();
  for (const row of data ?? []) {
    const r = row as { recipient_kind: string; recipient_key: string; channel: string; lead_minutes: number };
    const key = `${r.recipient_kind}:${r.recipient_key}:${r.channel}`;
    const set = byRecipient.get(key) ?? new Set<number>();
    set.add(Number(r.lead_minutes));
    byRecipient.set(key, set);
  }
  return byRecipient;
}

function reminderEmailHtml(opts: {
  title: string;
  when: string;
  startsAtLabel: string;
  joinUrl: string;
  joinCode: string;
  recipientName: string | null;
}): string {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#4f46e5;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Starting ${opts.when}</h1>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">${greeting}</p>
      <h2 style="color:#111827;margin:0 0 8px;">${opts.title}</h2>
      <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">${opts.startsAtLabel}</p>
      <a href="${opts.joinUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;">Join Meeting</a>
      <p style="color:#9ca3af;font-size:13px;margin-top:20px;">Join code: <strong>${opts.joinCode}</strong></p>
    </div>
    <div style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via <a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a> · Manage reminders in <a href="https://pairux.com/settings#notifications" style="color:#6366f1;text-decoration:none;">settings</a></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * @param now injectable so a test can place itself inside a band
 */
export async function runMeetingReminders(now: Date = new Date()): Promise<ReminderSummary> {
  const db = admin();
  const summary: ReminderSummary = { meetings: 0, emails: 0, pushes: 0, skipped: 0, errors: [] };

  const horizon = new Date(now.getTime() + HORIZON_MINUTES * 60_000);

  // Only meetings that have not started and are inside the widest lead time.
  // `status = 'pending'` drops cancelled and completed ones; a recurring series
  // stays pending across occurrences, which is why the ledger keys on the
  // instant rather than the row.
  const { data: meetings, error } = await db
    .from('scheduled_sessions')
    .select('id, host_user_id, title, description, scheduled_at, duration_minutes, join_code')
    .eq('status', 'pending')
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MEETING_LIMIT);

  if (error) {
    summary.errors.push(`load meetings: ${error.message}`);
    return summary;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = resendApiKey ? createEmailer({ resendApiKey, defaultFrom }) : null;
  if (!emailer) summary.errors.push('RESEND_API_KEY not configured; push only');

  for (const raw of meetings ?? []) {
    const meeting = raw as MeetingRow;
    summary.meetings += 1;

    try {
      const startsAt = new Date(meeting.scheduled_at);
      const occurrenceAt = meeting.scheduled_at;
      const sent = await alreadySent(db, meeting.id, occurrenceAt);
      const joinUrl = `${appUrl}/join/${meeting.join_code}`;
      const startsAtLabel = startsAt.toUTCString();

      // ---- the host: an account, so both channels are possible
      const hostSettings = await db
        .from('profiles')
        .select('settings, display_name')
        .eq('id', meeting.host_user_id)
        .single();
      const notifications = ((hostSettings.data?.settings ?? {}) as Record<string, unknown>)
        .notifications as Record<string, unknown> | undefined;

      const hostEmailLead = dueLead(
        startsAt,
        now,
        sent.get(`host:${meeting.host_user_id}:email`) ?? new Set()
      );
      const hostPushLead = dueLead(
        startsAt,
        now,
        sent.get(`host:${meeting.host_user_id}:push`) ?? new Set()
      );

      if (hostEmailLead && wantsReminder(notifications, hostEmailLead) && emailer) {
        const { data: user } = await db.auth.admin.getUserById(meeting.host_user_id);
        const to = user?.user?.email;
        if (to) {
          const claimed = await claim(db, {
            scheduled_session_id: meeting.id,
            occurrence_at: occurrenceAt,
            lead_minutes: hostEmailLead,
            recipient_kind: 'host',
            recipient_key: meeting.host_user_id,
            channel: 'email',
          });
          if (claimed) {
            await (emailer as { send: (o: unknown) => Promise<unknown> }).send({
              to,
              subject: `${meeting.title} starts ${timeUntil(startsAt, now)}`,
              html: reminderEmailHtml({
                title: meeting.title,
                when: timeUntil(startsAt, now),
                startsAtLabel,
                joinUrl,
                joinCode: meeting.join_code,
                recipientName: hostSettings.data?.display_name ?? null,
              }),
            });
            summary.emails += 1;
          } else summary.skipped += 1;
        }
      }

      if (hostPushLead && wantsReminder(notifications, hostPushLead)) {
        const claimed = await claim(db, {
          scheduled_session_id: meeting.id,
          occurrence_at: occurrenceAt,
          lead_minutes: hostPushLead,
          recipient_kind: 'host',
          recipient_key: meeting.host_user_id,
          channel: 'push',
        });
        if (claimed) {
          // `sendPushToUser` applies the same preference itself, so a host who
          // has turned this lead off spends a claim and sends nothing. That is
          // deliberate: the claim is what stops the next tick trying again.
          const result = await sendPushToUser(
            meeting.host_user_id,
            REMINDER_PREF_KEYS[hostPushLead],
            {
              title: `${meeting.title} starts ${timeUntil(startsAt, now)}`,
              body: `Join code ${meeting.join_code}`,
              url: `/join/${meeting.join_code}`,
              tag: `meeting-${meeting.id}`,
            }
          );
          summary.pushes += result.sent;
        } else summary.skipped += 1;
      }

      // ---- invitees: email addresses, frequently with no account behind them
      if (emailer) {
        const { data: invitees } = await db
          .from('scheduled_session_invitees')
          .select('id, email, name, rsvp_status')
          .eq('scheduled_session_id', meeting.id);

        for (const inviteeRaw of invitees ?? []) {
          const invitee = inviteeRaw as InviteeRow;
          // Somebody who said no does not need four more messages about it.
          if (invitee.rsvp_status === 'declined') continue;

          const lead = dueLead(
            startsAt,
            now,
            sent.get(`invitee:${invitee.id}:email`) ?? new Set()
          );
          if (!lead) continue;

          // No preference lookup: an invitee has no account and therefore no
          // settings row. The per-lead toggles are an account feature, and the
          // way out for an invitee is to decline, which stops all of them.
          const claimed = await claim(db, {
            scheduled_session_id: meeting.id,
            occurrence_at: occurrenceAt,
            lead_minutes: lead,
            recipient_kind: 'invitee',
            recipient_key: invitee.id,
            channel: 'email',
          });
          if (!claimed) {
            summary.skipped += 1;
            continue;
          }

          await (emailer as { send: (o: unknown) => Promise<unknown> }).send({
            to: invitee.email,
            subject: `${meeting.title} starts ${timeUntil(startsAt, now)}`,
            html: reminderEmailHtml({
              title: meeting.title,
              when: timeUntil(startsAt, now),
              startsAtLabel,
              joinUrl,
              joinCode: meeting.join_code,
              recipientName: invitee.name,
            }),
          });
          summary.emails += 1;
        }
      }
    } catch (err) {
      // One bad meeting must not stop the others; the claim it may already have
      // taken is the only thing lost.
      summary.errors.push(`${meeting.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
