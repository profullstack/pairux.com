'use client';

import { useState, useEffect, useCallback } from 'react';
import { Radio, Check, Loader2 } from 'lucide-react';

interface YtStatus {
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
}

/**
 * Connect a YouTube account so PairUX auto-transitions the broadcast to live
 * when you start streaming (instead of it sitting on "Preparing stream").
 */
export function YouTubeConnect() {
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/status');
      if (res.ok) {
        const json = (await res.json()) as { data: YtStatus };
        setStatus(json.data);
      }
    } catch {
      // leave status null — section shows a spinner / nothing actionable
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/youtube/disconnect', { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
            <Radio className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">YouTube auto go-live</h2>
            <p className="text-sm text-gray-500">
              Take your YouTube broadcast live automatically when you start streaming — no more
              &ldquo;Preparing stream&rdquo;.
            </p>
          </div>
        </div>
      </div>
      <div className="p-6">
        {status === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : !status.configured ? (
          <p className="text-sm text-gray-500">
            Not available yet — the server is missing Google OAuth configuration.
          </p>
        ) : status.connected ? (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              Connected{status.channelTitle ? ` — ${status.channelTitle}` : ''}
            </span>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <a
            href="/api/youtube/auth"
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Radio className="h-4 w-4" />
            Connect YouTube
          </a>
        )}
      </div>
    </div>
  );
}
