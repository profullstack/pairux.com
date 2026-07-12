'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Copy, Check, KeyRound, ExternalLink } from 'lucide-react';
import type { MyChannel } from '@pairux/shared-types';

// Where OBS / any RTMP client points. The stream key selects the channel.
const RTMP_INGEST_URL = 'rtmp://rtmp.pairux.com/live';

export function ChannelsManager() {
  const [channels, setChannels] = useState<MyChannel[] | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [creating, setCreating] = useState(false);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const res = await fetch('/api/channels');
      if (res.status === 401) {
        setNeedsAuth(true);
        setChannels([]);
        return;
      }
      const body = (await res.json()) as { data?: { channels: MyChannel[] } };
      setChannels(body.data?.channels ?? []);
    } catch {
      setChannels([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setError(null);
    if (!/^[A-Za-z0-9_]{3,30}$/.test(handle.trim())) {
      setError('Handle must be 3-30 letters, numbers, or underscores.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not create channel.');
        return;
      }
      setHandle('');
      setName('');
      setDescription('');
      await load();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch {
      // ignore
    }
  };

  if (channels === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your channels…
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
        <p className="text-gray-600">Sign in to manage your channels.</p>
        <Link
          href="/login?next=/dashboard"
          className="bg-primary-600 hover:bg-primary-700 mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {channels.length === 0 && (
          <p className="text-sm text-gray-500">
            You don&apos;t have a channel yet. Create one below — it&apos;s where your public lives
            live.
          </p>
        )}
        {channels.map((ch) => {
          const show = revealed.has(ch.id);
          return (
            <div key={ch.id} className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{ch.name}</h3>
                  <p className="text-primary-600 text-sm">@{ch.handle}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {ch.subscriber_count} {ch.subscriber_count === 1 ? 'subscriber' : 'subscribers'}
                  </p>
                </div>
                <Link
                  href={`/c/${ch.handle}`}
                  className="text-primary-600 inline-flex items-center gap-1 text-sm hover:underline"
                >
                  View <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <KeyRound className="h-3.5 w-3.5" /> Stream to this channel (OBS / any RTMP
                  client)
                </div>
                <label className="text-xs text-gray-500">RTMP URL</label>
                <div className="mb-2 flex gap-2">
                  <input
                    readOnly
                    value={RTMP_INGEST_URL}
                    className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => void copy(`url-${ch.id}`, RTMP_INGEST_URL)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {copied === `url-${ch.id}` ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <label className="text-xs text-gray-500">Stream key</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    type={show ? 'text' : 'password'}
                    value={ch.stream_key}
                    className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
                  />
                  <button
                    onClick={() =>
                      setRevealed((prev) => {
                        const next = new Set(prev);
                        if (next.has(ch.id)) next.delete(ch.id);
                        else next.add(ch.id);
                        return next;
                      })
                    }
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {show ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={() => void copy(`key-${ch.id}`, ch.stream_key)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {copied === `key-${ch.id}` ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
          <Plus className="h-4 w-4" /> New channel
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Handle</label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              maxLength={30}
              placeholder="mychannel"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="My Channel"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <label className="mt-3 mb-1 block text-xs font-medium text-gray-700">
          Description (optional, markdown)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void create()}
          disabled={creating}
          className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create channel
        </button>
      </div>
    </div>
  );
}
