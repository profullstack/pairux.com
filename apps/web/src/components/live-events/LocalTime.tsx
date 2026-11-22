'use client';

import { useEffect, useState } from 'react';

/**
 * Intl rejects dateStyle/timeStyle mixed with any other field (timeZoneName,
 * weekday, ...) with a TypeError, which crashed the server render. Both
 * formats below use explicit fields only.
 */
const SERVER_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
};

const LOCAL_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** Format in UTC (server) or the runtime's zone (browser); falls back to ISO on bad input or locale. */
export function formatEventTime(
  iso: string,
  locale: string,
  zone: 'utc' | 'local',
  withZone = true
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts =
    zone === 'utc'
      ? SERVER_FORMAT
      : { ...LOCAL_FORMAT, ...(withZone ? { timeZoneName: 'short' as const } : {}) };
  try {
    return d.toLocaleString(locale, opts);
  } catch {
    return d.toLocaleString('en', opts);
  }
}

/**
 * A time in the viewer's own zone and language. The server renders UTC (it
 * cannot know the zone); the browser swaps in local time after hydration.
 */
export function LocalTime({
  iso,
  locale,
  withZone = true,
}: {
  iso: string;
  locale: string;
  withZone?: boolean;
}) {
  const [text, setText] = useState(() => formatEventTime(iso, locale, 'utc'));
  useEffect(() => {
    setText(formatEventTime(iso, locale, 'local', withZone));
  }, [iso, locale, withZone]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
