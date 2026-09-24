/**
 * useSessionAgents — the AI agents currently in a session.
 *
 * Polls GET /api/sessions/[id] (the same roster web and desktop read) and
 * keeps only live participants with kind = 'agent'. Agents join and leave
 * through the PairUX CLI, so a slow poll is plenty. A signed-out guest cannot
 * read the roster; the hook then simply reports no agents.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SessionParticipant } from '@pairux/shared-types';
import { sessionApi } from '@/lib/api/sessions';

export const AGENT_POLL_MS = 10_000;

export function liveAgents(
  participants: SessionParticipant[] | null | undefined
): SessionParticipant[] {
  return (participants ?? []).filter((p) => p.kind === 'agent' && !p.left_at);
}

export function useSessionAgents({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const [agents, setAgents] = useState<SessionParticipant[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    // The roster is a nicety on top of the session: never let it throw.
    const result = await sessionApi.get(sessionId).catch(() => null);
    if (result?.data) setAgents(liveAgents(result.data.session_participants));
  }, [sessionId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, AGENT_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  const removeAgent = useCallback(
    async (participantId: string) => {
      const result = await sessionApi.removeParticipant(sessionId, participantId);
      if (!result.error) setAgents((prev) => prev.filter((a) => a.id !== participantId));
      return result;
    },
    [sessionId]
  );

  return { agents, refresh, removeAgent };
}
