import { errorResponse, successResponse } from '@/lib/api';
import { serviceClient } from '@/lib/supabase/service';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { createSessionSchema } from '@/lib/validations';
import { createSessionFor } from '@/lib/sessions/create';
import { getRoomBySlug, normalizeSettings, roomSession } from '@/lib/personal-rooms/store';
import { SLUG_PATTERN } from '@/lib/personal-rooms/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/v1/rooms/<slug>/start — the owner opens their room: resume its
// session if it has not ended, otherwise start a new one bound to the room.
// Uses the owner's own Supabase auth (create_session reads auth.uid()), so it
// takes a session cookie or a Supabase Bearer token, not a CLI token.
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = slug.toLowerCase();
  if (!SLUG_PATTERN.test(s)) return errorResponse('Room not found', 404);

  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) return errorResponse('Authentication required', 401);

  const db = serviceClient();
  const room = await getRoomBySlug(db, s);
  if (room?.owner_id !== user.id) return errorResponse('Room not found', 404);

  const existing = await roomSession(db, room);
  if (existing) return successResponse({ session: existing, resumed: true });

  const settings = normalizeSettings(room.settings);
  const result = await createSessionFor(
    supabase,
    user.id,
    createSessionSchema.parse({ mode: settings.mode, allowGuestControl: false })
  );
  if (!result.ok) return errorResponse(result.error, result.status);
  await db
    .from('personal_rooms')
    .update({ current_session_id: result.session.id } as never)
    .eq('id', room.id);
  return successResponse({ session: result.session, resumed: false }, 201);
}
