/**
 * The tailnet handshake, from the side that starts it.
 *
 * A viewer opens with its own tailnet addresses as soon as its data channel is
 * usable; the host answers with its own and runs `tailscale ping` against what
 * it received. The viewer starts it because the viewer is the side that knows
 * exactly when it can send — the host would otherwise be guessing at when a
 * channel it did not open became ready.
 *
 * Only a native peer can take part: a browser has no way to learn its own
 * tailnet address, so it simply never opens, and the host draws no conclusion.
 */

import { getElectronAPI } from '@/lib/ipc';

export interface TailnetHelloMessage {
  type: 'tailnet-hello';
  participantId: string;
  ips: string[];
  reply: boolean;
  timestamp: number;
}

export function buildTailnetHello(
  participantId: string,
  ips: string[],
  reply: boolean
): TailnetHelloMessage {
  return { type: 'tailnet-hello', participantId, ips, reply, timestamp: Date.now() };
}

/**
 * Announce this machine's tailnet addresses, if it has any.
 *
 * Never throws and never reports failure: this is a diagnostic, and a session
 * that works must not be disturbed by one that cannot be measured.
 */
export async function announceTailnet(
  participantId: string,
  send: (message: TailnetHelloMessage) => void
): Promise<void> {
  try {
    const info = await getElectronAPI().invoke('tailscale:info', undefined);
    if (info.ips.length === 0) return;
    send(buildTailnetHello(participantId, info.ips, false));
  } catch {
    // No Tailscale, or no answer from it. Nothing to announce.
  }
}
