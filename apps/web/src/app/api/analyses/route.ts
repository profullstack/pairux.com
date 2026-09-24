import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

/** GET /api/analyses — the signed-in host's call analyses, newest first. */
export async function GET() {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const { data, error } = (await serviceClient()
      .from('call_analyses')
      .select(
        'id, session_id, kind, title, status, source, duration_seconds, error, created_at, completed_at, report->>headline, report->>overallScore'
      )
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)) as { data: Record<string, unknown>[] | null; error: unknown };
    if (error) return errorResponse('Could not load analyses', 500);

    return successResponse(
      (data ?? []).map((row) => ({
        ...row,
        overallScore: row.overallScore == null ? null : Number(row.overallScore),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}
