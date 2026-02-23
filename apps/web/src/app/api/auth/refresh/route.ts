import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { Database } from '@pairux/shared-types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { refreshToken?: string };
    const { refreshToken } = body;

    if (!refreshToken) {
      return errorResponse('Refresh token is required', 400);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      return errorResponse('Server misconfiguration', 500);
    }

    const supabase = createSupabaseClient<Database>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return errorResponse(error?.message ?? 'Failed to refresh session', 401);
    }

    return successResponse({
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
