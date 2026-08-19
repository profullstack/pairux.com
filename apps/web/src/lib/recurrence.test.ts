import { describe, it, expect } from 'vitest';
import {
  advanceSeries,
  buildRrule,
  describeRecurrence,
  nextOccurrence,
  occurrencesRemaining,
  ruleFromRow,
  shortRecurrenceLabel,
} from './recurrence';

// Local-time constructor: recurrence deliberately works in wall-clock terms.
function at(y: number, m: number, d: number, h = 9, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('nextOccurrence', () => {
  it('steps daily and weekly by whole days', () => {
    expect(nextOccurrence(at(2026, 8, 19), 'daily', 1)).toEqual(at(2026, 8, 20));
    expect(nextOccurrence(at(2026, 8, 19), 'daily', 3)).toEqual(at(2026, 8, 22));
    expect(nextOccurrence(at(2026, 8, 19), 'weekly', 1)).toEqual(at(2026, 8, 26));
    expect(nextOccurrence(at(2026, 8, 19), 'weekly', 2)).toEqual(at(2026, 9, 2));
  });

  it('keeps the time of day', () => {
    expect(nextOccurrence(at(2026, 8, 19, 14, 30), 'weekly', 1)).toEqual(at(2026, 8, 26, 14, 30));
  });

  it('keeps the weekday for weekly series', () => {
    const start = at(2026, 8, 19); // Wednesday
    const next = nextOccurrence(start, 'weekly', 1);
    expect(next.getDay()).toBe(start.getDay());
  });

  it('steps monthly on the same day of the month', () => {
    expect(nextOccurrence(at(2026, 1, 15), 'monthly', 1)).toEqual(at(2026, 2, 15));
    expect(nextOccurrence(at(2026, 1, 15), 'monthly', 3)).toEqual(at(2026, 4, 15));
  });

  it('clamps a monthly series into short months without losing its day', () => {
    const anchorDay = 31;
    const feb = nextOccurrence(at(2026, 1, 31), 'monthly', 1, anchorDay);
    expect(feb).toEqual(at(2026, 2, 28));

    // The next step comes back to the 31st rather than sticking at the 28th.
    const mar = nextOccurrence(feb, 'monthly', 1, anchorDay);
    expect(mar).toEqual(at(2026, 3, 31));
  });
});

describe('advanceSeries', () => {
  const base = {
    durationMinutes: 60,
    anchorAt: at(2026, 8, 19),
    freq: 'weekly' as const,
    interval: 1,
    count: 0,
    elapsed: 0,
  };

  it('leaves an occurrence that has not started alone', () => {
    const result = advanceSeries({ ...base, scheduledAt: at(2026, 8, 19) }, at(2026, 8, 18));
    expect(result).toBeNull();
  });

  it('leaves an occurrence that is under way alone', () => {
    const result = advanceSeries(
      { ...base, scheduledAt: at(2026, 8, 19, 9, 0) },
      at(2026, 8, 19, 9, 30)
    );
    expect(result).toBeNull();
  });

  it('advances once the occurrence has finished', () => {
    const result = advanceSeries(
      { ...base, scheduledAt: at(2026, 8, 19, 9, 0) },
      at(2026, 8, 19, 10, 1)
    );
    expect(result).toEqual({ scheduledAt: at(2026, 8, 26, 9, 0), elapsed: 1, completed: false });
  });

  it('skips every occurrence missed while nobody looked', () => {
    const result = advanceSeries({ ...base, scheduledAt: at(2026, 8, 19) }, at(2026, 9, 10));
    expect(result?.scheduledAt).toEqual(at(2026, 9, 16));
    expect(result?.elapsed).toBe(4);
    expect(result?.completed).toBe(false);
  });

  it('stops on the last occurrence of a bounded series', () => {
    const result = advanceSeries(
      { ...base, count: 3, scheduledAt: at(2026, 8, 19) },
      at(2026, 12, 1)
    );
    // Occurrences are the 19th, 26th and 2 Sept; the series ends on that third one.
    expect(result).toEqual({ scheduledAt: at(2026, 9, 2), elapsed: 3, completed: true });
  });

  it('never completes an unlimited series', () => {
    const result = advanceSeries(
      { ...base, count: 0, scheduledAt: at(2026, 8, 19) },
      at(2027, 8, 19)
    );
    expect(result?.completed).toBe(false);
  });

  it('counts an occurrence as elapsed only after its full duration', () => {
    const result = advanceSeries(
      { ...base, durationMinutes: 120, scheduledAt: at(2026, 8, 19, 9, 0) },
      at(2026, 8, 19, 10, 30)
    );
    expect(result).toBeNull();
  });
});

describe('occurrencesRemaining', () => {
  it('reports null for an unlimited series', () => {
    expect(occurrencesRemaining(0, 12)).toBeNull();
  });

  it('counts down a bounded series and never goes negative', () => {
    expect(occurrencesRemaining(8, 3)).toBe(5);
    expect(occurrencesRemaining(8, 9)).toBe(0);
  });
});

describe('describeRecurrence', () => {
  it('describes a one-off meeting', () => {
    expect(describeRecurrence({ freq: null, interval: 1, count: 0 })).toBe('Does not repeat');
  });

  it('names the weekday for a weekly series and says how many times', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 1, count: 8 }, at(2026, 8, 19))).toBe(
      'Repeats every week on Wednesday, 8 times'
    );
  });

  it('says forever when the count is zero', () => {
    expect(describeRecurrence({ freq: 'daily', interval: 2, count: 0 })).toBe(
      'Repeats every 2 days, forever'
    );
  });

  it('names the day of the month for a monthly series', () => {
    expect(describeRecurrence({ freq: 'monthly', interval: 1, count: 1 }, at(2026, 8, 19))).toBe(
      'Repeats every month on day 19, 1 time'
    );
  });
});

describe('shortRecurrenceLabel', () => {
  it('is null for a one-off', () => {
    expect(shortRecurrenceLabel({ freq: null, interval: 1, count: 0 })).toBeNull();
  });

  it('uses the plain adverb at interval 1', () => {
    expect(shortRecurrenceLabel({ freq: 'weekly', interval: 1, count: 0 })).toBe('Weekly');
  });

  it('spells out longer intervals', () => {
    expect(shortRecurrenceLabel({ freq: 'weekly', interval: 3, count: 0 })).toBe('Every 3 weeks');
  });
});

describe('buildRrule', () => {
  it('is null without a frequency', () => {
    expect(buildRrule({ freq: null, interval: 1, count: 0 })).toBeNull();
  });

  it('omits INTERVAL and COUNT at their defaults', () => {
    expect(buildRrule({ freq: 'weekly', interval: 1, count: 0 })).toBe('FREQ=WEEKLY');
  });

  it('includes INTERVAL and COUNT when set', () => {
    expect(buildRrule({ freq: 'monthly', interval: 2, count: 6 })).toBe(
      'FREQ=MONTHLY;INTERVAL=2;COUNT=6'
    );
  });
});

describe('ruleFromRow', () => {
  it('treats a missing or unknown frequency as a one-off', () => {
    expect(ruleFromRow({})).toEqual({ freq: null, interval: 1, count: 0 });
    expect(ruleFromRow({ recurrence_freq: 'yearly' }).freq).toBeNull();
  });

  it('reads the stored rule', () => {
    expect(
      ruleFromRow({ recurrence_freq: 'daily', recurrence_interval: 2, recurrence_count: 5 })
    ).toEqual({ freq: 'daily', interval: 2, count: 5 });
  });
});
