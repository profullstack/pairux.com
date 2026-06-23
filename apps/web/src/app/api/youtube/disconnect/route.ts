import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse } from '@/lib/api';

/** Remove the current user's stored YouTube credentials. */
export async function POST() {
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) return errorResponse('Authentication required', 401);

  await serviceClient().from('youtube_credentials').delete().eq('user_id', user.id);
  return successResponse({ disconnected: true });
}
