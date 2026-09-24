import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { ANALYSIS_BUCKET, deleteAnalysisFiles, type AnalysisRow } from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ analysisId: string }>;
}

/**
 * GET /api/analyses/[analysisId] — one report with its transcript and
 * metrics, plus a one-hour link to the recording when it was kept.
 * Visible to the host and, for team or org calls, to that team or org only:
 * the row is read with the caller's client, so RLS enforces it.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const { data: row } = (await supabase
      .from('call_analyses')
      .select('*')
      .eq('id', analysisId)
      .maybeSingle()) as { data: AnalysisRow | null };
    if (!row) return errorResponse('Analysis not found', 404);

    let recordingUrl: string | null = null;
    if (row.recording_path) {
      const { data } = await serviceClient()
        .storage.from(ANALYSIS_BUCKET)
        .createSignedUrl(row.recording_path, 60 * 60);
      recordingUrl = data?.signedUrl ?? null;
    }
    return successResponse({ ...row, mine: row.host_user_id === user.id, recordingUrl });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/analyses/[analysisId] — the report, transcript and recording.
 * The host, the org's admins, or the team's leads.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const { data: row } = (await db
      .from('call_analyses')
      .select('id, host_user_id, org_id, team_id, status')
      .eq('id', analysisId)
      .maybeSingle()) as {
      data:
        | (Pick<AnalysisRow, 'id' | 'host_user_id' | 'status'> & {
            org_id: string | null;
            team_id: string | null;
          })
        | null;
    };
    if (!row) return errorResponse('Analysis not found', 404);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data: canManage } = await (db.rpc as any)('can_manage_resource', {
      p_owner: row.host_user_id,
      p_org: row.org_id,
      p_team: row.team_id,
      p_user: user.id,
    });
    if (canManage !== true) return errorResponse('Analysis not found', 404);
    if (row.status === 'processing') {
      return errorResponse('This report is being written; delete it when it is done', 409);
    }

    await deleteAnalysisFiles(db, row.id);
    await db.from('call_analyses').delete().eq('id', row.id);
    return successResponse({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
