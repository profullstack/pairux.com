import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { isOrgAdmin, listMembers, orgRole, resolveUserPlan } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * GET /api/orgs/[orgId] — the org page: members (with roles and teams),
 * teams, open invitations (admins only) and the plan the org provides.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const role = await orgRole(db, orgId, user.id);
    if (!role) return errorResponse('Organization not found', 404);

    const { data: org } = (await db
      .from('organizations')
      .select('id, name, slug, owner_id, created_at')
      .eq('id', orgId)
      .single()) as { data: { id: string; name: string; slug: string; owner_id: string } | null };
    if (!org) return errorResponse('Organization not found', 404);

    const { data: teams } = (await db
      .from('teams')
      .select('id, name, created_at')
      .eq('org_id', orgId)
      .order('name')) as { data: { id: string; name: string }[] | null };

    const invitations = isOrgAdmin(role)
      ? ((
          await db
            .from('org_invitations')
            .select('id, email, role, team_id, expires_at, created_at')
            .eq('org_id', orgId)
            .is('accepted_at', null)
            .order('created_at', { ascending: false })
        ).data ?? [])
      : [];

    return successResponse({
      ...org,
      myRole: role,
      plan: await resolveUserPlan(db, org.owner_id),
      members: await listMembers(db, orgId),
      teams: teams ?? [],
      invitations,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const patchSchema = z.object({ name: z.string().trim().min(2).max(80) });

/** PATCH /api/orgs/[orgId] — rename (admins). */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!isOrgAdmin(await orgRole(db, orgId, user.id))) {
      return errorResponse('Only org admins can rename the organization', 403);
    }
    const { name } = patchSchema.parse(await request.json().catch(() => ({})));
    await db
      .from('organizations')
      .update({ name, updated_at: new Date().toISOString() } as never)
      .eq('id', orgId);
    return successResponse({ id: orgId, name });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/orgs/[orgId] — the owner deletes the org. Its channels, rooms
 * and reports fall back to their personal owners (org_id/team_id set null).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if ((await orgRole(db, orgId, user.id)) !== 'owner') {
      return errorResponse('Only the owner can delete the organization', 403);
    }
    await db.from('organizations').delete().eq('id', orgId);
    return successResponse({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
