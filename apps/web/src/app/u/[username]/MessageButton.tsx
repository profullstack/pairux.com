'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Send, Loader2, X, Check } from 'lucide-react';

interface MessageButtonProps {
  username: string;
  displayName: string;
  /** Whether the viewer is signed in. Signed-out users are sent to login. */
  isAuthed: boolean;
}

/**
 * "Message @username" — opens a compose box and sends a private message. The
 * recipient gets a web push + email notification. Unauthenticated viewers are
 * routed to login first; the profile owner never sees this button.
 */
export function MessageButton({ username, displayName, isAuthed }: MessageButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCompose = () => {
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent(`/u/${username}`)}`);
      return;
    }
    setSent(false);
    setError(null);
    setOpen(true);
  };

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/u/${encodeURIComponent(username)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/u/${username}`)}`);
        return;
      }
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Failed to send message');
        return;
      }
      setSent(true);
      setBody('');
    } catch {
      setError('Failed to send message');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openCompose}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
      >
        <MessageCircle className="h-4 w-4" />
        Message
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => {
            setOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Message {displayName}</h3>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {sent ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <p className="text-sm font-medium text-gray-900">Message sent</p>
                <p className="text-xs text-gray-500">
                  {displayName} will be notified by email and push.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      router.push(`/messages/${username}`);
                    }}
                    className="text-primary-600 rounded-lg px-3 py-1.5 text-sm font-medium hover:underline"
                  >
                    View conversation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                  rows={4}
                  maxLength={4000}
                  autoFocus
                  placeholder={`Write a private message to ${displayName}…`}
                  className="focus:border-primary-500 focus:ring-primary-500 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:ring-1 focus:outline-none"
                />
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy || !body.trim()}
                    className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
