import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import {
  ANALYSIS_BUCKET,
  MAX_FRAME_BYTES,
  framePath,
  ownedAnalysis,
} from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ analysisId: string }>;
}

/** Four hours of stills at one every 20 seconds. */
const MAX_FRAMES = 720;

/**
 * PUT /api/analyses/[analysisId]/frames?t=<ms since capture start> — a JPEG
 * still of the shared screen, so the report can comment on what was shown.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const t = Number(new URL(request.url).searchParams.get('t'));
    if (!Number.isFinite(t) || t < 0 || t > 4 * 60 * 60 * 1000) {
      return errorResponse('t must be milliseconds since the capture started', 400);
    }
    if (!(request.headers.get('content-type') ?? '').startsWith('image/jpeg')) {
      return errorResponse('Frames must be image/jpeg', 415);
    }

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const row = await ownedAnalysis(db, analysisId, user.id);
    if (!row) return errorResponse('Analysis not found', 404);
    if (row.status !== 'recording') return errorResponse('This capture has finished', 409);
    if (row.frame_count >= MAX_FRAMES) return successResponse({ stored: false });

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
      return errorResponse('Frame must be between 1 byte and 2 MB', 413);
    }

    const { error } = await db.storage
      .from(ANALYSIS_BUCKET)
      .upload(framePath(analysisId, t), bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) return errorResponse('Could not store the frame', 502);

    await db
      .from('call_analyses')
      .update({
        frame_count: row.frame_count + 1,
        last_upload_at: new Date().toISOString(),
      } as never)
      .eq('id', analysisId);

    return successResponse({ stored: true });
  } catch (error) {
    return handleApiError(error);
  }
}
