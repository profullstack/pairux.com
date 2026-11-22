import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { getOwnedRecording, toView } from '@/lib/recording-edits/store';
import { RecordingEditError, deleteEdit } from '@/lib/recording-edits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ recordingId: string }>;
}

// GET /api/v1/recordings/:id — one of the caller's recordings (poll an edit here).
export async function GET(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { recordingId } = await params;
  const row = await getOwnedRecording(serviceClient(), user.id, recordingId);
  if (!row) return errorResponse('Recording not found', 404);
  return successResponse({ recording: { ...toView(row), edit_plan: row.edit_plan ?? null } });
}

// DELETE /api/v1/recordings/:id — delete one of the caller's edits (never an original).
export async function DELETE(request: Request, { params }: Ctx) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const { recordingId } = await params;
  try {
    await deleteEdit(serviceClient(), user.id, recordingId);
    return successResponse({ deleted: recordingId });
  } catch (error) {
    if (error instanceof RecordingEditError) return errorResponse(error.message, error.status);
    console.error('[recordings] delete failed:', error);
    return errorResponse('Could not delete', 500);
  }
}
