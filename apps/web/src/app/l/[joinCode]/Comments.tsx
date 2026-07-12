'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, Trash2, User as UserIcon } from 'lucide-react';
import type { SessionComment } from '@pairux/shared-types';

interface CommentsProps {
  sessionId: string;
  joinCode: string;
  initialComments: SessionComment[];
}

function authorName(c: SessionComment): string {
  return c.author_display_name ?? (c.author_username ? `@${c.author_username}` : 'Someone');
}

export function Comments({ sessionId, joinCode, initialComments }: CommentsProps) {
  const router = useRouter();
  const [comments, setComments] = useState<SessionComment[]>(initialComments);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/comments`);
      const body = (await res.json()) as { data?: { comments: SessionComment[] } };
      if (res.ok && body.data) setComments(body.data.comments);
    } catch {
      // ignore
    }
  };

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/l/${joinCode}`)}`);
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not post your comment.');
        return;
      }
      setText('');
      await refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/comments/${id}`, { method: 'DELETE' });
    } catch {
      await refresh();
    }
  };

  return (
    <div>
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          maxLength={1000}
          rows={2}
          placeholder="Add a comment…"
          disabled={busy}
          className="focus:ring-primary-500 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void post()}
          disabled={busy || !text.trim()}
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Post
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <ul className="mt-6 space-y-4">
        {comments.length === 0 && (
          <li className="text-sm text-gray-500">No comments yet — be the first.</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="flex items-start gap-3">
            {c.author_avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.author_avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                <UserIcon className="h-4 w-4 text-gray-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {c.author_username ? (
                  <a
                    href={`/u/${c.author_username}`}
                    className="text-sm font-semibold text-gray-900 hover:underline"
                  >
                    {authorName(c)}
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-gray-900">{authorName(c)}</span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                {c.is_mine && (
                  <button
                    type="button"
                    onClick={() => void remove(c.id)}
                    className="ml-auto text-gray-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-gray-700">
                {c.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
