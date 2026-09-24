import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { isOrgAdmin, orgRole } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string; userId: string }>;
}

const patchSchema = z.object({ role: z.enum(['admin', 'member']) });

/** PATCH /api/orgs/[orgId]/members/[userId] — change a member's role (admins). */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { orgId, userId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!isOrgAdmin(await orgRole(db, orgId, user.id))) {
      return errorResponse('Only org admins can change roles', 403);
    }
    const target = await orgRole(db, orgId, userId);
    if (!target) return errorResponse('Member not found', 404);
    if (target === 'owner') return errorResponse('The owner’s role cannot be changed', 400);

    const { role } = patchSchema.parse(await request.json().catch(() => ({})));
    await db
      .from('org_members')
      .update({ role } as never)
      .eq('org_id', orgId)
      .eq('user_id', userId);
    return successResponse({ userId, role });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/orgs/[orgId]/members/[userId] — remove a member (admins), or
 * leave (yourself). The owner cannot leave; they delete the org instead.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { orgId, userId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const myRole = await orgRole(db, orgId, user.id);
    const target = await orgRole(db, orgId, userId);
    if (!myRole || !target) return errorResponse('Member not found', 404);
    if (target === 'owner')
      return errorResponse('The owner cannot leave; delete the organization instead', 400);
    if (userId !== user.id && !isOrgAdmin(myRole)) {
      return errorResponse('Only org admins can remove members', 403);
    }
    if (target === 'admin' && userId !== user.id && myRole !== 'owner') {
      return errorResponse('Only the owner can remove an admin', 403);
    }

    const { data: teams } = (await db.from('teams').select('id').eq('org_id', orgId)) as {
      data: { id: string }[] | null;
    };
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length > 0) {
      await db.from('team_members').delete().eq('user_id', userId).in('team_id', teamIds);
    }
    await db.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId);
    return successResponse({ removed: userId });
  } catch (error) {
    return handleApiError(error);
  }
}
