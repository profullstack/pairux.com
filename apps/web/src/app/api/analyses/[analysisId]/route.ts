import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { ANALYSIS_BUCKET, deleteAnalysisFiles, ownedAnalysis } from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ analysisId: string }>;
}

/**
 * GET /api/analyses/[analysisId] — one report with its transcript and
 * metrics, plus a one-hour link to the recording when it was kept.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const row = await ownedAnalysis(db, analysisId, user.id);
    if (!row) return errorResponse('Analysis not found', 404);

    let recordingUrl: string | null = null;
    if (row.recording_path) {
      const { data } = await db.storage
        .from(ANALYSIS_BUCKET)
        .createSignedUrl(row.recording_path, 60 * 60);
      recordingUrl = data?.signedUrl ?? null;
    }
    return successResponse({ ...row, recordingUrl });
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE /api/analyses/[analysisId] — the report, transcript and recording. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const row = await ownedAnalysis(db, analysisId, user.id);
    if (!row) return errorResponse('Analysis not found', 404);
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
