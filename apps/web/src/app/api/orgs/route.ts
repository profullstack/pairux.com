import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { slugify, type OrgRole, type TeamRole } from '@/lib/orgs';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
});

/**
 * GET /api/orgs — the organizations the caller belongs to, with their role and
 * the teams they are in (used by every "where does this belong" picker).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const { data: memberships } = (await db
      .from('org_members')
      .select('role, organizations!inner(id, name, slug, owner_id)')
      .eq('user_id', user.id)) as {
      data:
        | {
            role: OrgRole;
            organizations: { id: string; name: string; slug: string; owner_id: string };
          }[]
        | null;
    };
    const orgs = memberships ?? [];
    const orgIds = orgs.map((m) => m.organizations.id);

    const { data: teams } = (
      orgIds.length
        ? await db.from('teams').select('id, name, org_id').in('org_id', orgIds).order('name')
        : { data: [] }
    ) as { data: { id: string; name: string; org_id: string }[] | null };
    const { data: myTeams } = (await db
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id)) as { data: { team_id: string; role: TeamRole }[] | null };

    return successResponse(
      orgs.map(({ role, organizations: o }) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role,
        teams: (teams ?? [])
          .filter((t) => t.org_id === o.id)
          .map((t) => ({
            id: t.id,
            name: t.name,
            myRole: myTeams?.find((m) => m.team_id === t.id)?.role ?? null,
          })),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST /api/orgs — create an organization; the caller becomes its owner. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const { name } = createSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();

    let slug = slugify(name);
    for (let i = 2; i < 50; i++) {
      const { data: taken } = (await db
        .from('organizations')
        .select('id')
        .ilike('slug', slug)
        .maybeSingle()) as { data: { id: string } | null };
      if (!taken) break;
      slug = `${slugify(name).slice(0, 36)}-${String(i)}`;
    }

    const { data: org, error } = (await db
      .from('organizations')
      .insert({ name, slug, owner_id: user.id } as never)
      .select('id, name, slug')
      .single()) as { data: { id: string; name: string; slug: string } | null; error: unknown };
    if (error || !org) return errorResponse('Could not create the organization', 500);

    const { error: memberError } = await db
      .from('org_members')
      .insert({ org_id: org.id, user_id: user.id, role: 'owner' } as never);
    if (memberError) {
      await db.from('organizations').delete().eq('id', org.id);
      return errorResponse('Could not create the organization', 500);
    }
    return successResponse({ ...org, role: 'owner' as const, teams: [] }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
