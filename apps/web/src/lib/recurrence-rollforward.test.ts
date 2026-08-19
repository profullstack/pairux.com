import { describe, it, expect, vi } from 'vitest';
import { rollForwardRow, rollForwardRows, type RecurringRow } from './recurrence-rollforward';

function row(overrides: Partial<RecurringRow> = {}): RecurringRow {
  return {
    id: 'meeting-1',
    scheduled_at: '2026-08-19T09:00:00.000Z',
    duration_minutes: 60,
    recurrence_freq: 'weekly',
    recurrence_interval: 1,
    recurrence_count: 0,
    occurrences_elapsed: 0,
    recurrence_anchor_at: '2026-08-19T09:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

describe('rollForwardRow', () => {
  it('leaves a one-off meeting alone however far in the past it is', () => {
    const original = row({ recurrence_freq: null });
    const result = rollForwardRow(original, new Date('2027-01-01T00:00:00.000Z'));
    expect(result.changed).toBe(false);
    expect(result.row).toBe(original);
  });

  it('leaves a cancelled series alone', () => {
    const result = rollForwardRow(
      row({ status: 'cancelled' }),
      new Date('2026-09-30T00:00:00.000Z')
    );
    expect(result.changed).toBe(false);
  });

  it('moves a lapsed occurrence to the next one', () => {
    const result = rollForwardRow(row(), new Date('2026-08-19T10:30:00.000Z'));
    expect(result.changed).toBe(true);
    expect(new Date(result.row.scheduled_at).toISOString()).toBe('2026-08-26T09:00:00.000Z');
    expect(result.row.occurrences_elapsed).toBe(1);
    expect(result.row.status).toBe('pending');
  });

  it('marks a bounded series completed once it runs out', () => {
    const result = rollForwardRow(
      row({ recurrence_count: 2 }),
      new Date('2026-10-01T00:00:00.000Z')
    );
    expect(result.row.status).toBe('completed');
    expect(result.row.occurrences_elapsed).toBe(2);
    expect(new Date(result.row.scheduled_at).toISOString()).toBe('2026-08-26T09:00:00.000Z');
  });

  it('does not touch a meeting that is currently running', () => {
    const result = rollForwardRow(row(), new Date('2026-08-19T09:45:00.000Z'));
    expect(result.changed).toBe(false);
  });
});

describe('rollForwardRows', () => {
  it('persists only the rows that moved', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const svc = { from: vi.fn().mockReturnValue({ update }) };

    const rows = [
      row({ id: 'moved' }),
      row({ id: 'future', scheduled_at: '2027-01-01T09:00:00.000Z' }),
    ];

    const result = await rollForwardRows(svc, rows, new Date('2026-08-19T10:30:00.000Z'));

    expect(update).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'moved');
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      scheduled_at: '2026-08-26T09:00:00.000Z',
      occurrences_elapsed: 1,
    });
    // Callers get current times back even for the untouched row.
    expect(result[1]?.scheduled_at).toBe('2027-01-01T09:00:00.000Z');
  });

  it('still returns rolled-forward rows when the write fails', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'nope' } });
    const svc = { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) }) };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await rollForwardRows(svc, [row()], new Date('2026-08-19T10:30:00.000Z'));

    expect(result[0]?.scheduled_at).toBe('2026-08-26T09:00:00.000Z');
    consoleError.mockRestore();
  });
});
