import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getCliUser } from '@/lib/cli-auth';

/** GET /api/v1/cli/me — who the CLI is signed in as (`pairux whoami`). */
export async function GET(request: Request) {
  try {
    const db = serviceClient();
    const cliUser = await getCliUser(db, request);
    if (!cliUser) return errorResponse('Not signed in', 401);

    const { data: profile } = (await db
      .from('profiles')
      .select('display_name, username')
      .eq('id', cliUser.userId)
      .maybeSingle()) as { data: { display_name: string | null; username: string | null } | null };

    return successResponse({
      userId: cliUser.userId,
      displayName: profile?.display_name ?? null,
      username: profile?.username ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
