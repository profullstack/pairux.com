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

  // Offer the relay over UDP (turn:3478), TLS (turns:5349) and a raw-IP UDP
  // fallback, and let ICE choose. We previously forced transport=tcp to dodge
  // a UDP relay rebinding on a multi-homed/dead-NIC host, but a TCP-relayed
  // DTLS + data-channel handshake is slow and stalls livekit's publish/connect
  // timeout ("publication timed out" / "could not establish pc connection").
  // UDP relay completes the handshake far more reliably; with the TURN server
  // upgraded to coturn 4.13.1 (valid cert, working TLS), UDP is the better
  // default. Multi-homed hosts can still fall back to TLS/TCP.
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
