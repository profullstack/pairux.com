import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { canManageTeam, isOrgAdmin, orgRole, teamInOrg } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

const patchSchema = z.object({ name: z.string().trim().min(2).max(60) });

/** PATCH /api/orgs/[orgId]/teams/[teamId] — rename (team leads, org admins). */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { orgId, teamId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!(await teamInOrg(db, orgId, teamId))) return errorResponse('Team not found', 404);
    if (!(await canManageTeam(db, orgId, teamId, user.id))) {
      return errorResponse('Only team leads and org admins can rename the team', 403);
    }
    const { name } = patchSchema.parse(await request.json().catch(() => ({})));
    const { error } = (await db
      .from('teams')
      .update({ name } as never)
      .eq('id', teamId)) as {
      error: { code?: string } | null;
    };
    if (error?.code === '23505') return errorResponse('A team with that name already exists', 409);
    return successResponse({ id: teamId, name });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/orgs/[orgId]/teams/[teamId] — delete a team (org admins). Its
 * channels, rooms and reports stay in the org (team_id set null).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { orgId, teamId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!isOrgAdmin(await orgRole(db, orgId, user.id))) {
      return errorResponse('Only org admins can delete teams', 403);
    }
    await db.from('teams').delete().eq('id', teamId).eq('org_id', orgId);
    return successResponse({ deleted: teamId });
  } catch (error) {
    return handleApiError(error);
  }
}
