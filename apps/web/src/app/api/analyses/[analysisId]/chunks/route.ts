import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import {
  ANALYSIS_BUCKET,
  MAX_CHUNKS,
  MAX_CHUNK_BYTES,
  chunkPath,
  ownedAnalysis,
} from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ analysisId: string }>;
}

/**
 * PUT /api/analyses/[analysisId]/chunks?run=<ms>&index=N — one chunk of call audio,
 * raw bytes in the body. Chunks may arrive out of order or twice (a retried
 * upload overwrites the same object), so the index is the source of truth.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { analysisId } = await params;
    const search = new URL(request.url).searchParams;
    const index = Number(search.get('index'));
    const run = Number(search.get('run'));
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
      return errorResponse('index must be a chunk number', 400);
    }
    if (!Number.isInteger(run) || run <= 0 || run >= 1e13) {
      return errorResponse('run must be the recorder start time in ms', 400);
    }

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const row = await ownedAnalysis(db, analysisId, user.id);
    if (!row) return errorResponse('Analysis not found', 404);
    if (row.status !== 'recording') return errorResponse('This capture has finished', 409);
    if (row.chunk_count >= MAX_CHUNKS) {
      return errorResponse('This capture hit its 4-hour limit', 409);
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length === 0) return errorResponse('Empty chunk', 400);
    if (bytes.length > MAX_CHUNK_BYTES) return errorResponse('Chunk too large', 413);

    const { error } = await db.storage
      .from(ANALYSIS_BUCKET)
      .upload(chunkPath(analysisId, run, index), bytes, {
        contentType: 'application/octet-stream',
        upsert: true,
      });
    if (error) return errorResponse('Could not store the chunk', 502);

    await db
      .from('call_analyses')
      .update({
        chunk_count: row.chunk_count + 1,
        bytes: row.bytes + bytes.length,
        last_upload_at: new Date().toISOString(),
      } as never)
      .eq('id', analysisId);

    return successResponse({ stored: index });
  } catch (error) {
    return handleApiError(error);
  }
}
