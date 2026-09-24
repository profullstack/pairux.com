import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { hashToken, type Db } from '@/lib/orgs';

interface RouteParams {
  params: Promise<{ token: string }>;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: 'admin' | 'member';
  team_id: string | null;
  expires_at: string;
  accepted_at: string | null;
}

async function findInvite(db: Db, token: string) {
  const { data } = (await db
    .from('org_invitations')
    .select('id, org_id, email, role, team_id, expires_at, accepted_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()) as { data: InviteRow | null };
  return data;
}

/** GET /api/org-invitations/[token] — what the invitation is for (no auth needed). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { token } = await params;
    const db = serviceClient();
    const invite = await findInvite(db, token);
    if (!invite || invite.accepted_at)
      return errorResponse('This invitation is no longer valid', 404);

    const { data: org } = (await db
      .from('organizations')
      .select('name')
      .eq('id', invite.org_id)
      .single()) as {
      data: { name: string } | null;
    };
    const { data: team } = (
      invite.team_id
        ? await db.from('teams').select('name').eq('id', invite.team_id).maybeSingle()
        : { data: null }
    ) as { data: { name: string } | null };

    return successResponse({
      orgName: org?.name ?? 'an organization',
      teamName: team?.name ?? null,
      role: invite.role,
      email: invite.email,
      expired: new Date(invite.expires_at).getTime() < Date.now(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/org-invitations/[token] — accept. The signed-in account's email
 * must match the invited address, so a forwarded link cannot be used by
 * someone else.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { token } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Sign in to accept the invitation', 401);

    const db = serviceClient();
    const invite = await findInvite(db, token);
    if (!invite || invite.accepted_at)
      return errorResponse('This invitation is no longer valid', 404);
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return errorResponse('This invitation has expired; ask for a new one', 410);
    }
    if ((user.email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
      return errorResponse(
        `This invitation is for ${invite.email}. Sign in with that address to accept it.`,
        403
      );
    }

    // Keep an existing higher role (an admin re-invited as member stays admin).
    const { data: existing } = (await db
      .from('org_members')
      .select('role')
      .eq('org_id', invite.org_id)
      .eq('user_id', user.id)
      .maybeSingle()) as { data: { role: string } | null };
    if (!existing) {
      await db
        .from('org_members')
        .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role } as never);
    } else if (existing.role === 'member' && invite.role === 'admin') {
      await db
        .from('org_members')
        .update({ role: 'admin' } as never)
        .eq('org_id', invite.org_id)
        .eq('user_id', user.id);
    }
    if (invite.team_id) {
      await db
        .from('team_members')
        .upsert({ team_id: invite.team_id, user_id: user.id, role: 'member' } as never, {
          onConflict: 'team_id,user_id',
          ignoreDuplicates: true,
        });
    }
    await db
      .from('org_invitations')
      .update({ accepted_at: new Date().toISOString() } as never)
      .eq('id', invite.id);

    return successResponse({ orgId: invite.org_id, teamId: invite.team_id });
  } catch (error) {
    return handleApiError(error);
  }
}
