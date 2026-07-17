'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2 } from 'lucide-react';
import type { DmMessage } from '@pairux/shared-types';

interface ThreadProps {
  /** DM address: a username, or a user id for accounts without one. */
  addr: string;
  displayName: string;
  initialMessages: DmMessage[];
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * A DM conversation: message list + composer. Polls for new messages every 10s
 * so a reply shows up without a manual refresh (server-side Realtime isn't
 * wired for DMs yet).
 */
export function Thread({ addr, displayName, initialMessages }: ThreadProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<DmMessage[]>(initialMessages);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages.length, scrollToEnd]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(addr)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { messages?: DmMessage[] } };
      if (json.data?.messages) setMessages(json.data.messages);
    } catch {
      // ignore transient poll failures
    }
  }, [addr]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 10000);
    return () => {
      clearInterval(id);
    };
  }, [refresh]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(addr)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/messages/${addr}`)}`);
        return;
      }
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Failed to send message');
        return;
      }
      setBody('');
      await refresh();
    } catch {
      setError('Failed to send message');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '60vh' }}>
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            No messages yet. Say hello to {displayName}.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.is_mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div
                  className={`rounded-2xl px-4 py-2 text-sm break-words whitespace-pre-wrap ${
                    m.is_mine
                      ? 'bg-primary-600 rounded-br-sm text-white'
                      : 'rounded-bl-sm bg-gray-100 text-gray-900'
                  }`}
                >
                  {m.body}
                </div>
                <p
                  className={`mt-1 text-xs text-gray-400 ${m.is_mine ? 'text-right' : 'text-left'}`}
                >
                  {timeLabel(m.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-gray-100 p-3">
        {error && <p className="mb-2 px-1 text-sm text-red-600">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={`Message ${displayName}…`}
            className="focus:border-primary-500 focus:ring-primary-500 max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:ring-1 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !body.trim()}
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
