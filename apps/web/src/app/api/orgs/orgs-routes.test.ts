import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';
import { hashToken, slugify, isOrgAdmin } from '@/lib/orgs';

let db: ReturnType<typeof createMemoryDb>;
let currentUser: { id: string; email: string } | null;

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({}),
  getAuthenticatedUser: () => Promise.resolve({ user: currentUser, error: null }),
}));
vi.mock('@profullstack/emailer', () => ({
  createEmailer: () => ({ send: vi.fn(() => Promise.resolve()) }),
}));

const { POST: createOrg } = await import('./route');
const { POST: invite } = await import('./[orgId]/invitations/route');
const { PATCH: setRole, DELETE: removeMember } = await import('./[orgId]/members/[userId]/route');
const { POST: accept } = await import('../org-invitations/[token]/route');
const { PUT: addToTeam } = await import('./[orgId]/teams/[teamId]/members/route');

const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@acme.test' };
const MEMBER = { id: '22222222-2222-4222-8222-222222222222', email: 'member@acme.test' };
const NEWBIE = { id: '33333333-3333-4333-8333-333333333333', email: 'new@acme.test' };
const TEAM = '44444444-4444-4444-8444-444444444444';

function req(body?: unknown, method = 'POST') {
  return new Request('http://localhost/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const p = <T>(v: T) => ({ params: Promise.resolve(v) });

beforeEach(() => {
  db = createMemoryDb({
    organizations: [{ id: 'org1', name: 'Acme', slug: 'acme', owner_id: OWNER.id }],
    org_members: [
      { org_id: 'org1', user_id: OWNER.id, role: 'owner' },
      { org_id: 'org1', user_id: MEMBER.id, role: 'member' },
    ],
    teams: [{ id: TEAM, org_id: 'org1', name: 'Engineering' }],
    team_members: [],
    org_invitations: [],
    profiles: [{ id: OWNER.id, display_name: 'Owner', username: 'owner' }],
    __users: [OWNER, MEMBER, NEWBIE],
  });
  currentUser = OWNER;
});

describe('helpers', () => {
  it('slugifies names and knows admin roles', () => {
    expect(slugify('Profullstack, Inc.')).toBe('profullstack-inc');
    expect(slugify('!!')).toMatch(/^org-[0-9a-f]{6}$/);
    expect(isOrgAdmin('owner')).toBe(true);
    expect(isOrgAdmin('admin')).toBe(true);
    expect(isOrgAdmin('member')).toBe(false);
    expect(isOrgAdmin(null)).toBe(false);
  });
});

describe('POST /api/orgs', () => {
  it('creates the org with the caller as owner and a unique slug', async () => {
    const res = await createOrg(req({ name: 'Acme' }));
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; slug: string; role: string } };
    expect(data.slug).toBe('acme-2');
    expect(data.role).toBe('owner');
    expect(db.tables.org_members).toContainEqual(
      expect.objectContaining({ org_id: data.id, user_id: OWNER.id, role: 'owner' })
    );
  });

  it('requires sign-in', async () => {
    currentUser = null;
    expect((await createOrg(req({ name: 'Acme' }))).status).toBe(401);
  });
});

describe('invitations', () => {
  it('only admins can invite; tokens are stored hashed', async () => {
    currentUser = MEMBER;
    expect((await invite(req({ email: 'x@acme.test' }), p({ orgId: 'org1' }))).status).toBe(403);

    currentUser = OWNER;
    const res = await invite(req({ email: 'New@Acme.test', teamId: TEAM }), p({ orgId: 'org1' }));
    expect(res.status).toBe(201);
    const row = db.tables.org_invitations![0]!;
    expect(row.email).toBe('new@acme.test');
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acceptance requires the invited email and joins the org and team', async () => {
    db.tables.org_invitations!.push({
      id: 'inv1',
      org_id: 'org1',
      email: NEWBIE.email,
      role: 'member',
      team_id: TEAM,
      token_hash: hashToken('tok'),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      accepted_at: null,
    });

    currentUser = MEMBER; // wrong account
    expect((await accept(req(), p({ token: 'tok' }))).status).toBe(403);

    currentUser = NEWBIE;
    const res = await accept(req(), p({ token: 'tok' }));
    expect(res.status).toBe(200);
    expect(db.tables.org_members).toContainEqual(
      expect.objectContaining({ org_id: 'org1', user_id: NEWBIE.id, role: 'member' })
    );
    expect(db.tables.team_members).toContainEqual(
      expect.objectContaining({ team_id: TEAM, user_id: NEWBIE.id })
    );
    // A used link cannot be used again.
    expect((await accept(req(), p({ token: 'tok' }))).status).toBe(404);
  });

  it('refuses an expired invitation', async () => {
    db.tables.org_invitations!.push({
      id: 'inv2',
      org_id: 'org1',
      email: NEWBIE.email,
      role: 'member',
      team_id: null,
      token_hash: hashToken('old'),
      expires_at: new Date(Date.now() - 1000).toISOString(),
      accepted_at: null,
    });
    currentUser = NEWBIE;
    expect((await accept(req(), p({ token: 'old' }))).status).toBe(410);
  });
});

describe('members and teams', () => {
  it('protects the owner and lets admins manage members', async () => {
    expect(
      (await setRole(req({ role: 'member' }, 'PATCH'), p({ orgId: 'org1', userId: OWNER.id })))
        .status
    ).toBe(400);
    expect(
      (await setRole(req({ role: 'admin' }, 'PATCH'), p({ orgId: 'org1', userId: MEMBER.id })))
        .status
    ).toBe(200);
    expect(db.tables.org_members!.find((m) => m.user_id === MEMBER.id)?.role).toBe('admin');

    currentUser = MEMBER; // now an admin, but cannot remove the owner
    expect(
      (await removeMember(req(undefined, 'DELETE'), p({ orgId: 'org1', userId: OWNER.id }))).status
    ).toBe(400);
  });

  it('members may leave; non-admins may not remove others', async () => {
    db.tables.org_members!.push({ org_id: 'org1', user_id: NEWBIE.id, role: 'member' });
    currentUser = MEMBER;
    expect(
      (await removeMember(req(undefined, 'DELETE'), p({ orgId: 'org1', userId: NEWBIE.id }))).status
    ).toBe(403);
    expect(
      (await removeMember(req(undefined, 'DELETE'), p({ orgId: 'org1', userId: MEMBER.id }))).status
    ).toBe(200);
    expect(db.tables.org_members!.some((m) => m.user_id === MEMBER.id)).toBe(false);
  });

  it('only adds org members to a team', async () => {
    expect(
      (await addToTeam(req({ userId: NEWBIE.id }, 'PUT'), p({ orgId: 'org1', teamId: TEAM })))
        .status
    ).toBe(400);
    expect(
      (
        await addToTeam(
          req({ userId: MEMBER.id, role: 'lead' }, 'PUT'),
          p({ orgId: 'org1', teamId: TEAM })
        )
      ).status
    ).toBe(200);
    expect(db.tables.team_members).toContainEqual(
      expect.objectContaining({ team_id: TEAM, user_id: MEMBER.id, role: 'lead' })
    );
  });
});
