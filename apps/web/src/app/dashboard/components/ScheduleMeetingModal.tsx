'use client';

import { useState, useRef, type FormEvent } from 'react';
import { X, Calendar, Clock, Users, Plus, Trash2, Loader2 } from 'lucide-react';

/** The subset of a scheduled session the modal needs in order to edit it. */
export interface EditableMeeting {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  invitees?: { email: string }[];
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

const DURATION_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '1.5 hours', value: 90 },
  { label: '2 hours', value: 120 },
];

function localDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function durationLabel(minutes: number): string {
  return minutes < 60
    ? `${String(minutes)} minutes`
    : `${String(minutes / 60)} hour${minutes > 60 ? 's' : ''}`;
}

export function ScheduleMeetingModal({ onClose, onSaved, meeting }: Props) {
  const isEditing = meeting !== undefined;

  const defaultTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  defaultTime.setMinutes(0, 0, 0);

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    localDatetimeValue(meeting ? new Date(meeting.scheduled_at) : defaultTime)
  );
  const [durationMinutes, setDurationMinutes] = useState(meeting?.duration_minutes ?? 60);
  const [emails, setEmails] = useState<string[]>(() => {
    const existing = meeting?.invitees?.map((i) => i.email) ?? [];
    return existing.length > 0 ? existing : [''];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // A meeting booked with a custom duration must still show its own value.
  const durationOptions = DURATION_OPTIONS.some((o) => o.value === durationMinutes)
    ? DURATION_OPTIONS
    : [...DURATION_OPTIONS, { label: durationLabel(durationMinutes), value: durationMinutes }].sort(
        (a, b) => a.value - b.value
      );

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
      setError('Invalid date/time');
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
        setError(
          json.error ?? (isEditing ? 'Failed to save changes' : 'Failed to schedule meeting')
        );
        return;
      }

      onSaved();
    } catch {
      setError('Network error. Please try again.');
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
              {isEditing ? 'Edit Meeting' : 'Schedule Meeting'}
            </h2>
          </div>
          <button
            onClick={onClose}
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
              Meeting Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder="e.g. Weekly Team Sync"
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
                Date &amp; Time <span className="text-red-500">*</span>
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
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Clock className="h-4 w-4 text-gray-400" />
                Duration
              </label>
              <select
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

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              placeholder="Agenda, meeting notes, or context..."
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* Invite Emails */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Users className="h-4 w-4 text-gray-400" />
              {isEditing ? 'Invitees' : 'Invite by Email'}{' '}
              <span className="text-gray-400">(optional)</span>
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
                  Add another
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              {isEditing
                ? 'New invitees are emailed an invite; removed ones are told they’re off the list. Paste multiple addresses separated by commas.'
                : 'Invites sent immediately. Paste multiple addresses separated by commas.'}
            </p>
            {isEditing && (addedCount > 0 || removedCount > 0) && (
              <p className="mt-1 text-xs font-medium text-indigo-600">
                {addedCount > 0 && `${String(addedCount)} to invite`}
                {addedCount > 0 && removedCount > 0 && ' · '}
                {removedCount > 0 && `${String(removedCount)} to remove`}
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim() || !scheduledAt}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing
                ? isLoading
                  ? 'Saving...'
                  : 'Save Changes'
                : isLoading
                  ? 'Scheduling...'
                  : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
