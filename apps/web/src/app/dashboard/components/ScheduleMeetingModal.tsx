'use client';

import { useEffect, useState, useRef, type FormEvent } from 'react';
import { X, Calendar, Clock, Users, Plus, Trash2, Loader2, Repeat, Radio } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { MyChannel } from '@pairux/shared-types';
import {
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  ruleFromRow,
  type RecurrenceFreq,
} from '@/lib/recurrence';
import { describeRecurrenceText } from './recurrenceText';

/** The subset of a scheduled session the modal needs in order to edit it. */
export interface EditableMeeting {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  invitees?: { email: string }[];
  recurrence_freq?: string | null;
  recurrence_interval?: number | null;
  recurrence_count?: number | null;
  channel_id?: string | null;
}

type ChannelOption = Pick<MyChannel, 'id' | 'handle' | 'name' | 'org_name' | 'team_name'>;

/** Who a channel belongs to, for grouping the picker: yours, a team's, or an org's. */
type Translate = ReturnType<typeof useTranslations<'dashboard.schedule'>>;

function channelGroup(t: Translate, c: ChannelOption): string {
  if (c.team_name)
    return c.org_name ? t('teamGroup', { org: c.org_name, team: c.team_name }) : c.team_name;
  if (c.org_name) return c.org_name;
  return t('yourChannels');
}

