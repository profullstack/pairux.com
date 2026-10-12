'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, Lock, Phone, Video } from 'lucide-react';
import type { PairuxCall } from '@profullstack/pairux-embed';
import { ROOM_ID_RE, keyFromHash } from '@/lib/anon-rooms';

const NAME_KEY = 'pairux_anon_name';

interface TokenResponse {
  data?: { token: string; url: string; iceServers?: RTCIceServer[] };
  error?: string;
}

/**
 * An anonymous end-to-end encrypted room (see src/lib/anon-rooms.ts). The media
 * key is read from the URL fragment, which the browser never sends to PairUX;
 * every frame is encrypted with it before it leaves this tab.
 */
export function AnonRoom({ room }: { room: string }) {
  const [key, setKey] = useState<Uint8Array | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState<{ video: boolean } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKey(keyFromHash(window.location.hash));
    try {
      setName(localStorage.getItem(NAME_KEY) ?? '');
    } catch {
      // Storage blocked: start with an empty name.
    }
  }, []);

  useEffect(() => {
    if (!joined || !key || !hostRef.current) return;
    const host = hostRef.current;
    let call: PairuxCall | undefined;
    let ui: { destroy: () => void } | undefined;
    const state = { cancelled: false };
    setError('');
    void (async () => {
      try {
        const res = await fetch('/api/v1/rooms/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room, name: name.trim() || 'Guest' }),
        });
        const body = (await res.json().catch(() => ({}))) as TokenResponse;
        if (!res.ok || !body.data) throw new Error(body.error ?? 'Could not join the room');
        const { PairuxCall: Call, mountCall } = await import('@profullstack/pairux-embed');
        if (state.cancelled) return;
        call = new Call({
          url: body.data.url,
          token: body.data.token,
          ...(body.data.iceServers ? { iceServers: body.data.iceServers } : {}),
          key,
        });
        ui = mountCall(host, call, {
          onLeave: () => {
            setJoined(null);
          },
        });
        await call.join({ audio: true, video: joined.video });
      } catch (err) {
        if (!state.cancelled) setError(err instanceof Error ? err.message : 'The call failed');
      }
    })();
    return () => {
      state.cancelled = true;
      ui?.destroy();
      void call?.leave().catch(() => undefined);
    };
  }, [joined, key, room, name]);

  const join = (video: boolean) => {
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // Storage blocked: the name is just not remembered.
    }
    setJoined({ video });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const valid = ROOM_ID_RE.test(room);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold">
          PairUX
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Lock className="h-3.5 w-3.5" /> End-to-end encrypted
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-6">
        {key === undefined ? null : !valid || !key ? (
          <div className="max-w-md text-center">
            <h1 className="text-xl font-bold">This link is incomplete</h1>
            <p className="mt-2 text-sm text-gray-400">
              A room link ends in <code>#k=…</code>, the key that encrypts the call. Ask for the
              full link, or{' '}
              <Link href="/r" className="text-primary-400 underline">
                start a new room
              </Link>
              .
            </p>
          </div>
        ) : joined ? (
          <>
            {error ? (
              <p className="max-w-md text-center text-red-400">{error}</p>
            ) : (
              <div ref={hostRef} className="h-[70vh] w-full max-w-5xl" />
            )}
          </>
        ) : (
          <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h1 className="text-xl font-bold">Join the room</h1>
            <p className="mt-1 text-sm text-gray-400">
              No account needed. Audio and video are encrypted on your device with a key that only
              people holding this link have. PairUX cannot hear or see the call, and nothing is
              recorded.
            </p>
            <label htmlFor="anon-name" className="mt-4 block text-sm font-medium">
              Your name
            </label>
            <input
              id="anon-name"
              value={name}
              maxLength={50}
              placeholder="Guest"
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="focus:border-primary-500 mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 focus:outline-none"
              autoFocus
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  join(false);
                }}
                className="bg-primary-600 hover:bg-primary-700 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-white"
              >
                <Phone className="h-4 w-4" /> Voice
              </button>
              <button
                type="button"
                onClick={() => {
                  join(true);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-3 py-2.5 text-sm font-semibold hover:bg-gray-800"
              >
                <Video className="h-4 w-4" /> Video
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 text-xs text-gray-400 hover:text-gray-200"
            >
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
