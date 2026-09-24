/**
 * Organizations and teams: membership lookups, role checks, invitations and
 * the plan a member is covered by.
 *
 * Roles
 *   org:  owner (one) > admin > member
 *   team: lead > member (org admins can do anything a lead can)
 *
 * Writes go through the service-role client after an explicit role check
 * here; members read through RLS (see migration 20260924180000).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectivePlan, type Plan } from '@pairux/shared-types';

export type Db = SupabaseClient;
export type OrgRole = 'owner' | 'admin' | 'member';
export type TeamRole = 'lead' | 'member';

export const INVITE_TTL_DAYS = 14;

export function isOrgAdmin(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

/** URL-safe slug from a name: "Profullstack, Inc." -> "profullstack-inc". */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : `org-${randomBytes(3).toString('hex')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function orgRole(db: Db, orgId: string, userId: string): Promise<OrgRole | null> {
  const { data } = (await db
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { role: OrgRole } | null };
  return data?.role ?? null;
}

export async function teamInOrg(
  db: Db,
  orgId: string,
  teamId: string
): Promise<{ id: string; name: string } | null> {
  const { data } = (await db
    .from('teams')
    .select('id, name')
    .eq('id', teamId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string; name: string } | null };
  return data;
}

export async function teamRole(db: Db, teamId: string, userId: string): Promise<TeamRole | null> {
  const { data } = (await db
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { role: TeamRole } | null };
  return data?.role ?? null;
}

/** Org admins and the team's leads may manage a team. */
export async function canManageTeam(
  db: Db,
  orgId: string,
  teamId: string,
  userId: string
): Promise<boolean> {
  if (isOrgAdmin(await orgRole(db, orgId, userId))) return true;
  return (await teamRole(db, teamId, userId)) === 'lead';
}

/**
 * Whether a user may put a session (or channel, or report) in this workspace:
 * any org member for an org-wide workspace; for a team, its members and the
 * org's admins.
 */
export async function canUseWorkspace(
  db: Db,
  userId: string,
  orgId: string | null | undefined,
  teamId: string | null | undefined
): Promise<{ orgId: string | null; teamId: string | null } | null> {
  if (!orgId && !teamId) return { orgId: null, teamId: null };
  if (teamId) {
    const { data: team } = (await db
      .from('teams')
      .select('id, org_id')
      .eq('id', teamId)
      .maybeSingle()) as {
      data: { id: string; org_id: string } | null;
    };
    if (!team || (orgId && orgId !== team.org_id)) return null;
    const role = await orgRole(db, team.org_id, userId);
    if (!role) return null;
    if (isOrgAdmin(role) || (await teamRole(db, teamId, userId))) {
      return { orgId: team.org_id, teamId };
    }
    return null;
  }
  if (!orgId) return null;
  return (await orgRole(db, orgId, userId)) ? { orgId, teamId: null } : null;
}

/**
 * The plan in effect for a user: the best of their own plan and the plan of
 * every org they belong to. Falls back to the personal plan if the database
 * function is missing (for example before the migration is applied).
 */
export async function resolveUserPlan(db: Db, userId: string): Promise<Plan> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  const { data, error } = await (db.rpc as any)('user_effective_plan', { p_user: userId });
  if (!error && typeof data === 'string') return data as Plan;
  const { data: profile } = (await db
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle()) as { data: { plan: Plan; plan_expires_at: string | null } | null };
  return effectivePlan(profile?.plan ?? 'free', profile?.plan_expires_at ?? null);
}

export interface MemberView {
  userId: string;
  role: OrgRole;
  displayName: string | null;
  username: string | null;
  email: string | null;
  teams: { teamId: string; role: TeamRole }[];
}

/** Members with names and emails, for the org page (members only). */
export async function listMembers(db: Db, orgId: string): Promise<MemberView[]> {
  const { data: rows } = (await db
    .from('org_members')
    .select('user_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })) as {
    data: { user_id: string; role: OrgRole }[] | null;
  };
  const members = rows ?? [];
  if (members.length === 0) return [];
  const ids = members.map((m) => m.user_id);
  const { data: profiles } = (await db
    .from('profiles')
    .select('id, display_name, username')
    .in('id', ids)) as {
    data: { id: string; display_name: string | null; username: string | null }[] | null;
  };
  const { data: teamRows } = (await db
    .from('team_members')
    .select('team_id, user_id, role, teams!inner(org_id)')
    .eq('teams.org_id', orgId)
    .in('user_id', ids)) as { data: { team_id: string; user_id: string; role: TeamRole }[] | null };
  const emails = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      emails.set(id, data.user?.email ?? null);
    })
  );
  return members.map((m) => {
    const profile = profiles?.find((p) => p.id === m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      displayName: profile?.display_name ?? null,
      username: profile?.username ?? null,
      email: emails.get(m.user_id) ?? null,
      teams: (teamRows ?? [])
        .filter((t) => t.user_id === m.user_id)
        .map((t) => ({ teamId: t.team_id, role: t.role })),
    };
  });
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://pairux.com';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

export async function sendInviteEmail(args: {
  to: string;
  orgName: string;
  inviterName: string | null;
  teamName: string | null;
  token: string;
}): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return;
  const { createEmailer } = await import('@profullstack/emailer');
  const emailer = createEmailer({
    resendApiKey,
    defaultFrom: process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>',
  }) as { send: (o: unknown) => Promise<unknown> };
  const url = `${appUrl()}/orgs/invite/${args.token}`;
  const who = args.inviterName
    ? `${escapeHtml(args.inviterName)} invited you`
    : 'You have been invited';
  const team = args.teamName ? ` and its <strong>${escapeHtml(args.teamName)}</strong> team` : '';
  await emailer.send({
    to: args.to,
    subject: `Join ${args.orgName} on PairUX`,
    html: `<p>${who} to join <strong>${escapeHtml(args.orgName)}</strong>${team} on PairUX.</p>
<p>Members share channels to go live on, call analysis reports and the organization's plan.</p>
<p><a href="${url}">Accept the invitation</a> (sign in with this email address). The link expires in ${String(INVITE_TTL_DAYS)} days.</p>`,
  });
}
