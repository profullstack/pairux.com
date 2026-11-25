'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, HelpCircle, Loader2, Pin, X } from 'lucide-react';

/**
 * The room's Q&A panel: ask a question, upvote others, see which one is being
 * answered now and which are done. A moderator (the host, or a user the
 * partner named, e.g. the founder on a board.saas call) can pick the next one
 * or remove one. Agents in the room (the AI chair) take questions from the
 * same queue through their poll. Polls every few seconds; see
 * /api/v1/sessions/:id/questions.
 */
export interface QAQuestion {
  id: string;
  participant_id: string | null;
  display_name: string;
  content: string;
  status: 'open' | 'answering' | 'answered' | 'dismissed';
  votes: number;
  voted: boolean;
  mine: boolean;
  bumped_at: string | null;
  answered_at: string | null;
  created_at: string;
}

interface QAState {
  questions: QAQuestion[];
  canModerate: boolean;
}

export interface QAPanelProps {
  sessionId: string;
  /** A guest's participant id; signed-in users are found by their account. */
  participantId?: string | null;
  className?: string;
  onClose?: () => void;
  pollMs?: number;
}

const STATUS_LABEL: Record<QAQuestion['status'], string> = {
  open: '',
  answering: 'Now answering',
  answered: 'Answered',
  dismissed: 'Removed',
};

export function QAPanel({
  sessionId,
  participantId = null,
  className = '',
  onClose,
  pollMs = 3000,
}: QAPanelProps) {
  const [state, setState] = useState<QAState>({ questions: [], canModerate: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const alive = useRef(true);
  const base = `/api/v1/sessions/${sessionId}/questions`;
  const who = participantId ? `?participantId=${encodeURIComponent(participantId)}` : '';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}${who}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { data?: QAState; error?: string };
      if (!alive.current) return;
      if (res.ok && body.data) {
        setState({ questions: body.data.questions, canModerate: body.data.canModerate });
        setError(null);
      } else {
        setError(body.error ?? 'Could not load questions');
      }
    } catch {
      if (alive.current) setError('Could not load questions');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [base, who]);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => {
      void load();
    }, pollMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, pollMs]);

  const ask = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (content.length < 3 || sending) return;
    setSending(true);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(participantId ? { participantId } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setDraft('');
        setError(null);
        await load();
      } else {
        setError(body.error ?? 'Could not send the question');
      }
    } finally {
      setSending(false);
    }
  };

  const act = async (q: QAQuestion, action: 'vote' | 'unvote' | 'bump' | 'dismiss') => {
    const res = await fetch(`${base}/${q.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(participantId ? { participantId } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: QAState; error?: string };
    if (res.ok && body.data)
      setState({ questions: body.data.questions, canModerate: body.data.canModerate });
    else setError(body.error ?? 'That did not work');
  };

  const open = state.questions.filter((q) => q.status !== 'answered');
  const done = state.questions.filter((q) => q.status === 'answered');

  return (
    <section
      className={`flex h-full flex-col bg-gray-900 ${className}`}
      data-testid="qa-panel"
      aria-label="Questions"
    >
      <header className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h2 className="flex items-center gap-2 font-medium text-white">
          <HelpCircle className="h-5 w-5 text-gray-400" />
          Q&amp;A
          <span className="text-xs text-gray-500">{open.length} waiting</span>
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-700"
            aria-label="Close Q&A"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <form
        onSubmit={(e) => void ask(e)}
        className="flex flex-col gap-2 border-b border-gray-700 p-3"
      >
        <label htmlFor="qa-draft" className="sr-only">
          Your question
        </label>
        <textarea
          id="qa-draft"
          value={draft}
          maxLength={600}
          rows={2}
          placeholder="Ask a question"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:ring-2 focus:ring-blue-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length < 3}
          className="self-end rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Ask'}
        </button>
        {error && (
          <p role="status" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </form>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <Loader2
            className="mx-auto h-5 w-5 animate-spin text-gray-500"
            aria-label="Loading questions"
          />
        ) : !state.questions.length ? (
          <p className="text-center text-sm text-gray-500">No questions yet.</p>
        ) : (
          <ol className="space-y-2">
            {[...open, ...done].map((q) => (
              <li
                key={q.id}
                data-status={q.status}
                className={`rounded-lg px-3 py-2 ${
                  q.status === 'answering'
                    ? 'bg-blue-900/40 ring-1 ring-blue-600'
                    : q.status === 'answered'
                      ? 'bg-gray-800/50 opacity-70'
                      : 'bg-gray-800'
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={q.mine || q.status !== 'open'}
                    onClick={() => void act(q, q.voted ? 'unvote' : 'vote')}
                    aria-pressed={q.voted}
                    aria-label={q.voted ? 'Remove your vote' : 'Vote for this question'}
                    className={`flex w-9 flex-col items-center rounded py-0.5 text-xs ${
                      q.voted ? 'text-blue-400' : 'text-gray-400'
                    } enabled:hover:bg-gray-700 disabled:opacity-60`}
                  >
                    <ChevronUp className="h-4 w-4" />
                    {q.votes}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words text-white">{q.content}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {q.display_name}
                      {q.mine ? ' (you)' : ''}
                      {q.bumped_at && q.status === 'open' ? ' · up next' : ''}
                      {STATUS_LABEL[q.status] ? ` · ${STATUS_LABEL[q.status]}` : ''}
                    </p>
                  </div>
                  {q.status === 'open' && (state.canModerate || q.mine) && (
                    <div className="flex flex-col gap-1">
                      {state.canModerate && !q.bumped_at && (
                        <button
                          type="button"
                          onClick={() => void act(q, 'bump')}
                          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                          aria-label="Take this question next"
                          title="Take this question next"
                        >
                          <Pin className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void act(q, 'dismiss')}
                        className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                        aria-label="Remove this question"
                        title="Remove this question"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
