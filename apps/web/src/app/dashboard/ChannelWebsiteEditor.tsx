'use client';

import { useState } from 'react';
import { Check, Globe, Loader2 } from 'lucide-react';
import { normalizeWebsiteUrl, WEBSITE_URL_MAX_LENGTH } from '@/lib/channel-website';

interface ChannelWebsiteEditorProps {
  channelId: string;
  initialUrl: string | null;
}

/**
 * The owner's "Website" field for one channel. Validates and normalizes in the
 * browser (same rules as the API) so the error shows before a round trip, then
 * PATCHes /api/channels/[id]; an empty field clears the link.
 */
export function ChannelWebsiteEditor({ channelId, initialUrl }: ChannelWebsiteEditorProps) {
  const [value, setValue] = useState(initialUrl ?? '');
  const [saved, setSaved] = useState(initialUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const save = async () => {
    setError(null);
    setJustSaved(false);
    const normalized = normalizeWebsiteUrl(value);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_url: normalized.url ?? '' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { website_url?: string | null };
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Could not save the website.');
        return;
      }
      const next = body.data?.website_url ?? normalized.url ?? '';
      setValue(next);
      setSaved(next);
      setJustSaved(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = value.trim() !== saved;

  return (
    <div className="mt-4">
      <label
        htmlFor={`website-${channelId}`}
        className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-700"
      >
        <Globe className="h-3.5 w-3.5" /> Website (optional)
      </label>
      <div className="flex gap-2">
        <input
          id={`website-${channelId}`}
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setJustSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          maxLength={WEBSITE_URL_MAX_LENGTH}
          placeholder="example.com"
          aria-invalid={error ? true : undefined}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : justSaved && !dirty ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : null}
          {justSaved && !dirty ? 'Saved' : 'Save'}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs text-gray-500">
          Shown on your channel page as an identity link. Leave empty to remove it.
        </p>
      )}
    </div>
  );
}
