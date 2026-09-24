import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { ownedAnalysis } from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ analysisId: string }>;
}

/**
 * POST /api/analyses/[analysisId]/finish — the host's app has uploaded its
 * last chunk. The report job picks it up on its next run (within a minute).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const row = await ownedAnalysis(db, analysisId, user.id);
    if (!row) return errorResponse('Analysis not found', 404);

    if (row.status === 'recording') {
      await db
        .from('call_analyses')
        .update({ status: 'queued', queued_at: new Date().toISOString() } as never)
        .eq('id', analysisId)
        .eq('status', 'recording');
    }
    return successResponse({ status: row.status === 'recording' ? 'queued' : row.status });
  } catch (error) {
    return handleApiError(error);
  }
}
