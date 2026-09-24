import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import {
  INVITE_TTL_DAYS,
  hashToken,
  isOrgAdmin,
  newInviteToken,
  orgRole,
  sendInviteEmail,
  teamInOrg,
} from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const invitesByOrg = new FixedWindowRateLimiter(50, 60 * 60 * 1000);

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(['admin', 'member']).default('member'),
  teamId: z.string().uuid().optional(),
});

/**
 * POST /api/orgs/[orgId]/invitations — invite someone by email (admins).
 * Re-inviting the same address replaces the open invitation with a new link.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const db = serviceClient();
    const myRole = await orgRole(db, orgId, user.id);
    if (!isOrgAdmin(myRole)) return errorResponse('Only org admins can invite people', 403);
    if (!invitesByOrg.check(orgId).success)
      return errorResponse('Too many invitations; try again later', 429);

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    if (body.role === 'admin' && myRole !== 'owner') {
      return errorResponse('Only the owner can invite admins', 403);
    }
    const team = body.teamId ? await teamInOrg(db, orgId, body.teamId) : null;
    if (body.teamId && !team) return errorResponse('Team not found', 404);

    const { data: org } = (await db
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single()) as {
      data: { name: string } | null;
    };
    if (!org) return errorResponse('Organization not found', 404);

    await db
      .from('org_invitations')
      .delete()
      .eq('org_id', orgId)
      .ilike('email', body.email)
      .is('accepted_at', null);

    const token = newInviteToken();
    const { data: invite, error } = (await db
      .from('org_invitations')
      .insert({
        org_id: orgId,
        email: body.email,
        role: body.role,
        team_id: team?.id ?? null,
        token_hash: hashToken(token),
        invited_by: user.id,
        expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
      } as never)
      .select('id, email, role, team_id, expires_at, created_at')
      .single()) as { data: Record<string, unknown> | null; error: unknown };
    if (error || !invite) return errorResponse('Could not create the invitation', 500);

    const { data: inviter } = (await db
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()) as { data: { display_name: string | null; username: string | null } | null };
    await sendInviteEmail({
      to: body.email,
      orgName: org.name,
      inviterName: inviter?.display_name ?? inviter?.username ?? null,
      teamName: team?.name ?? null,
      token,
    }).catch((e: unknown) => {
      console.error('[orgs] invite email failed:', e);
    });

    return successResponse(invite, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
