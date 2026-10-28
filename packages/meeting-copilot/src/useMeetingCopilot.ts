import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CopilotEvent,
  CopilotMode,
  CopilotRole,
  CopilotState,
  CopilotStatus,
} from './types.js';
import { applyCopilotEvent, readSseEvents } from './events.js';

/** What differs between the web app and the desktop app. */
export interface MeetingCopilotEnvironment {
  /** '' on the web (same origin); https://pairux.com from the desktop app. */
  apiBase?: string;
  /** Auth for each request (the desktop app's Bearer token). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  /** Open a link (Electron sends it to the system browser). */
  openUrl?: (url: string) => void;
}

/**
 * The owner's in-call AI copilot for one meeting page: status for everyone
 * (who has a copilot listening), and for an eligible owner start/stop, the
 * live state over an event stream, private asks and the 30-second recap.
 */
export function useMeetingCopilot({
  sessionId,
  selfId,
  env,
}: {
  sessionId: string;
  selfId: string;
  env: MeetingCopilotEnvironment;
}) {
  // Read through a ref: callers pass a fresh object each render.
  const envRef = useRef(env);
  envRef.current = env;
  const api = useCallback(async (path: string, init: RequestInit = {}): Promise<Response> => {
    const { apiBase = '', headers } = envRef.current;
    const merged = new Headers(init.headers);
    new Headers(await headers?.()).forEach((value, key) => {
      merged.set(key, value);
    });
    if (init.body && !merged.has('content-type')) merged.set('content-type', 'application/json');
    return fetch(`${apiBase}${path}`, { ...init, headers: merged });
  }, []);
  const base = `/api/sessions/${sessionId}/copilot`;

  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [state, setState] = useState<CopilotState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const json = useCallback(async <T>(response: Response): Promise<T> => {
    const body = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: string;
    } & T;
    if (!response.ok)
      throw new Error(body.error ?? `Copilot request failed (${String(response.status)})`);
    return (body.data ?? body) as T;
  }, []);

  const refresh = useCallback(async () => {
    if (!selfId) return;
    try {
      const next = await json<CopilotStatus>(
        await api(`${base}?participantId=${encodeURIComponent(selfId)}`)
      );
      setStatus(next);
      setState((current) => (next.mine && !current ? next.mine : current));
    } catch {
      /* the panel stays hidden while the server cannot answer */
    }
  }, [api, base, json, selfId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  // Live stream while the owner's copilot runs; reconnects after a drop.
  const live = state?.status === 'live';
  useEffect(() => {
    if (!live || !selfId) return;
    const abort = new AbortController();
    let stopped = false;
    const run = async () => {
      while (!stopped) {
        try {
          const response = await api(`${base}/stream`, {
            method: 'POST',
            body: JSON.stringify({ participantId: selfId }),
            signal: abort.signal,
          });
          if (!response.ok || !response.body) {
            setError(await response.text().catch(() => 'The copilot stream failed.'));
            if (response.status === 404 || response.status === 403) return;
          } else {
            for await (const event of readSseEvents<CopilotEvent>(response.body)) {
              setState((current) => applyCopilotEvent(current, event));
              if (event.type === 'ended') return;
            }
          }
        } catch {
          if (abort.signal.aborted) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };
    void run();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [api, base, live, selfId]);

  const act = useCallback(async <T>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError('');
    try {
      return await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    (role: CopilotRole, mode: CopilotMode) =>
      act(async () => {
        const started = await json<CopilotState>(
          await api(base, {
            method: 'POST',
            body: JSON.stringify({ participantId: selfId, role, mode }),
          })
        );
        setState(started);
        void refresh();
        return started;
      }),
    [act, api, base, json, refresh, selfId]
  );

  const stop = useCallback(
    () =>
      act(async () => {
        const ended = await json<CopilotState>(
          await api(`${base}?participantId=${encodeURIComponent(selfId)}`, { method: 'DELETE' })
        );
        setState(ended);
        void refresh();
        return ended;
      }),
    [act, api, base, json, refresh, selfId]
  );

  const ask = useCallback(
    (question: string) =>
      act(async () => {
        const { answer } = await json<{ answer: string }>(
          await api(`${base}/ask`, {
            method: 'POST',
            body: JSON.stringify({ participantId: selfId, question }),
          })
        );
        return answer;
      }),
    [act, api, base, json, selfId]
  );

  const recap = useCallback(
    (seconds = 30) =>
      act(async () => {
        const { recap: text } = await json<{ recap: string }>(
          await api(`${base}/recap`, {
            method: 'POST',
            body: JSON.stringify({ participantId: selfId, seconds }),
          })
        );
        return text;
      }),
    [act, api, base, json, selfId]
  );

  const setQuestion = useCallback(
    (id: string, answered: boolean) =>
      act(async () => {
        setState((current) =>
          current
            ? {
                ...current,
                openQuestions: current.openQuestions.map((one) =>
                  one.id === id ? { ...one, status: answered ? 'answered' : 'open' } : one
                ),
              }
            : current
        );
        await json(
          await api(`${base}/questions`, {
            method: 'POST',
            body: JSON.stringify({ participantId: selfId, id, answered }),
          })
        );
        return true;
      }),
    [act, api, base, json, selfId]
  );

  // Paths are pairux.com pages: the desktop's opener resolves them itself.
  const open = useCallback((url: string) => {
    const { openUrl, apiBase = '' } = envRef.current;
    if (openUrl) openUrl(url);
    else window.open(url.startsWith('http') ? url : `${apiBase}${url}`, '_blank', 'noopener');
  }, []);

  return {
    status,
    state,
    error,
    busy,
    start,
    stop,
    ask,
    recap,
    setQuestion,
    open,
    refresh,
  };
}
export type MeetingCopilot = ReturnType<typeof useMeetingCopilot>;
