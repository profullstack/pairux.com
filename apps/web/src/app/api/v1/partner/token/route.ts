import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getIceServers } from '@/lib/ice-servers';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { authenticatePartner, partnerRoomName } from '@/lib/partners';

/**
 * POST /api/v1/partner/token: a partner app's SERVER mints a LiveKit token for
 * one of its users, for an end-to-end encrypted call run with
 * @profullstack/pairux-embed. See src/lib/partners.ts.
 *
 *   Authorization: Bearer pux_pk_…
 *   { "room": "<partner's room id>", "identity": "<partner's user id>", "name": "Alice" }
 *   -> { token, url, roomName, iceServers, e2ee: true }
 *
 * The media key never comes here: partners share it between participants
 * themselves, so PairUX forwards only ciphertext.
 */
const requestsByIp = new FixedWindowRateLimiter(60, 60_000);
const requestsByPartner = new FixedWindowRateLimiter(600, 60_000);

const bodySchema = z.object({
  room: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'room: 1-64 letters, digits, _ or -'),
  identity: z.string().regex(/^[A-Za-z0-9_.:@-]{1,64}$/, 'identity: 1-64 safe characters'),
  name: z.string().trim().min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const ipLimit = requestsByIp.check(getClientIp(request));
    if (!ipLimit.success) {
      return errorResponse(
        `Too many requests. Try again in ${String(ipLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const partner = authenticatePartner(request);
    if (!partner) return errorResponse('Unknown or missing partner key', 401);

    const partnerLimit = requestsByPartner.check(partner.id);
    if (!partnerLimit.success) {
      return errorResponse(
        `Too many requests. Try again in ${String(partnerLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return errorResponse('LiveKit not configured', 503);

    const body: unknown = await request.json().catch(() => ({}));
    const { room, identity, name } = bodySchema.parse(body);
    const roomName = partnerRoomName(partner, room);

    const token = new AccessToken(apiKey, apiSecret, {
      // Namespaced so two partners' user ids can never collide in a room.
      identity: `${partner.id}:${identity}`,
      name,
      ttl: '6h',
      metadata: JSON.stringify({ partner: partner.id, e2ee: true }),
    });
    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    };
    token.addGrant(grant);

    return successResponse({
      token: await token.toJwt(),
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      roomName,
      maxParticipants: partner.maxParticipants,
      iceServers: await getIceServers(),
      e2ee: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
