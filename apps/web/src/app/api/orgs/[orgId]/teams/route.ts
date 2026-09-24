import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { isOrgAdmin, orgRole } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const bodySchema = z.object({ name: z.string().trim().min(2).max(60) });

/** POST /api/orgs/[orgId]/teams — create a team (admins); the creator leads it. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    if (!isOrgAdmin(await orgRole(db, orgId, user.id))) {
      return errorResponse('Only org admins can create teams', 403);
    }
    const { name } = bodySchema.parse(await request.json().catch(() => ({})));
    const { data: team, error } = (await db
      .from('teams')
      .insert({ org_id: orgId, name } as never)
      .select('id, name, created_at')
      .single()) as { data: { id: string; name: string } | null; error: { code?: string } | null };
    if (error?.code === '23505') return errorResponse('A team with that name already exists', 409);
    if (error || !team) return errorResponse('Could not create the team', 500);

    await db
      .from('team_members')
      .insert({ team_id: team.id, user_id: user.id, role: 'lead' } as never);
    return successResponse(team, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
