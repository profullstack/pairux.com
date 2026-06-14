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
