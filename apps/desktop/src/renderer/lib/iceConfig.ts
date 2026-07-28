/**
 * WebRTC RTCConfiguration for SFU connections.
 *
 * The web token endpoint returns STUN+TURN iceServers; we pass them through so
 * the publisher has a relay path. "Force relay" (Settings) sets
 * iceTransportPolicy='relay', which routes all media through TURN over the
 * machine's default internet route — essential on hosts with a non-routable
 * secondary NIC (VPN tap, or a dead Ethernet like SIM-card hardware) where a
 * direct UDP candidate is offered but silently drops mid-session.
 */

const SETTINGS_KEY = 'pairux-settings';

export function isForceRelayEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { streaming?: { forceRelay?: boolean } };
    return parsed.streaming?.forceRelay === true;
  } catch {
    return false;
  }
}

/**
 * Whether to offer this machine's tailnet address as a connection candidate.
 *
 * Off by default. Enabling it relaxes Chromium's IP-handling policy to include
 * private interfaces, which is what makes a direct WireGuard path possible —
 * but also re-admits every other private interface, including the dead
 * secondary NICs that "force relay" exists to avoid. Worth it only when peers
 * are genuinely on the same tailnet, and only for P2P sessions: an SFU session
 * connects to the server, which is not on your tailnet, so tailnet candidates
 * are useless there.
 */
export function isPreferTailnetEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { streaming?: { preferTailnet?: boolean } };
    return parsed.streaming?.preferTailnet === true;
  } catch {
    return false;
  }
}

export function buildSfuRtcConfig(iceServers?: RTCIceServer[]): RTCConfiguration {
  const config: RTCConfiguration = {};
  if (iceServers && iceServers.length > 0) {
    config.iceServers = iceServers;
  }
  if (isForceRelayEnabled()) {
    config.iceTransportPolicy = 'relay';
  }
  return config;
}
