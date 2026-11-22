'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Copy, Loader2, Lock, Plus, Star, Trash2, Video } from 'lucide-react';

export interface RoomView {
  id: string;
  slug: string;
  name: string;
  url: string;
  is_default: boolean;
  settings: { mode: 'p2p' | 'sfu'; locked: boolean };
  current_session_id: string | null;
  created_at: string;
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}),
  });
  if (res.status === 401) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Unauthorized');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok || body.data === undefined)
    throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  return body.data;
}

export function CopyLink({ url, label, done }: { url: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? done : label}
    </button>
  );
}

function RoomCard({
  room,
  onChange,
  onDelete,
}: {
  room: RoomView;
  onChange: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations('rooms');
  const [name, setName] = useState(room.name);
  const [slug, setSlug] = useState(room.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = name !== room.name || slug !== room.slug;

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-gray-900">
            {room.name}
            {room.is_default && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                {t('default')}
              </span>
            )}
            {room.settings.locked && (
              <Lock className="h-4 w-4 text-gray-500" aria-label={t('lockedShort')} />
            )}
          </p>
          <a href={room.url} className="text-sm text-indigo-600 hover:underline">
            {room.url.replace(/^https?:\/\//, '')}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/m/${room.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Video className="h-4 w-4" aria-hidden="true" />
            {t('start')}
          </Link>
          <CopyLink url={room.url} label={t('copy')} done={t('copied')} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-600">
          {t('nameLabel')}
          <input
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-gray-900"
          />
        </label>
        <label className="text-sm text-gray-600">
          {t('slugLabel')}
          <div className="mt-1 flex items-center rounded-lg border border-gray-300">
            <span className="pl-3 text-gray-400">/m/</span>
            <input
              value={slug}
              maxLength={40}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
              className="w-full rounded-r-lg px-1 py-1.5 text-gray-900 outline-none"
            />
          </div>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={room.settings.locked}
            onChange={(e) => void run(() => onChange({ settings: { locked: e.target.checked } }))}
          />
          {t('lockLabel')}
        </label>
        <label className="flex items-center gap-2">
          {t('modeLabel')}
          <select
            value={room.settings.mode}
            onChange={(e) => void run(() => onChange({ settings: { mode: e.target.value } }))}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="p2p">{t('modeP2p')}</option>
            <option value="sfu">{t('modeSfu')}</option>
          </select>
        </label>
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void run(() => onChange({ name, slug }))}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-white disabled:opacity-60"
          >
            {t('save')}
          </button>
        )}
        {!room.is_default && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void run(() => onChange({ is_default: true }))}
            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
          >
            <Star className="h-4 w-4" aria-hidden="true" /> {t('makeDefault')}
          </button>
        )}
        {!room.is_default && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (window.confirm(t('confirmDelete'))) void run(onDelete);
            }}
            className="inline-flex items-center gap-1 text-gray-600 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('delete')}
          </button>
        )}
        {saving && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export function RoomsManager({ header }: { header: ReactNode }) {
  const t = useTranslations('rooms');
  const [rooms, setRooms] = useState<RoomView[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try {
      setRooms((await call<{ rooms: RoomView[] }>('/api/v1/me/rooms')).rooms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError('');
    try {
      await call('/api/v1/me/rooms', { method: 'POST', body: JSON.stringify({ name: newName }) });
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {header}
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">{t('manageTitle')}</h1>
        <p className="mt-2 text-gray-600">{t('manageIntro')}</p>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {!rooms ? (
          <Loader2 className="mt-8 h-6 w-6 animate-spin text-gray-400" />
        ) : (
          <ul className="mt-6 space-y-4">
            {rooms.map((room) => (
              <RoomCard
                key={`${room.id}:${room.slug}:${room.name}`}
                room={room}
                onChange={async (patch) => {
                  await call(`/api/v1/me/rooms/${room.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(patch),
                  });
                  await load();
                }}
                onDelete={async () => {
                  await call(`/api/v1/me/rooms/${room.id}`, { method: 'DELETE' });
                  await load();
                }}
              />
            ))}
          </ul>
        )}
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) void create();
          }}
        >
          <input
            value={newName}
            maxLength={80}
            placeholder={t('newPlaceholder')}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('add')}
          </button>
        </form>
      </main>
    </div>
  );
}
