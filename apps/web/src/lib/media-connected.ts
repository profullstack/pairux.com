/**
 * Tell the server this viewer is watching real frames from the host.
 *
 * Fire-and-forget: it records the session's activation signal
 * (sessions.connected_at, status 'active') and must never disturb playback.
 */
export function reportMediaConnected(sessionId: string, participantId: string | null): void {
  void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/connected`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(participantId ? { participantId } : {}),
    keepalive: true,
  }).catch(() => {
    // Best effort; the viewer is already watching.
  });
}
