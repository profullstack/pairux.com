import type { useTranslations } from 'next-intl';
import type { RecurrenceRule } from '@/lib/recurrence';

/**
 * Localized counterparts of describeRecurrence()/shortRecurrenceLabel() in
 * lib/recurrence.ts. Those stay English because invite emails use them; the
 * dashboard UI renders these instead.
 */
type MeetingsTranslator = ReturnType<typeof useTranslations<'meetings'>>;

/** "Repeats every 2 weeks on Tuesday, 8 times" in the active locale. */
export function describeRecurrenceText(
  t: MeetingsTranslator,
  locale: string,
  rule: RecurrenceRule,
  startsAt?: Date | null
): string {
  if (!rule.freq) return t('recurrence.doesNotRepeat');
  const interval = Math.max(1, Math.trunc(rule.interval));
  const valid = startsAt && !isNaN(startsAt.getTime()) ? startsAt : null;
  let when: 'weekday' | 'monthDay' | 'none' = 'none';
  if (valid && rule.freq === 'weekly') when = 'weekday';
  else if (valid && rule.freq === 'monthly') when = 'monthDay';
  return t('recurrence.describe', {
    freq: rule.freq,
    interval,
    when,
    weekday: valid ? valid.toLocaleDateString(locale, { weekday: 'long' }) : '',
    day: valid ? valid.getDate() : 0,
    count: Math.max(0, rule.count),
  });
}

/** "Weekly", "Every 2 weeks" — null when the meeting does not repeat. */
export function shortRecurrenceText(t: MeetingsTranslator, rule: RecurrenceRule): string | null {
  if (!rule.freq) return null;
  return t('recurrence.short', {
    freq: rule.freq,
    interval: Math.max(1, Math.trunc(rule.interval)),
  });
}
