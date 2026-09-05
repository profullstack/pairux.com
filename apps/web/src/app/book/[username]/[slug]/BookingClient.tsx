'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  CalendarPlus,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  User as UserIcon,
} from 'lucide-react';

import { buildGoogleCalendarUrl, buildOutlookUrl, downloadIcs } from '@/lib/calendar';
import { groupSlotsByDay, localDate, type Slot } from '@/lib/booking-slots';
import type { PublicBookingHost, PublicBookingPage } from '@/lib/booking';

interface Props {
  host: PublicBookingHost;
  page: PublicBookingPage;
}

interface Confirmation {
  meetingId: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  joinCode: string;
  joinUrl: string;
  hostName: string;
  rsvpUrl: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function guessZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A short list of zones to switch to; the guest's own is always first. */
function zoneChoices(current: string): string[] {
  const common = [
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
  ];
  return [current, ...common.filter((zone) => zone !== current)];
}

function ymdShift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function dayLabel(ymd: string): { weekday: string; date: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

function timeLabel(iso: string, zone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  });
}

function whenLabel(iso: string, zone: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short',
  });
}

/**
 * The booking page a guest sees: a week of days, the free times in their own
 * zone, a short form, and a confirmation with the join code and calendar links.
 *
 * Slots come from the API as instants; the grouping into days happens here
 * in the guest's zone, which is why switching the zone re-draws the grid
 * without another request.
 */
