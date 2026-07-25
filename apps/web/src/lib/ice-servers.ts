/**
 * ICE servers (STUN + TURN) handed to LiveKit clients so WebRTC has a relay
 * path. Essential for hosts on restrictive/multi-homed networks (VPNs, virtual
 * adapters, dead secondary NICs) where a direct UDP hole-punch drops mid-session
 * and the publisher dies with "could not establish pc connection".
 *
 * Every client — desktop, web and PWA — receives this list from the API rather
 * than hardcoding it, so changes here reach all of them.
 */

import { promises as dns } from 'node:dns';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** How long a resolved TURN address is reused before we look it up again. */
const TURN_IP_TTL_MS = 5 * 60 * 1000;

let cachedTurnIp: { host: string; ip: string; resolvedAt: number } | null = null;

function hostnameFromTurnUrl(url: string): string | null {
  // turn:host:3478?transport=udp / turns:host:5349
  const match = /^turns?:([^:?/]+)/i.exec(url.trim());
  return match?.[1] ?? null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Resolve the TURN hostname here, on the server, and hand clients a raw-IP
 * relay URL alongside the hostname one.
 *
 * Clients on ISPs with unreliable resolvers fail these lookups themselves
 * (ERR_NAME_NOT_RESOLVED on stun/turn hostnames) and end up with no relay path
 * at all. The server's resolver works, so doing it once here gives those
 * clients a candidate that needs no DNS. Only plain `turn:` is emitted for the
 * IP form — a `turns:` URL against an IP literal would fail certificate
 * validation.
 */
async function resolveTurnIpUrl(turnUrls: string[]): Promise<string | null> {
  const source = turnUrls.find((url) => url.toLowerCase().startsWith('turn:'));
  if (!source) return null;

  const host = hostnameFromTurnUrl(source);
  if (!host || isIpLiteral(host)) return null;

  const now = Date.now();
  if (cachedTurnIp?.host === host && now - cachedTurnIp.resolvedAt < TURN_IP_TTL_MS) {
    return `turn:${cachedTurnIp.ip}:3478?transport=udp`;
  }

  try {
    const [ip] = await dns.resolve4(host);
    if (!ip) return null;
    cachedTurnIp = { host, ip, resolvedAt: now };
    return `turn:${ip}:3478?transport=udp`;
  } catch (error) {
    // Never let a failed lookup take down signalling — clients still get the
    // hostname form, which is exactly today's behaviour.
    console.warn('[ICE] Failed to resolve TURN hostname for raw-IP fallback', { host, error });
    return null;
  }
}

export async function getIceServers(): Promise<IceServer[]> {
  const servers: IceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

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
    process.env.TURNS_SERVER_URL,
    process.env.TURN_SERVER_URL ?? process.env.NEXT_PUBLIC_TURN_URL,
    process.env.TURN_SERVER_IP_URL ?? process.env.NEXT_PUBLIC_TURN_IP_URL,
    process.env.TURNS_SERVER_IP_URL,
  ].filter((u): u is string => Boolean(u));

  if (turnUrls.length > 0 && username && credential) {
    const urls = [...new Set(turnUrls)];

    // Add a resolved raw-IP relay unless one was configured explicitly.
    if (!urls.some((url) => isIpLiteral(hostnameFromTurnUrl(url) ?? ''))) {
      const ipUrl = await resolveTurnIpUrl(urls);
      if (ipUrl) urls.push(ipUrl);
    }

    servers.push({ urls, username, credential });
  }

  return servers;
}
