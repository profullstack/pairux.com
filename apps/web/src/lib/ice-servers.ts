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

  // Force TCP transport on plain turn: URLs. A UDP TURN relay still rides UDP
  // between the client and the TURN server, so on a multi-homed / dead-NIC host
  // it NAT-rebinds and silently drops a minute or two into a stream — and with
  // "Force relay" (relay-only) there is no fallback candidate, so the publisher
  // dies with "could not establish pc connection". A TCP relay survives the
  // rebind. coturn listens TCP on 3478 and the TCP relay path is solid (the
  // TLS :5349 path is intermittently flaky, so we keep turns: only as a last
  // resort). turns: already rides TCP, so leave it untouched.
  const toTcp = (u: string): string =>
    u.startsWith('turns:') || u.includes('transport=')
      ? u
      : `${u}${u.includes('?') ? '&' : '?'}transport=tcp`;

  const turnUrls = [
    process.env.NEXT_PUBLIC_TURNS_URL,
    process.env.TURN_SERVER_URL ?? process.env.NEXT_PUBLIC_TURN_URL,
    process.env.TURN_SERVER_IP_URL ?? process.env.NEXT_PUBLIC_TURN_IP_URL,
  ]
    .filter((u): u is string => Boolean(u))
    .map(toTcp);

  if (turnUrls.length > 0 && username && credential) {
    servers.push({ urls: turnUrls, username, credential });
  }

  return servers;
}
