import { serviceClient } from '@/lib/supabase/service';
import {
  refreshAccessToken,
  findTransitionableBroadcasts,
  transitionToLive,
  youtubeOAuthConfigured,
} from '@/lib/youtube';

/** How long/often to poll for a broadcast that's ready to go live. */
const POLL_INTERVAL_MS = 6_000;
const MAX_ATTEMPTS = 15; // ~90s — enough for YouTube to ingest + reach "ready"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fetch a user's stored YouTube refresh token, or null if not connected. */
async function getRefreshToken(userId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('youtube_credentials')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle();
  const token = (data as { refresh_token?: string } | null)?.refresh_token;
  return token ?? null;
}

/**
 * Best-effort: after egress starts pushing to YouTube, poll the user's
 * broadcasts and transition the first ready/testing one to live — so it never
 * sits on "Preparing stream". Fire-and-forget; never throws.
 */
export async function autoTransitionYouTube(userId: string): Promise<void> {
  try {
    if (!youtubeOAuthConfigured()) return;

    const refreshToken = await getRefreshToken(userId);
    if (!refreshToken) return; // user hasn't connected YouTube

    const accessToken = await refreshAccessToken(refreshToken);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const [first] = await findTransitionableBroadcasts(accessToken);
      if (first) {
        await transitionToLive(accessToken, first.id);
        console.log(`[youtube] transitioned broadcast ${first.id} to live for user ${userId}`);
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    console.warn(`[youtube] no ready broadcast to transition for user ${userId} after polling`);
  } catch (err) {
    console.warn('[youtube] auto-transition failed:', err);
  }
}
