/**
 * Puts the daemon on the tailnet.
 *
 * The daemon itself only listens on loopback. `tailscale serve` is what makes
 * it reachable, and it is doing two jobs at once:
 *
 *  - a real TLS certificate at https://<device>.<tailnet>.ts.net. The PWA is
 *    served over HTTPS and a browser will not call a plain-HTTP address from
 *    it, so without the certificate none of this works from a phone.
 *  - caller identity headers on every proxied request, which is what the
 *    daemon authenticates against instead of a secret we would have to invent.
 *
 * Every failure here is non-fatal: the daemon still runs, it is simply only
 * reachable from the machine it is on.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TailscaleState {
  installed: boolean;
  /** Logged in and part of a tailnet. */
  connected: boolean;
  /** https://<device>.<tailnet>.ts.net, when known. */
  url: string | null;
  /** This device's tailnet addresses, for a peer to try reaching. */
  ips: string[];
  reason?: string;
}

interface TailscaleStatus {
  BackendState?: string;
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
}

/**
 * Whether a peer can be reached directly, or only through a relay.
 *
 * This is the question that decides whether carrying media over the tailnet is
 * worth doing: a direct WireGuard path is a genuine win, whereas DERP is
 * another relay and buys nothing over the TURN server we already have.
 */
export interface TailnetPathCheck {
  reachable: boolean;
  direct: boolean;
  /** Raw description, e.g. "DERP(lhr)" or "192.0.2.7:41641". */
  via: string | null;
  reason?: string;
}

async function tailscale(args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await run('tailscale', args, { timeout });
  return stdout.trim();
}

export async function getTailscaleState(): Promise<TailscaleState> {
  let raw: string;
  try {
    raw = await tailscale(['status', '--json']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = message.includes('ENOENT');
    return {
      installed: !missing,
      connected: false,
      url: null,
      ips: [],
      reason: missing
        ? 'Tailscale is not installed. See https://tailscale.com/download'
        : `Could not query Tailscale: ${message}`,
    };
  }

  let status: TailscaleStatus;
  try {
    status = JSON.parse(raw) as TailscaleStatus;
  } catch {
    return {
      installed: true,
      connected: false,
      url: null,
      ips: [],
      reason: 'Unreadable tailscale status',
    };
  }

  if (status.BackendState !== 'Running') {
    return {
      installed: true,
      connected: false,
      url: null,
      ips: [],
      reason: `Tailscale is not connected (${status.BackendState ?? 'unknown'}). Run: tailscale up`,
    };
  }

  // DNSName arrives fully qualified, with the trailing dot.
  const dns = (status.Self?.DNSName ?? '').replace(/\.$/, '');
  return {
    installed: true,
    connected: true,
    ips: status.Self?.TailscaleIPs ?? [],
    url: dns ? `https://${dns}` : null,
    ...(dns ? {} : { reason: 'Tailscale is connected but MagicDNS gave no name for this device' }),
  };
}

/**
 * Front the loopback daemon with HTTPS on the tailnet.
 *
 * Idempotent: re-running replaces the existing mapping rather than stacking.
 */
export async function startTailscaleServe(port: number): Promise<TailscaleState> {
  const state = await getTailscaleState();
  if (!state.connected) return state;

  try {
    await tailscale(['serve', '--bg', 'https', '/', `http://127.0.0.1:${String(port)}`], 20_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...state,
      url: null,
      reason:
        `tailscale serve failed: ${message.split('\n')[0] ?? message}. ` +
        'HTTPS serving needs MagicDNS and HTTPS certificates enabled for the tailnet.',
    };
  }

  return state;
}

/** Take the mapping down so a stopped daemon leaves nothing published. */
export async function stopTailscaleServe(): Promise<void> {
  try {
    await tailscale(['serve', '--https=443', 'off'], 10_000);
  } catch {
    // Nothing served, or tailscale is gone — either way there is nothing left
    // to withdraw.
  }
}

/**
 * Is this address one of ours to try? (CGNAT range Tailscale allocates from.)
 *
 * Guards against probing arbitrary addresses a peer might send us.
 */
export function isTailnetAddress(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip.trim());
  if (!m) return false;
  const second = Number(m[1]);
  // 100.64.0.0/10
  return second >= 64 && second <= 127;
}

/**
 * Ask Tailscale whether a peer is reachable, and by what path.
 *
 * `tailscale ping` reports the route it took: an address and port means a
 * direct WireGuard path, DERP means it fell back to a relay.
 */
export async function checkTailnetPath(ip: string): Promise<TailnetPathCheck> {
  if (!isTailnetAddress(ip)) {
    return { reachable: false, direct: false, via: null, reason: 'Not a tailnet address' };
  }

  let output: string;
  try {
    // One probe, short timeout: this is a diagnostic, not a health check.
    output = await tailscale(['ping', '--c', '1', '--timeout', '3s', ip], 8000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reachable: false,
      direct: false,
      via: null,
      reason: message.split('\n')[0] ?? 'ping failed',
    };
  }

  // "pong from name (100.x) via DERP(lhr) in 24ms"
  // "pong from name (100.x) via 192.0.2.7:41641 in 8ms"
  const via = /via ([^\s]+(?:\([^)]*\))?)/.exec(output)?.[1] ?? null;
  const reachable = /pong from/i.test(output);
  const direct = reachable && via !== null && !/^DERP/i.test(via);

  return { reachable, direct, via };
}