export function BookingClient({ host, page }: Props) {
  const [zone, setZone] = useState<string>('UTC');
  const [weekStart, setWeekStart] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // The guest's zone and today's date are only knowable in the browser.
  useEffect(() => {
    const guessed = guessZone();
    setZone(guessed);
    setWeekStart(localDate(Date.now(), guessed));
  }, []);

  const lastDay = useMemo(
    () => localDate(Date.now() + page.maxDaysAhead * DAY_MS, zone),
    [page.maxDaysAhead, zone]
  );

  const loadWeek = useCallback(
    async (start: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        // A day either side, because the API's `from` is a date in the page's
        // zone and the guest's week may start on a different calendar day there.
        const from = ymdShift(start, -1);
        const res = await fetch(
          `/api/book/${encodeURIComponent(host.username)}/${encodeURIComponent(page.slug)}?from=${from}&days=9`
        );
        const json = (await res.json()) as { data?: { slots: Slot[] }; error?: string };
        if (!res.ok || !json.data) throw new Error(json.error ?? 'Could not load times');
        setSlots(json.data.slots);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Could not load times');
        setSlots([]);
      } finally {
        setLoading(false);
      }
    },
    [host.username, page.slug]
  );

  useEffect(() => {
    if (weekStart) void loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  const days = useMemo(() => {
    if (!weekStart) return [];
    const grouped = new Map(groupSlotsByDay(slots, zone).map((group) => [group.date, group.slots]));
    return Array.from({ length: 7 }, (_, index) => {
      const date = ymdShift(weekStart, index);
      return { date, slots: grouped.get(date) ?? [] };
    });
  }, [slots, weekStart, zone]);

  const canGoBack = weekStart !== '' && weekStart > localDate(Date.now(), zone);
  const canGoForward = weekStart !== '' && ymdShift(weekStart, 7) <= lastDay;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(
        `/api/book/${encodeURIComponent(host.username)}/${encodeURIComponent(page.slug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start: selected.start,
            name,
            email,
            notes: notes || undefined,
            timezone: zone,
          }),
        }
      );
      const json = (await res.json()) as { data?: Confirmation; error?: string };
      if (!res.ok || !json.data) {
        // The time went while the form was open; show the week again.
        if (res.status === 409) {
          setSelected(null);
          void loadWeek(weekStart);
        }
        throw new Error(json.error ?? 'Could not book that time');
      }
      setConfirmation(json.data);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not book that time');
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmation) {
    const calendarEvent = {
      title: confirmation.title,
      description: `Join at ${confirmation.joinUrl} with code ${confirmation.joinCode}`,
      startIso: confirmation.scheduledAt,
      durationMinutes: confirmation.durationMinutes,
      joinUrl: confirmation.joinUrl,
    };
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-600" />
        <h1 className="text-2xl font-bold text-gray-900">You&apos;re booked</h1>
        <p className="mt-2 text-gray-600">
          {whenLabel(confirmation.scheduledAt, zone)} with {confirmation.hostName}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          A confirmation with everything below is on its way to {email}.
        </p>

        <div className="my-6 rounded-lg bg-indigo-50 p-5">
          <p className="text-xs font-semibold tracking-wide text-indigo-700 uppercase">
            Your join code
          </p>
          <p className="mt-1 font-mono text-3xl font-extrabold tracking-[0.3em] text-indigo-700">
            {confirmation.joinCode}
          </p>
          <p className="mt-2 text-xs text-indigo-600">
            The call happens in PairUX. When it&apos;s time, open the link below or enter the code.
          </p>
        </div>

        <a
          href={confirmation.joinUrl}
          className="inline-block rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Open the call page
        </a>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 text-gray-500">
            <CalendarPlus className="h-4 w-4" /> Add to calendar:
          </span>
          <a
            href={buildGoogleCalendarUrl(calendarEvent)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50"
          >
            Google
          </a>
          <a
            href={buildOutlookUrl(calendarEvent)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50"
          >
            Outlook
          </a>
          <button
            type="button"
            onClick={() => {
              downloadIcs(calendarEvent);
            }}
            className="rounded-md border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50"
          >
            .ics
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          Can&apos;t make it after all?{' '}
          <a href={confirmation.rsvpUrl} className="text-indigo-600 hover:underline">
            Let {confirmation.hostName} know
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-xl border border-gray-200 bg-white p-6">
        <Link href={`/book/${host.username}`} className="flex items-center gap-3">
          {host.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={host.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
              <UserIcon className="h-6 w-6 text-indigo-600" />
            </div>
          )}
          <span className="font-medium text-gray-700">{host.displayName}</span>
        </Link>
        <h1 className="mt-4 text-xl font-bold text-gray-900">{page.title}</h1>
        {page.description && <p className="mt-2 text-sm text-gray-600">{page.description}</p>}
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-gray-600">
          <Clock className="h-4 w-4 text-gray-400" /> {page.durationMinutes} minutes
        </p>
        <label className="mt-4 block text-sm text-gray-600">
          <span className="inline-flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" /> Times shown in
          </span>
          <select
            value={zone}
            onChange={(event) => {
              setZone(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {zoneChoices(zone).map((choice) => (
              <option key={choice} value={choice}>
                {choice.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-6 text-xs text-gray-400">
          The call itself happens in PairUX: voice, screen share and remote control, no download
          needed to join from a browser.
        </p>
      </aside>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        {selected ? (
          <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setSubmitError(null);
              }}
              className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
            >
              <ChevronLeft className="h-4 w-4" /> Pick a different time
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {whenLabel(selected.start, zone)}
            </h2>
            <p className="text-sm text-gray-500">
              {page.durationMinutes} minutes with {host.displayName}
            </p>

            <label className="mt-6 block text-sm font-medium text-gray-700">
              Your name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Anything {host.displayName} should know?{' '}
              <span className="font-normal text-gray-400">(optional)</span>
              <textarea
                maxLength={1000}
                rows={3}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            {submitError && (
              <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm booking
            </button>
          </form>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                disabled={!canGoBack}
                onClick={() => {
                  setWeekStart(ymdShift(weekStart, -7));
                }}
                className="rounded-md border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-sm font-semibold text-gray-700">
                {weekStart &&
                  `${dayLabel(weekStart).date} – ${dayLabel(ymdShift(weekStart, 6)).date}`}
              </h2>
              <button
                type="button"
                disabled={!canGoForward}
                onClick={() => {
                  setWeekStart(ymdShift(weekStart, 7));
                }}
                className="rounded-md border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {loadError && (
              <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : days.every((day) => day.slots.length === 0) ? (
              <p className="py-16 text-center text-sm text-gray-500">
                Nothing free this week.{canGoForward ? ' Try the next one.' : ''}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {days.map((day) => {
                  const label = dayLabel(day.date);
                  return (
                    <div key={day.date}>
                      <div className="mb-2 text-center">
                        <p className="text-xs font-semibold text-gray-500 uppercase">
                          {label.weekday}
                        </p>
                        <p className="text-sm text-gray-800">{label.date}</p>
                      </div>
                      <div className="space-y-1.5">
                        {day.slots.length === 0 ? (
                          <p className="text-center text-xs text-gray-300">—</p>
                        ) : (
                          day.slots.map((slot) => (
                            <button
                              key={slot.start}
                              type="button"
                              onClick={() => {
                                setSelected(slot);
                              }}
                              className="w-full rounded-md border border-indigo-200 px-2 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                            >
                              {timeLabel(slot.start, zone)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
