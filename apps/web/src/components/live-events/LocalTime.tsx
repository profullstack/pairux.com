'use client';

import { useEffect, useState } from 'react';

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
  const utc = new Date(iso).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const [text, setText] = useState(utc);
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(locale, {
        weekday: 'short',
        dateStyle: undefined,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        ...(withZone ? { timeZoneName: 'short' as const } : {}),
      })
    );
  }, [iso, locale, withZone]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
