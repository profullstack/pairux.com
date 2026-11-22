import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { toView } from '@/lib/recording-edits/store';
import { RecordingEditError, createEdit } from '@/lib/recording-edits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ recordingId: string }>;
}

/**
 * POST /api/v1/recordings/:id/edits — body { plan: EditPlan, subject? }.
 * Starts rendering a new recording cut from this one and answers 202 with the
 * new row (status 'processing'); poll GET /api/v1/recordings/<new id>.
 */
export async function POST(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { recordingId } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return errorResponse('Send a JSON body with a plan', 400);
  try {
    const row = await createEdit(serviceClient(), user.id, recordingId, body);
    return successResponse({ recording: toView(row) }, 202);
  } catch (error) {
    if (error instanceof RecordingEditError) return errorResponse(error.message, error.status);
    console.error('[recordings] edit failed:', error);
    return errorResponse('Could not start the edit', 500);
  }
}
