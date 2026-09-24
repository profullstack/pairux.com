import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { canManageTeam, orgRole, teamInOrg } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

const putSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['lead', 'member']).default('member'),
});
const deleteSchema = z.object({ userId: z.string().uuid() });

async function guard(request: Request, params: RouteParams['params']) {
  const { orgId, teamId } = await params;
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) return { error: errorResponse('Authentication required', 401) } as const;
  const db = serviceClient();
  if (!(await teamInOrg(db, orgId, teamId)))
    return { error: errorResponse('Team not found', 404) } as const;
  const body: unknown = await request.json().catch(() => ({}));
  return { db, orgId, teamId, user, body } as const;
}

/**
 * PUT /api/orgs/[orgId]/teams/[teamId]/members — add an org member to the team
 * or change their team role (team leads, org admins).
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const g = await guard(request, params);
    if ('error' in g) return g.error;
    const { userId, role } = putSchema.parse(g.body);
    if (!(await canManageTeam(g.db, g.orgId, g.teamId, g.user.id))) {
      return errorResponse('Only team leads and org admins can manage the team', 403);
    }
    if (!(await orgRole(g.db, g.orgId, userId))) {
      return errorResponse('Invite them to the organization first', 400);
    }
    await g.db
      .from('team_members')
      .upsert({ team_id: g.teamId, user_id: userId, role } as never, {
        onConflict: 'team_id,user_id',
      });
    return successResponse({ userId, role });
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE — remove someone from the team (leads, org admins, or yourself). */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const g = await guard(request, params);
    if ('error' in g) return g.error;
    const { userId } = deleteSchema.parse(g.body);
    if (userId !== g.user.id && !(await canManageTeam(g.db, g.orgId, g.teamId, g.user.id))) {
      return errorResponse('Only team leads and org admins can manage the team', 403);
    }
    await g.db.from('team_members').delete().eq('team_id', g.teamId).eq('user_id', userId);
    return successResponse({ removed: userId });
  } catch (error) {
    return handleApiError(error);
  }
}
