import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents } from '@/lib/account-agents';
import { BroadcastError, startBroadcast, startBroadcastSchema } from '@/lib/agent-broadcast';
import { serviceClient } from '@/lib/supabase/service';
import { getIceServers } from '@/lib/ice-servers';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startsByAgent = new FixedWindowRateLimiter(10, 60 * 60_000);

/**
 * POST /api/v1/agent/broadcasts — an agent (Bearer pux_ag_...) goes live on
 * one of its owner's channels: { channel: "moshcoding", title, description? }.
 * Answers the room, its public page and a publish token for it.
 */
export async function POST(request: Request) {
  try {
    const agent = await new AccountAgents().fromRequest(request);
    if (!agent) return errorResponse('Send Authorization: Bearer <pux_ag_ agent key>.', 401);
    const limit = startsByAgent.check(agent.id);
    if (!limit.success) {
      return errorResponse(
        `Too many broadcasts. Try again in ${String(limit.retryAfterSeconds)} seconds.`,
        429
      );
    }
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return errorResponse('LiveKit not configured', 503);

    const input = startBroadcastSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const { broadcast, channel, subject } = await startBroadcast(db, agent, input, {
      apiKey,
      apiSecret,
      url,
    });

    // The same follow-ups a person's go-live gets: subscribers hear about it
    // and the channel's restream destinations pick it up.
    void import('@/lib/notify-live').then(({ notifyGoLive }) =>
      notifyGoLive({
        creator_id: agent.ownerUserId,
        subject,
        join_code: broadcast.joinCode,
        channel_id: channel.id,
        channel_handle: channel.handle,
        channel_name: channel.name,
      })
    );
    void import('@/lib/channel-restream').then(({ startChannelRestream }) =>
      startChannelRestream(broadcast.sessionId, channel.id)
    );

    return successResponse({ ...broadcast, iceServers: await getIceServers() }, 201);
  } catch (error) {
    if (error instanceof BroadcastError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
