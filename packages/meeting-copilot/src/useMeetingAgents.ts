import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentInviteStatus, AnyAgentJoin, MeetingAgent } from './types.js';
import type { MeetingCopilotEnvironment } from './useMeetingCopilot.js';

/**
 * The agents you can invite into one meeting: your own and your orgs', each
 * with its invite status, plus the join code any other agent can use. Free
 * for everyone signed in; only the live transcript needs Pro.
 */
export function useMeetingAgents({
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
  const base = `/api/sessions/${sessionId}/agents`;

  const [agents, setAgents] = useState<MeetingAgent[] | null>(null);
  const [any, setAny] = useState<AnyAgentJoin | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Set when an invite went out without the live transcript (the inviter is not on Pro). */
  const [noTranscript, setNoTranscript] = useState('');

  const call = useCallback(async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const { apiBase = '', headers } = envRef.current;
    const merged = new Headers(init.headers);
    new Headers(await headers?.()).forEach((value, key) => {
      merged.set(key, value);
    });
    if (init.body && !merged.has('content-type')) merged.set('content-type', 'application/json');
    const response = await fetch(`${apiBase}${path}`, { ...init, headers: merged });
    const body = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!response.ok || body.data === undefined)
      throw new Error(body.error ?? `Agents request failed (${String(response.status)})`);
    return body.data;
  }, []);

  const refresh = useCallback(async () => {
    if (!selfId) return;
    try {
      const next = await call<{ agents: MeetingAgent[]; any: AnyAgentJoin }>(base);
      setAgents(next.agents);
      setAny(next.any);
    } catch {
      /* the section stays hidden while the server cannot answer */
    }
  }, [base, call, selfId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  const invite = useCallback(
    async (agentId: string) => {
      setBusy(true);
      setError('');
      try {
        const result = await call<{
          invite: { id: string; status: AgentInviteStatus };
          agent: { id: string; name: string };
          transcript: boolean;
        }>(base, { method: 'POST', body: JSON.stringify({ agentId }) });
        setAgents(
          (list) =>
            list?.map((one) => (one.id === agentId ? { ...one, invite: result.invite } : one)) ??
            list
        );
        setNoTranscript(result.transcript ? '' : result.agent.name);
        void refresh();
        return result;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [base, call, refresh]
  );

  return { agents, any, error, busy, noTranscript, invite, refresh };
}
export type MeetingAgents = ReturnType<typeof useMeetingAgents>;
