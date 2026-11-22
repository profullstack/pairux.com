import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { RoomError, createRoom, listRooms, toView } from '@/lib/personal-rooms/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const creates = new FixedWindowRateLimiter(20, 60 * 60_000);
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';

// GET /api/v1/me/rooms — the caller's personal rooms, default first.
export async function GET(request: Request) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const rows = await listRooms(serviceClient(), user.id);
  return successResponse({ rooms: rows.map((r) => toView(r, origin())) });
}

// POST /api/v1/me/rooms { name, slug?, settings?, is_default? } — add a room.
export async function POST(request: Request) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  if (!creates.check(user.id).success) return errorResponse('Too many new rooms; try later', 429);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse('Send a JSON body', 400);
  try {
    const room = await createRoom(serviceClient(), user.id, body);
    return successResponse({ room: toView(room, origin()) }, 201);
  } catch (e) {
    if (e instanceof RoomError) return errorResponse(e.message, e.status);
    throw e;
  }
}
