import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { isOrgAdmin, orgRole } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string; inviteId: string }>;
}

/** DELETE /api/orgs/[orgId]/invitations/[inviteId] — revoke an open invitation (admins). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { orgId, inviteId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!isOrgAdmin(await orgRole(db, orgId, user.id))) {
      return errorResponse('Only org admins can revoke invitations', 403);
    }
    await db
      .from('org_invitations')
      .delete()
      .eq('id', inviteId)
      .eq('org_id', orgId)
      .is('accepted_at', null);
    return successResponse({ revoked: inviteId });
  } catch (error) {
    return handleApiError(error);
  }
}