function groupChannels(t: Translate, channels: ChannelOption[]): [string, ChannelOption[]][] {
  const groups = new Map<string, ChannelOption[]>();
  for (const c of channels) {
    const key = channelGroup(t, c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()];
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  /** Pass an existing meeting to edit it; omit to schedule a new one. */
  meeting?: EditableMeeting;
}

interface SaveResponse {
  data?: { id: string; join_code: string; invitee_count: number };
  error?: string;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

function localDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const REPEAT_OPTIONS = [
  { key: 'repeatNone', value: '' },
  { key: 'repeatDaily', value: 'daily' },
  { key: 'repeatWeekly', value: 'weekly' },
  { key: 'repeatMonthly', value: 'monthly' },
] as const;

/** Number inputs hand back NaN when cleared — keep the payload in range regardless. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function durationLabel(t: Translate, minutes: number): string {
  if (minutes < 60 || DURATION_OPTIONS.includes(minutes)) return t('duration', { minutes });
  return t('durationCustomHours', { hours: minutes / 60 });
}

export function ScheduleMeetingModal({ onClose, onSaved, meeting }: Props) {
  const t = useTranslations('dashboard.schedule');
  const tm = useTranslations('meetings');
  const locale = useLocale();
  const isEditing = meeting !== undefined;

  const defaultTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  defaultTime.setMinutes(0, 0, 0);

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    localDatetimeValue(meeting ? new Date(meeting.scheduled_at) : defaultTime)
  );
  const [durationMinutes, setDurationMinutes] = useState(meeting?.duration_minutes ?? 60);

  const existingRule = ruleFromRow(meeting ?? {});
  const [repeatFreq, setRepeatFreq] = useState<RecurrenceFreq | ''>(existingRule.freq ?? '');
  const [repeatInterval, setRepeatInterval] = useState(existingRule.interval);
  // 0 means "keep repeating forever" — the same convention the API stores.
  const [repeatCount, setRepeatCount] = useState(existingRule.count);

  const [emails, setEmails] = useState<string[]>(() => {
    const existing = meeting?.invitees?.map((i) => i.email) ?? [];
    return existing.length > 0 ? existing : [''];
  });
  const [channelId, setChannelId] = useState(meeting?.channel_id ?? '');
  // Every channel the host can go live on: their own plus team and org ones.
  // undefined while loading.
  const [channels, setChannels] = useState<ChannelOption[] | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/channels', { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: { channels?: ChannelOption[] };
        };
        setChannels(res.ok ? (body.data?.channels ?? []) : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setChannels([]);
      });
    return () => {
      controller.abort();
    };
  }, []);

  // A channel the host has since lost access to still shows as chosen, rather
  // than the picker quietly reading "No channel" while the meeting keeps it.
  const channelUnavailable =
    channelId !== '' && channels !== undefined && !channels.some((c) => c.id === channelId);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // A meeting booked with a custom duration must still show its own value.
  const durationOptions = (
    DURATION_OPTIONS.includes(durationMinutes)
      ? DURATION_OPTIONS
      : [...DURATION_OPTIONS, durationMinutes].sort((a, b) => a - b)
  ).map((value) => ({ value, label: durationLabel(t, value) }));

  const originalEmails = new Set(meeting?.invitees?.map((i) => i.email.toLowerCase()) ?? []);
  const currentEmails = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const addedCount = [...currentEmails].filter((e) => !originalEmails.has(e)).length;
  const removedCount = [...originalEmails].filter((e) => !currentEmails.has(e)).length;

  function addEmailField() {
    setEmails((prev) => [...prev, '']);
  }

  function updateEmail(index: number, value: string) {
    setEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  }

  function removeEmail(index: number) {
    setEmails((prev) => prev.filter((_, i) => i !== index));
  }

  function parseEmailsFromPaste(index: number, raw: string) {
    const parsed = raw
      .split(/[,;\s\n]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (parsed.length <= 1) return; // Let normal input handle single email
    setEmails((prev) => {
      const next = [...prev];
      next.splice(index, 1, ...parsed);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

    // Convert local datetime to ISO
    const localDate = new Date(scheduledAt);
    if (isNaN(localDate.getTime())) {
      setError(t('invalidDate'));
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        isEditing ? `/api/scheduled-sessions/${meeting.id}` : '/api/scheduled-sessions',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            // On edit, always send both fields so clearing them actually sticks.
            description: isEditing ? description.trim() : description.trim() || undefined,
            scheduledAt: localDate.toISOString(),
            durationMinutes,
            // On edit, send the frequency even when it is null so switching a
            // meeting back to a one-off actually clears the series.
            ...(repeatFreq || isEditing ? { recurrenceFreq: repeatFreq || null } : {}),
            // Same reason: on edit, null is how the channel gets taken off.
            ...(channelId || isEditing ? { channelId: channelId || null } : {}),
            ...(repeatFreq
              ? {
                  recurrenceInterval: clamp(repeatInterval, 1, MAX_RECURRENCE_INTERVAL),
                  recurrenceCount: clamp(repeatCount, 0, MAX_RECURRENCE_COUNT),
                }
              : {}),
            inviteeEmails: isEditing
              ? validEmails
              : validEmails.length > 0
                ? validEmails
                : undefined,
          }),
        }
      );

      const json = (await res.json()) as SaveResponse;

      if (!res.ok) {
        setError(json.error ?? (isEditing ? t('saveFailed') : t('scheduleFailed')));
        return;
      }

      onSaved();
    } catch {
      setError(t('networkError'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {isEditing ? t('editTitle') : t('scheduleTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('meetingTitle')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder={t('titlePlaceholder')}
              required
              maxLength={120}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* Date/Time + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 text-gray-400" />
                {t('dateTime')} <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                }}
                required
                {...(isEditing ? {} : { min: localDatetimeValue(new Date()) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="duration-minutes"
                className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"
              >
                <Clock className="h-4 w-4 text-gray-400" />
                {t('durationLabel')}
              </label>
              <select
                id="duration-minutes"
                value={durationMinutes}
                onChange={(e) => {
                  setDurationMinutes(Number(e.target.value));
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                {durationOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Repeat */}
          <div>
            <label
              htmlFor="repeat-freq"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"
            >
              <Repeat className="h-4 w-4 text-gray-400" />
              {t('repeat')}
            </label>
            <select
              id="repeat-freq"
              value={repeatFreq}
              onChange={(e) => {
                setRepeatFreq(e.target.value as RecurrenceFreq | '');
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              {REPEAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.key)}
                </option>
              ))}
            </select>

            {repeatFreq && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="repeat-interval"
                      className="mb-1.5 block text-xs font-medium text-gray-600"
                    >
                      {t('every')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="repeat-interval"
                        type="number"
                        min={1}
                        max={MAX_RECURRENCE_INTERVAL}
                        value={repeatInterval}
                        onChange={(e) => {
                          setRepeatInterval(Number(e.target.value));
                        }}
                        className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-500">
                        {t('repeatUnit', { freq: repeatFreq })}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="repeat-count"
                      className="mb-1.5 block text-xs font-medium text-gray-600"
                    >
                      {t('numberOfTimes')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="repeat-count"
                        type="number"
                        min={0}
                        max={MAX_RECURRENCE_COUNT}
                        value={repeatCount}
                        onChange={(e) => {
                          setRepeatCount(Number(e.target.value));
                        }}
                        className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-500">{t('zeroForever')}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-indigo-600">
                  {t('recurrenceSummary', {
                    description: describeRecurrenceText(
                      tm,
                      locale,
                      { freq: repeatFreq, interval: repeatInterval, count: repeatCount },
                      new Date(scheduledAt)
                    ),
                  })}
                </p>
              </>
            )}
          </div>

          {/* Channel */}
          <div>
            <label
              htmlFor="meeting-channel"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"
            >
              <Radio className="h-4 w-4 text-gray-400" />
              {t('broadcastChannel')} <span className="text-gray-400">{t('optional')}</span>
            </label>
            <select
              id="meeting-channel"
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
              }}
              disabled={channels === undefined}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {channels === undefined ? t('loadingChannels') : t('noChannel')}
              </option>
              {channelUnavailable && <option value={channelId}>{t('channelUnavailable')}</option>}
              {groupChannels(t, channels ?? []).map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t('channelOption', { name: c.name, handle: c.handle })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">
              {channels?.length === 0 ? t('noChannelsHint') : t('channelHint')}
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('description')} <span className="text-gray-400">{t('optional')}</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              placeholder={t('descriptionPlaceholder')}
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* Invite Emails */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Users className="h-4 w-4 text-gray-400" />
              {isEditing ? t('invitees') : t('inviteByEmail')}{' '}
              <span className="text-gray-400">{t('optional')}</span>
            </label>
            <div className="space-y-2">
              {emails.map((email, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    ref={idx === 0 ? emailInputRef : undefined}
                    type="email"
                    value={email}
                    onChange={(e) => {
                      updateEmail(idx, e.target.value);
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text');
                      if (text.includes(',') || text.includes(';') || text.includes('\n')) {
                        e.preventDefault();
                        parseEmailsFromPaste(idx, text);
                      }
                    }}
                    placeholder="colleague@example.com"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  {(emails.length > 1 || email.trim() !== '') && (
                    <button
                      type="button"
                      onClick={() => {
                        removeEmail(idx);
                      }}
                      aria-label={t('removeInvitee')}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {emails.length < 50 && (
                <button
                  type="button"
                  onClick={addEmailField}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('addAnother')}
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              {isEditing ? t('editInviteHint') : t('newInviteHint')}
            </p>
            {isEditing && (addedCount > 0 || removedCount > 0) && (
              <p className="mt-1 text-xs font-medium text-indigo-600">
                {addedCount > 0 && t('toInvite', { count: addedCount })}
                {addedCount > 0 && removedCount > 0 && ' · '}
                {removedCount > 0 && t('toRemove', { count: removedCount })}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim() || !scheduledAt}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing
                ? isLoading
                  ? t('saving')
                  : t('saveChanges')
                : isLoading
                  ? t('scheduling')
                  : t('submitSchedule')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
