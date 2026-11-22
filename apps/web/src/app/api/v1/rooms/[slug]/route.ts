import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { getRoomBySlug, publicRoom } from '@/lib/personal-rooms/store';
import { SLUG_PATTERN } from '@/lib/personal-rooms/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/rooms/<slug> — public: who the room belongs to and whether the
// host is in it. The join code comes back only while the room is live and
// unlocked (or to its owner).
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = slug.toLowerCase();
  if (!SLUG_PATTERN.test(s)) return errorResponse('Room not found', 404);
  const db = serviceClient();
  const room = await getRoomBySlug(db, s);
  if (!room) return errorResponse('Room not found', 404);
  const viewer = await requestUser(request).catch(() => null);
  return successResponse({ room: await publicRoom(db, room, viewer?.id ?? null) });
}
