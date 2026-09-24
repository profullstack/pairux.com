import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

/**
 * GET /api/analyses — call analyses the caller may read, newest first: their
 * own, plus those of calls held in their teams and organizations. Read with
 * the caller's own client so the table's RLS policy (can_use_resource)
 * decides visibility, the same rule a direct link is held to.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const { data, error } = (await supabase
      .from('call_analyses')
      .select(
        'id, session_id, host_user_id, org_id, team_id, kind, title, status, source, duration_seconds, error, created_at, completed_at, report->>headline, report->>overallScore'
      )
      .order('created_at', { ascending: false })
      .limit(100)) as { data: Record<string, unknown>[] | null; error: unknown };
    if (error) return errorResponse('Could not load analyses', 500);

    return successResponse(
      (data ?? []).map((row) => ({
        ...row,
        mine: row.host_user_id === user.id,
        overallScore: row.overallScore == null ? null : Number(row.overallScore),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}
