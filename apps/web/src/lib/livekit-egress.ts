import { EgressClient } from 'livekit-server-sdk';

function normalizeLiveKitServiceUrl(url: string): string {
  if (url.startsWith('wss://')) return `https://${url.slice('wss://'.length)}`;
  if (url.startsWith('ws://')) return `http://${url.slice('ws://'.length)}`;
  return url;
}

/** Egress client for server-side RTMP restreaming, or null when unconfigured. */
export function getEgressClient(): EgressClient | null {
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) return null;
  return new EgressClient(normalizeLiveKitServiceUrl(livekitUrl), apiKey, apiSecret);
}
