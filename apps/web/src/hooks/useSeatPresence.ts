'use client';

import { useEffect } from 'react';

/** How often a viewer says it is still in the room (well inside the 3 min seat window). */
export const SEAT_PING_MS = 30_000;

/**
 * Keep this viewer's plan seat while the page is open: POST
 * /api/sessions/<id>/presence every 30 s. A row that stops pinging frees its
 * seat after SEAT_PRESENCE_SECONDS, so a closed tab never holds a Free room's
 * second seat. Best effort: a failed ping is retried on the next tick.
 */
export function useSeatPresence(
  sessionId: string | null | undefined,
  participantId?: string | null
) {
  useEffect(() => {
    if (!sessionId) return;
    const ping = () => {
      void fetch(`/api/sessions/${sessionId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(participantId ? { participantId } : {}),
        keepalive: true,
      }).catch(() => {
        // Offline for a moment: the next tick tries again.
      });
    };
    ping();
    const timer = setInterval(ping, SEAT_PING_MS);
    return () => {
      clearInterval(timer);
    };
  }, [sessionId, participantId]);
}
