import { useEffect, useRef } from 'react';

/**
 * Stops a running server-side egress when hosting ends.
 *
 * A host publish drop (flaky network / dead secondary NIC) otherwise strands
 * the room-composite egress: LiveKit keeps compositing the now-empty room,
 * burning SFU CPU and pushing dead/frozen frames to every platform until the
 * dead publisher finally times out server-side (minutes later). This stops the
 * egress as soon as the host's connection ends.
 *
 * Fires only on the hosting `true -> false` transition. A user-initiated "stop
 * server stream" clears the egress first (`isServerStreaming -> false`), so this
 * never double-stops, and it never fires before hosting has actually started.
 */
export function useAutoStopServerStream(
  isHosting: boolean,
  isServerStreaming: boolean,
  stopServerStream: () => Promise<unknown>
): void {
  const wasHosting = useRef(false);

  useEffect(() => {
    if (wasHosting.current && !isHosting && isServerStreaming) {
      void stopServerStream();
    }
    wasHosting.current = isHosting;
  }, [isHosting, isServerStreaming, stopServerStream]);
}
