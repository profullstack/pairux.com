import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getIceServers } from '@/lib/ice-servers';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import {
  ANON_ROOM_MAX_PARTICIPANTS,
  ROOM_ID_RE,
  anonRoomName,
  liveKitServiceUrl,
} from '@/lib/anon-rooms';

/**
 * POST /api/v1/rooms/token: a LiveKit token for an anonymous, end-to-end
 * encrypted room (see src/lib/anon-rooms.ts). No account: knowing the room id
 * is the only credential, and the media key never comes here.
 *
 *   { "room": "<22-64 base64url chars>", "name": "Alice" }
 *   -> { token, url, roomName, iceServers, e2ee: true }
 */
const requestsByIp = new FixedWindowRateLimiter(20, 60_000);

const bodySchema = z.object({
  room: z.string().regex(ROOM_ID_RE, 'room: 22-64 letters, digits, _ or -'),
  name: z.string().trim().min(1).max(50),
});

async function participantCount(roomName: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) return 0;
  try {
    const svc = new RoomServiceClient(
      liveKitServiceUrl(url),
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET
    );
    return (await svc.listParticipants(roomName)).length;
  } catch {
    // A room that does not exist yet has nobody in it.
    return 0;
  }
}

export async function POST(request: Request) {
  try {
    const ipLimit = requestsByIp.check(getClientIp(request));
    if (!ipLimit.success) {
      return errorResponse(
        `Too many requests. Try again in ${String(ipLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return errorResponse('LiveKit not configured', 503);

    const body: unknown = await request.json().catch(() => ({}));
    const { room, name } = bodySchema.parse(body);
    const roomName = anonRoomName(room);

    if ((await participantCount(roomName)) >= ANON_ROOM_MAX_PARTICIPANTS) {
      return errorResponse('This room is full', 409);
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: `anon:${randomUUID()}`,
      name,
      ttl: '6h',
      metadata: JSON.stringify({ anon: true, e2ee: true }),
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
      maxParticipants: ANON_ROOM_MAX_PARTICIPANTS,
      iceServers: await getIceServers(),
      e2ee: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
