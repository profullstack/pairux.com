'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarCheck, Copy, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import {
  DAY_KEYS,
  DEFAULT_AVAILABILITY,
  type DayKey,
  type WeeklyAvailability,
} from '@/lib/booking-slots';
import { slugify } from '@/lib/booking-validations';

interface BookingPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  timezone: string;
  availability: WeeklyAvailability;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  active: boolean;
}

const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

const DURATIONS = [15, 20, 30, 45, 60, 90];

/** One window per day is what the form edits; the API accepts more. */
interface DayRow {
  on: boolean;
  start: string;
  end: string;
}

type Rows = Record<DayKey, DayRow>;

function rowsFrom(availability: WeeklyAvailability): Rows {
  const rows = {} as Rows;
  for (const day of DAY_KEYS) {
    const first = availability[day]?.[0];
    rows[day] = first
      ? { on: true, start: first.start, end: first.end }
      : { on: false, start: '09:00', end: '17:00' };
  }
  return rows;
}

function availabilityFrom(rows: Rows): WeeklyAvailability {
  const out: WeeklyAvailability = {};
  for (const day of DAY_KEYS) {
    const row = rows[day];
    if (row.on) out[day] = [{ start: row.start, end: row.end }];
  }
  return out;
}

function guessZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface FormState {
  title: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  durationMinutes: number;
  timezone: string;
  rows: Rows;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
}

function emptyForm(): FormState {
  return {
    title: '',
    slug: '',
    slugTouched: false,
    description: '',
    durationMinutes: 30,
    timezone: guessZone(),
    rows: rowsFrom(DEFAULT_AVAILABILITY),
    bufferMinutes: 0,
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
  };
}

function formFrom(page: BookingPage): FormState {
  return {
    title: page.title,
    slug: page.slug,
    slugTouched: true,
    description: page.description ?? '',
    durationMinutes: page.duration_minutes,
    timezone: page.timezone,
    rows: rowsFrom(page.availability),
    bufferMinutes: page.buffer_minutes,
    minNoticeMinutes: page.min_notice_minutes,
    maxDaysAhead: page.max_days_ahead,
  };
}

/**
 * The host's booking links on the dashboard: make one, switch it off, copy
 * the URL. Bookings themselves show up in Upcoming Meetings like any other
 * meeting, so nothing here lists them.
 */
