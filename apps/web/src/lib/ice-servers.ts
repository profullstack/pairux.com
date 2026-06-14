/**
 * ICE servers (STUN + TURN) handed to LiveKit clients so WebRTC has a relay
 * path. Essential for hosts on restrictive/multi-homed networks (VPNs, virtual
 * adapters, dead secondary NICs) where a direct UDP hole-punch drops mid-session
 * and the publisher dies with "could not establish pc connection".
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getIceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const username = process.env.TURN_SERVER_USERNAME ?? process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.TURN_SERVER_CREDENTIAL ?? process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  // Prefer TURNS (TLS/443-style) first — it tunnels over TCP and survives the
  // NAT rebinding / multi-homing that kills plain UDP. Then UDP TURN, then a
  // raw-IP fallback for when DNS is the problem.
  const turnUrls = [
    process.env.NEXT_PUBLIC_TURNS_URL,
    process.env.TURN_SERVER_URL ?? process.env.NEXT_PUBLIC_TURN_URL,
    process.env.TURN_SERVER_IP_URL ?? process.env.NEXT_PUBLIC_TURN_IP_URL,
  ].filter((u): u is string => Boolean(u));

  if (turnUrls.length > 0 && username && credential) {
    servers.push({ urls: turnUrls, username, credential });
  }

  return servers;
}
