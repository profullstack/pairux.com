import { errorResponse, successResponse } from '@/lib/api';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { listOwnedRecordings, toView } from '@/lib/recording-edits/store';
import { sweepStaleEdits } from '@/lib/recording-edits/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/recordings — the caller's recordings and edits, newest first.
export async function GET(request: Request) {
  const user = await requestUser(request);
  if (!user) return errorResponse('Unauthorized', 401);
  const db = serviceClient();
  await sweepStaleEdits(db).catch(() => undefined);
  const rows = await listOwnedRecordings(db, user.id, 100);
  return successResponse({ recordings: rows.map(toView) });
}