export function BookingPagesManager() {
  const [pages, setPages] = useState<BookingPage[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookingPage | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/booking-pages');
      const json = (await res.json()) as {
        data?: { username: string | null; pages: BookingPage[] };
        error?: string;
      };
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Could not load booking pages');
      setPages(json.data.pages);
      setUsername(json.data.username);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load booking pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = typeof window === 'undefined' ? 'https://pairux.com' : window.location.origin;
  const urlFor = (page: BookingPage) => `${origin}/book/${username ?? '…'}/${page.slug}`;

  const openNew = () => {
    setForm(emptyForm());
    setFormError(null);
    setEditing('new');
  };

  const openEdit = (page: BookingPage) => {
    setForm(formFrom(page));
    setFormError(null);
    setEditing(page);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = {
      title: form.title,
      slug: form.slug || slugify(form.title),
      description: form.description || null,
      durationMinutes: form.durationMinutes,
      timezone: form.timezone,
      availability: availabilityFrom(form.rows),
      bufferMinutes: form.bufferMinutes,
      minNoticeMinutes: form.minNoticeMinutes,
      maxDaysAhead: form.maxDaysAhead,
    };
    try {
      const res =
        editing === 'new'
          ? await fetch('/api/booking-pages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/booking-pages/${editing?.id ?? ''}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (page: BookingPage) => {
    await fetch(`/api/booking-pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !page.active }),
    });
    await load();
  };

  const remove = async (page: BookingPage) => {
    if (!window.confirm(`Delete "${page.title}"? Meetings already booked on it are kept.`)) return;
    await fetch(`/api/booking-pages/${page.id}`, { method: 'DELETE' });
    await load();
  };

  const copy = async (page: BookingPage) => {
    try {
      await navigator.clipboard.writeText(urlFor(page));
      setCopied(page.id);
      setTimeout(() => {
        setCopied(null);
      }, 1500);
    } catch {
      // Clipboard can be refused; the URL is visible anyway.
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
            <CalendarCheck className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Booking links</h2>
            <p className="text-sm text-gray-500">
              Let anyone book a call with you. It happens in PairUX.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> New link
        </button>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !username ? (
          <p className="text-sm text-gray-500">
            Set a username in Settings first. Your links will be pairux.com/book/&lt;username&gt;/…
          </p>
        ) : pages.length === 0 ? (
          <p className="text-sm text-gray-500">
            No booking links yet. Make one and share pairux.com/book/{username}/&lt;slug&gt;.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pages.map((page) => (
              <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {page.title}{' '}
                    <span className="text-xs font-normal text-gray-400">
                      · {page.duration_minutes} min · {page.timezone.replace(/_/g, ' ')}
                    </span>
                    {!page.active && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        off
                      </span>
                    )}
                  </p>
                  <a
                    href={urlFor(page)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm text-indigo-600 hover:underline"
                  >
                    {urlFor(page)}
                  </a>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(page)}
                    className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
                    title="Copy link"
                  >
                    {copied === page.id ? (
                      <span className="text-xs text-green-600">Copied</span>
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggle(page)}
                    className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    {page.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openEdit(page);
                    }}
                    className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(page)}
                    className="rounded-md p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(event) => void save(event)}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editing === 'new' ? 'New booking link' : 'Edit booking link'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                }}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="block text-sm font-medium text-gray-700">
              Title
              <input
                required
                maxLength={100}
                value={form.title}
                onChange={(event) => {
                  const title = event.target.value;
                  setForm((prev) => ({
                    ...prev,
                    title,
                    slug: prev.slugTouched ? prev.slug : slugify(title),
                  }));
                }}
                placeholder="Intro call"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700">
              Link
              <div className="mt-1 flex items-center rounded-md border border-gray-300">
                <span className="truncate px-3 text-sm text-gray-400">
                  /book/{username ?? '…'}/
                </span>
                <input
                  required
                  pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
                  value={form.slug}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      slug: event.target.value.toLowerCase(),
                      slugTouched: true,
                    }));
                  }}
                  className="min-w-0 flex-1 rounded-r-md border-l border-gray-200 px-3 py-2"
                />
              </div>
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700">
              Description <span className="font-normal text-gray-400">(optional)</span>
              <textarea
                rows={2}
                maxLength={1000}
                value={form.description}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, description: event.target.value }));
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Duration
                <select
                  value={form.durationMinutes}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, durationMinutes: Number(event.target.value) }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  {(DURATIONS.includes(form.durationMinutes)
                    ? DURATIONS
                    : [...DURATIONS, form.durationMinutes]
                  ).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Timezone
                <input
                  required
                  value={form.timezone}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, timezone: event.target.value }));
                  }}
                  list="booking-timezones"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                />
                <datalist id="booking-timezones">
                  {[
                    'America/Los_Angeles',
                    'America/Denver',
                    'America/Chicago',
                    'America/New_York',
                    'Europe/London',
                    'Europe/Berlin',
                    'Asia/Kolkata',
                    'Asia/Tokyo',
                    'Australia/Sydney',
                    'UTC',
                  ].map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-gray-700">Available hours</legend>
              <div className="mt-2 space-y-1.5">
                {DAY_KEYS.map((day) => {
                  const row = form.rows[day];
                  return (
                    <div key={day} className="flex items-center gap-2 text-sm">
                      <label className="flex w-16 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.on}
                          onChange={(event) => {
                            const on = event.target.checked;
                            setForm((prev) => ({
                              ...prev,
                              rows: { ...prev.rows, [day]: { ...prev.rows[day], on } },
                            }));
                          }}
                        />
                        {DAY_LABELS[day]}
                      </label>
                      <input
                        type="time"
                        disabled={!row.on}
                        value={row.start}
                        onChange={(event) => {
                          const start = event.target.value;
                          setForm((prev) => ({
                            ...prev,
                            rows: { ...prev.rows, [day]: { ...prev.rows[day], start } },
                          }));
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40"
                      />
                      <span className="text-gray-400">to</span>
                      <input
                        type="time"
                        disabled={!row.on}
                        value={row.end}
                        onChange={(event) => {
                          const end = event.target.value;
                          setForm((prev) => ({
                            ...prev,
                            rows: { ...prev.rows, [day]: { ...prev.rows[day], end } },
                          }));
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40"
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <label className="block text-xs font-medium text-gray-600">
                Buffer (min)
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={form.bufferMinutes}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, bufferMinutes: Number(event.target.value) }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                Min notice (min)
                <input
                  type="number"
                  min={0}
                  max={20160}
                  value={form.minNoticeMinutes}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, minNoticeMinutes: Number(event.target.value) }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                Days ahead
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.maxDaysAhead}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, maxDaysAhead: Number(event.target.value) }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                />
              </label>
            </div>

            {formError && (
              <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{formError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing === 'new' ? 'Create link' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
