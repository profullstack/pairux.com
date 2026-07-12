/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ commentId: string }>;
}

// DELETE — remove your own comment
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { commentId } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { error } = await (supabase.rpc as any)('delete_comment', {
      p_comment_id: commentId,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
