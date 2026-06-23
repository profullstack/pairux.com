/**
 * YouTube Live API helpers — OAuth + auto-transition a stuck "Preparing"
 * broadcast to live.
 *
 * The egress pushes a clean continuous RTMP stream to YouTube, but YouTube
 * leaves the broadcast in `ready`/`testing` ("Preparing stream") until someone
 * clicks "Go Live" (unless Auto-start is on). With the user's YouTube OAuth we
 * can detect that state and call liveBroadcasts.transition → live automatically.
 *
 * Requires env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Redirect URI is derived
 * from NEXT_PUBLIC_APP_URL (or APP_URL), defaulting to https://pairux.com.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_API = 'https://www.googleapis.com/youtube/v3';

// Manage the user's live broadcasts (list + transition).
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

export function youtubeOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://pairux.com';
  return `${base.replace(/\/$/, '')}/api/youtube/callback`;
}

/** Build the Google consent URL. `state` ties the callback back to the user. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: YOUTUBE_SCOPE,
    access_type: 'offline', // get a refresh token
    prompt: 'consent', // force refresh token on re-consent
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

/** Exchange an authorization code for tokens (includes a refresh_token). */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${String(res.status)} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Trade a stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${String(res.status)} ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  return json.access_token;
}

export interface LiveBroadcast {
  id: string;
  lifeCycleStatus: string; // created | ready | testing | live | complete | revoked
  title: string;
}

/**
 * List the user's broadcasts that are waiting to go live (ready/testing).
 * These are the ones stuck on "Preparing".
 */
export async function findTransitionableBroadcasts(accessToken: string): Promise<LiveBroadcast[]> {
  const url =
    `${YT_API}/liveBroadcasts?part=id,snippet,status` +
    `&broadcastStatus=upcoming&maxResults=10&broadcastType=all`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`liveBroadcasts.list failed: ${String(res.status)} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    items?: { id: string; status?: { lifeCycleStatus?: string }; snippet?: { title?: string } }[];
  };
  return (json.items ?? [])
    .map((it) => ({
      id: it.id,
      lifeCycleStatus: it.status?.lifeCycleStatus ?? '',
      title: it.snippet?.title ?? '',
    }))
    .filter((b) => b.lifeCycleStatus === 'ready' || b.lifeCycleStatus === 'testing');
}

/** Transition a broadcast to live. Idempotent-ish: YouTube 4xxs if not ready. */
export async function transitionToLive(accessToken: string, broadcastId: string): Promise<void> {
  const url =
    `${YT_API}/liveBroadcasts/transition` +
    `?part=status&broadcastStatus=live&id=${encodeURIComponent(broadcastId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`liveBroadcasts.transition failed: ${String(res.status)} ${await res.text()}`);
  }
}
