/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { advanceSeries, RECURRENCE_FREQUENCIES, type RecurrenceFreq } from './recurrence';

/**
 * Lazy roll-forward for recurring meetings.
 *
 * Nothing runs on a schedule: whenever a recurring meeting is read — the
 * dashboard list, a join-code lookup — any occurrence that has already finished
 * is counted and `scheduled_at` moved to the next one. A series with a finite
 * count stops on its last occurrence and is marked `completed`.
 */

export interface RecurringRow {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  recurrence_freq: string | null;
  recurrence_interval: number | null;
  recurrence_count: number | null;
  occurrences_elapsed: number | null;
  recurrence_anchor_at: string | null;
  status?: string;
}

export interface RollForwardResult<T extends RecurringRow> {
  row: T;
  changed: boolean;
}

/** Compute — without writing — where a row should sit now. */
export function rollForwardRow<T extends RecurringRow>(row: T, now: Date): RollForwardResult<T> {
  const freq = row.recurrence_freq;
  if (!RECURRENCE_FREQUENCIES.includes(freq as RecurrenceFreq)) return { row, changed: false };
  if (row.status === 'cancelled' || row.status === 'completed') return { row, changed: false };

  const scheduledAt = new Date(row.scheduled_at);
  if (isNaN(scheduledAt.getTime())) return { row, changed: false };

  const anchorAt = row.recurrence_anchor_at ? new Date(row.recurrence_anchor_at) : scheduledAt;

  const advance = advanceSeries(
    {
      scheduledAt,
      durationMinutes: row.duration_minutes,
      anchorAt: isNaN(anchorAt.getTime()) ? scheduledAt : anchorAt,
      freq: freq as RecurrenceFreq,
      interval: row.recurrence_interval ?? 1,
      count: row.recurrence_count ?? 0,
      elapsed: row.occurrences_elapsed ?? 0,
    },
    now
  );

  if (!advance) return { row, changed: false };

  return {
    row: {
      ...row,
      scheduled_at: advance.scheduledAt.toISOString(),
      occurrences_elapsed: advance.elapsed,
      ...(advance.completed ? { status: 'completed' } : {}),
    },
    changed: true,
  };
}

/**
 * Roll every row forward and persist the ones that moved. Returns the updated
 * rows so callers can respond with current data without re-reading.
 *
 * A failed write is logged and swallowed: the caller still gets the correct
 * times, and the next read will try again.
 */
export async function rollForwardRows<T extends RecurringRow>(
  svc: any,
  rows: T[],
  now: Date = new Date()
): Promise<T[]> {
  const results = rows.map((row) => rollForwardRow(row, now));
  const moved = results.filter((r) => r.changed).map((r) => r.row);

  await Promise.all(
    moved.map(async (row) => {
      const { error } = await svc
        .from('scheduled_sessions')
        .update({
          scheduled_at: row.scheduled_at,
          occurrences_elapsed: row.occurrences_elapsed,
          ...(row.status === 'completed' ? { status: 'completed' } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (error) console.error('Recurrence roll-forward error:', row.id, error);
    })
  );

  return results.map((r) => r.row);
}

/**
 * Roll forward every recurring meeting a host owns whose next occurrence is in
 * the past. Called before listing, because a lapsed occurrence is exactly the
 * one an "upcoming" query filters out.
 */
export async function rollForwardHostSeries(svc: any, hostUserId: string): Promise<void> {
  const now = new Date();

  // Housekeeping must never be the reason a read fails, so anything that goes
  // wrong here is logged and the caller carries on with the times it has.
  try {
    const { data, error } = await svc
      .from('scheduled_sessions')
      .select(
        'id, scheduled_at, duration_minutes, recurrence_freq, recurrence_interval, recurrence_count, occurrences_elapsed, recurrence_anchor_at, status'
      )
      .eq('host_user_id', hostUserId)
      .eq('status', 'pending')
      .not('recurrence_freq', 'is', null)
      .lt('scheduled_at', now.toISOString());

    if (error) {
      console.error('Recurrence roll-forward lookup error:', error);
      return;
    }

    await rollForwardRows(svc, (data ?? []) as RecurringRow[], now);
  } catch (err) {
    console.error('Recurrence roll-forward failed:', err);
  }
}
