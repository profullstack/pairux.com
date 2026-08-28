/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

/**
 * Taking one slot in the `meeting_reminders` ledger.
 *
 * Extracted so the per-minute reminder cron and the "your meeting has started"
 * notice share one implementation. They send different messages but ask the
 * same question of the same unique constraint, and two copies of this would
 * drift apart exactly once, silently, in whichever one was not being edited.
 */

/** A lead of 0 minutes: the notice sent when the host actually starts. */
export const STARTED_LEAD_MINUTES = 0;

export interface ReminderSlot {
  scheduled_session_id: string;
  /** The occurrence this is about, as its exact start instant. */
  occurrence_at: string;
  lead_minutes: number;
  recipient_kind: 'host' | 'invitee';
  recipient_key: string;
  channel: 'email' | 'push';
}

/**
 * Take the slot for one message, returning false if somebody already had it.
 *
 * The insert is the claim and it happens *before* the message goes out, so two
 * overlapping runs -- a retried cron tick, a host double-clicking Start -- cannot
 * both send. Postgres reports the loser as 23505 and it moves on.
 *
 * The cost is that a crash between this returning true and the send completing
 * loses that message for good. That is the intended trade: for an unsolicited
 * notification about a meeting already in the recipient's calendar, silence
 * beats mailing somebody the same thing repeatedly.
 */
export async function claimReminderSlot(db: any, row: ReminderSlot): Promise<boolean> {
  const { error } = await db.from('meeting_reminders').insert(row);
  if (!error) return true;
  // 23505 is unique_violation: somebody else already claimed it, a normal
  // outcome here rather than a failure worth reporting.
  if (error.code === '23505') return false;
  throw new Error(`claim failed: ${String(error.message)}`);
}
