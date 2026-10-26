import { serviceClient } from '@/lib/supabase/service';
import { getCliUser } from '@/lib/cli-auth';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The signed-in user behind a request, however it arrived: a `pairux` CLI
 * token (Bearer pux_at_...), a Supabase access token (desktop/mobile Bearer)
 * or the web session cookie.
 */
export async function requestUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  if (/^Bearer\s+pux_at_/.test(header)) {
    const cli = await getCliUser(serviceClient() as unknown as SupabaseClient, request);
    return cli ? { id: cli.userId } : null;
  }
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  return user ? { id: user.id } : null;
}

/** Whether a user is a PairUX admin (admin_users, as /admin checks). */
export async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = (await (serviceClient() as unknown as SupabaseClient)
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()) as { data: unknown };
  return Boolean(data);
}
