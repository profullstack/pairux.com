import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import {
  RoomError,
  deleteRoom,
  getOwnedRoom,
  toView,
  updateRoom,
} from '@/lib/personal-rooms/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ID = /^[0-9A-Za-z-]{1,64}$/;
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
interface Ctx {
  params: Promise<{ roomId: string }>;
}

function fail(e: unknown) {
  if (e instanceof RoomError) return errorResponse(e.message, e.status);
  throw e;
}

export async function GET(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { roomId } = await params;
  if (!VALID_ID.test(roomId)) return errorResponse('Room not found', 404);
  const room = await getOwnedRoom(serviceClient(), user.id, roomId);
  if (!room) return errorResponse('Room not found', 404);
  return successResponse({ room: toView(room, origin()) });
}

// PATCH { name?, slug?, settings?: { mode?, locked? }, is_default?: true }
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { roomId } = await params;
  if (!VALID_ID.test(roomId)) return errorResponse('Room not found', 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse('Send a JSON body', 400);
  try {
    const room = await updateRoom(serviceClient(), user.id, roomId, body);
    return successResponse({ room: toView(room, origin()) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { roomId } = await params;
  if (!VALID_ID.test(roomId)) return errorResponse('Room not found', 404);
  try {
    await deleteRoom(serviceClient(), user.id, roomId);
    return successResponse({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
