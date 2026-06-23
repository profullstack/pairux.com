import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse } from '@/lib/api';
import { youtubeOAuthConfigured } from '@/lib/youtube';

/** Whether the current user has connected YouTube (token never exposed). */
export async function GET() {
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) return errorResponse('Authentication required', 401);

  const { data } = await serviceClient()
    .from('youtube_credentials')
    .select('user_id, channel_title')
    .eq('user_id', user.id)
    .maybeSingle();

  return successResponse({
    configured: youtubeOAuthConfigured(),
    connected: Boolean(data),
    channelTitle: (data as { channel_title?: string } | null)?.channel_title ?? null,
  });
}
