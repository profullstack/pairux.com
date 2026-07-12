'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Radio } from 'lucide-react';
import type { ChannelRestreamDestination } from '@pairux/shared-types';

interface RestreamManagerProps {
  channelId: string;
  initialEnabled: boolean;
}

const PLATFORMS: { value: string; label: string; url: string; editable: boolean }[] = [
  { value: 'youtube', label: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', editable: false },
  { value: 'twitch', label: 'Twitch', url: 'rtmp://live.twitch.tv/app', editable: false },
  {
    value: 'facebook',
    label: 'Facebook',
    url: 'rtmps://live-api-s.facebook.com:443/rtmp',
    editable: false,
  },
  { value: 'custom', label: 'Custom RTMP', url: '', editable: true },
];

export function RestreamManager({ channelId, initialEnabled }: RestreamManagerProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [dests, setDests] = useState<ChannelRestreamDestination[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState('youtube');
  const [rtmpUrl, setRtmpUrl] = useState(PLATFORMS[0]?.url ?? '');
  const [streamKey, setStreamKey] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/restream`);
      const body = (await res.json()) as { data?: { destinations: ChannelRestreamDestination[] } };
      setDests(body.data?.destinations ?? []);
    } catch {
      setDests([]);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    await fetch(`/api/channels/${channelId}/restream`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  };

  const onPlatform = (p: string) => {
    setPlatform(p);
    const def = PLATFORMS.find((x) => x.value === p);
    if (def && !def.editable) setRtmpUrl(def.url);
    else setRtmpUrl('');
  };

  const addDestination = async () => {
    setError(null);
    if (!/^rtmps?:\/\/.+/.test(rtmpUrl.trim())) {
      setError('RTMP URL must start with rtmp:// or rtmps://');
      return;
    }
    if (!streamKey.trim()) {
      setError('Stream key is required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/restream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not save the destination.');
        return;
      }
      setStreamKey('');
      setAdding(false);
      onPlatform('youtube');
      await load();
    } catch {
      setError('Could not save the destination.');
    } finally {
      setBusy(false);
    }
  };

  const toggleDest = async (d: ChannelRestreamDestination) => {
    await fetch(`/api/channels/${channelId}/restream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: d.id,
        platform: d.platform,
        rtmpUrl: d.rtmp_url,
        enabled: !d.enabled,
      }),
    });
    await load();
  };

  const removeDest = async (id: string) => {
    await fetch(`/api/channels/${channelId}/restream/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900">External restreaming</span>
        </div>
        <button
          type="button"
          onClick={() => void toggleEnabled()}
          role="switch"
          aria-checked={enabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-primary-600' : 'bg-gray-300'}`}
          title="Auto-restream this channel's lives to the destinations below"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        When on, going live on this channel also streams to YouTube/Twitch/etc. Off for private
        screenshares.
      </p>

      <div className="mt-3 space-y-2">
        {dests === null ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : dests.length === 0 ? (
          <p className="text-xs text-gray-400">No destinations yet.</p>
        ) : (
          dests.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs"
            >
              <span className="font-medium text-gray-800 capitalize">{d.platform}</span>
              <span className="flex-1 truncate text-gray-500">{d.rtmp_url}</span>
              <button
                type="button"
                onClick={() => void toggleDest(d)}
                className={`rounded px-2 py-0.5 font-medium ${d.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
              >
                {d.enabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => void removeDest(d.id)}
                className="text-gray-400 hover:text-red-600"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <select
            value={platform}
            onChange={(e) => {
              onPlatform(e.target.value);
            }}
            className="h-8 w-full rounded border border-gray-300 px-2 text-xs"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={rtmpUrl}
            onChange={(e) => {
              setRtmpUrl(e.target.value);
            }}
            placeholder="rtmp://…"
            disabled={!PLATFORMS.find((p) => p.value === platform)?.editable}
            className="h-8 w-full rounded border border-gray-300 px-2 text-xs disabled:bg-gray-100"
          />
          <input
            value={streamKey}
            onChange={(e) => {
              setStreamKey(e.target.value);
            }}
            type="password"
            placeholder="Stream key"
            className="h-8 w-full rounded border border-gray-300 px-2 text-xs"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void addDestination()}
              disabled={busy}
              className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
          }}
          className="text-primary-600 mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add destination
        </button>
      )}
    </div>
  );
}
