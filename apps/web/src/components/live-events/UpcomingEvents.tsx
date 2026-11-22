import Link from 'next/link';
import { CalendarDays, CalendarPlus, Radio } from 'lucide-react';
import { ruleFromRow, shortRecurrenceLabel } from '@/lib/recurrence';
import type { PublicEventRow, ViewerOccurrence } from '@/lib/live-events/public';
import { LocalTime } from './LocalTime';

export interface UpcomingItem {
  row: PublicEventRow;
  occ: ViewerOccurrence;
}

/**
 * The "Upcoming live" list: each event links to its public page (/e/<id>),
 * where the add-to-calendar buttons live. `showChannel` adds the channel name
 * (for the cross-channel list on /live).
 */
export function UpcomingEvents({
  items,
  locale,
  liveNowLabel,
  showChannel = false,
}: {
  items: UpcomingItem[];
  locale: string;
  liveNowLabel: string;
  showChannel?: boolean;
}) {
  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {items.map(({ row, occ }) => {
        const rule = ruleFromRow(row);
        const repeats = shortRecurrenceLabel(rule);
        return (
          <li key={row.id}>
            <Link href={`/e/${row.id}`} className="flex items-start gap-4 p-4 hover:bg-gray-50">
              <div className="mt-0.5 rounded-lg bg-indigo-50 p-2 text-indigo-600">
                {occ.liveNow ? (
                  <Radio className="h-5 w-5 text-red-500" />
                ) : (
                  <CalendarDays className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">{row.title}</p>
                <p className="text-sm text-gray-600">
                  {occ.liveNow ? (
                    <span className="font-semibold text-red-600">{liveNowLabel}</span>
                  ) : (
                    <LocalTime iso={occ.startsAt.toISOString()} locale={locale} />
                  )}
                  {repeats ? <span className="text-gray-500"> · {repeats}</span> : null}
                  {showChannel ? (
                    <span className="text-gray-500"> · {row.channel_name}</span>
                  ) : null}
                </p>
              </div>
              <CalendarPlus className="mt-1 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
