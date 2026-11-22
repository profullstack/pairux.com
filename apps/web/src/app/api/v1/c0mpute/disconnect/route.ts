import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { disconnectUser } from '@/lib/c0mpute-live-store';

export const dynamic = 'force-dynamic';

/**
 * POST from Settings (same-origin fetch; the session cookie is SameSite=Lax).
 * Removes the c0mpute restream destinations and link rows. The streams
 * themselves stay in the user's c0mpute account: no c0mpute credential is kept
 * to delete them with.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const removed = await disconnectUser(serviceClient() as unknown as SupabaseClient, user.id);
    return Response.json({ data: { connected: false, removed } });
  } catch {
    return Response.json({ error: 'Could not disconnect c0mpute Live.' }, { status: 500 });
  }
}
