/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * Your own agents (plans/MEETING-COPILOT.md §12): AI agents registered on an
 * account, optionally shared with an org, that can be invited into a meeting
 * next to PairUX's own copilot. An agent authenticates with its key
 * (Bearer pux_ag_<id>_<secret>; the server keeps only a SHA-256 hash), picks
 * up invites, and joins as an agent participant owned by the account.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { orgRole, type Db } from '@/lib/orgs';

export const AGENT_KEY_PREFIX = 'pux_ag_';
/** An invite nobody picked up within this long is expired. */
export const INVITE_TTL_MS = 15 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const registerAgentSchema = z.object({
  name: z.string().trim().min(2).max(50),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, 'handle: 2-32 lowercase letters, digits, - or _'),
  description: z.string().trim().max(300).optional(),
  orgId: z.uuid().nullable().optional(),
});

export interface AccountAgent {
  id: string;
  name: string;
  handle: string;
  description: string;
  ownerUserId: string;
  orgId: string | null;
  keyPrefix: string;
  lastSeenAt: string | null;
  /** Polled for invites in the last two minutes. */
  online: boolean;
  createdAt: string;
}

export class AgentAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const hashKey = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/** pux_ag_<agent id without dashes>_<43-char secret>. */
export function mintAgentKey(agentId: string): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString('base64url');
  const key = `${AGENT_KEY_PREFIX}${agentId.replace(/-/g, '')}_${secret}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, AGENT_KEY_PREFIX.length + 8) };
}

/** The agent id a key names, or null for anything that is not an agent key. */
export function agentIdFromKey(key: string): string | null {
  const match = /^pux_ag_([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/.exec(key);
  if (!match?.[1]) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function keyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function view(row: any): AccountAgent {
  const lastSeen = row.last_seen_at ? Date.parse(String(row.last_seen_at)) : 0;
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    description: row.description ?? '',
    ownerUserId: row.owner_user_id,
    orgId: row.org_id ?? null,
    keyPrefix: row.key_prefix,
    lastSeenAt: row.last_seen_at ?? null,
    online: Date.now() - lastSeen < 120_000,
    createdAt: row.created_at,
  };
}

const COLUMNS =
  'id, name, handle, description, owner_user_id, org_id, key_prefix, key_hash, last_seen_at, revoked_at, created_at';

export class AccountAgents {
  constructor(private readonly db: any = serviceClient()) {}

  /** Agents this user may invite: their own, and those shared with their orgs. */
  async visibleTo(userId: string): Promise<AccountAgent[]> {
    const { data: memberships } = await this.db
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId);
    const orgIds = ((memberships ?? []) as { org_id: string }[]).map((row) => row.org_id);
    let query = this.db.from('account_agents').select(COLUMNS).is('revoked_at', null);
    query = orgIds.length
      ? query.or(`owner_user_id.eq.${userId},org_id.in.(${orgIds.join(',')})`)
      : query.eq('owner_user_id', userId);
    const { data } = await query.order('created_at', { ascending: true });
    return ((data ?? []) as any[]).map(view);
  }

  async canUse(userId: string, agent: AccountAgent): Promise<boolean> {
    if (agent.ownerUserId === userId) return true;
    return Boolean(agent.orgId && (await orgRole(this.db as Db, agent.orgId, userId)));
  }

  async get(id: string): Promise<AccountAgent | null> {
    if (!UUID.test(id)) return null;
    const { data } = await this.db
      .from('account_agents')
      .select(COLUMNS)
      .eq('id', id)
      .is('revoked_at', null)
      .maybeSingle();
    return data ? view(data) : null;
  }

  /** Register an agent; the key is returned this once and never again. */
  async register(
    userId: string,
    input: z.infer<typeof registerAgentSchema>
  ): Promise<{ agent: AccountAgent; key: string }> {
    if (input.orgId && !(await orgRole(this.db as Db, input.orgId, userId)))
      throw new AgentAccessError('You are not a member of that organization.', 403);
    const id = crypto.randomUUID();
    const minted = mintAgentKey(id);
    const { data, error } = await this.db
      .from('account_agents')
      .insert({
        id,
        owner_user_id: userId,
        org_id: input.orgId ?? null,
        name: input.name,
        handle: input.handle,
        description: input.description ?? '',
        key_hash: minted.hash,
        key_prefix: minted.prefix,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505')
        throw new AgentAccessError(`You already have an agent called @${input.handle}.`, 409);
      throw new Error(`Registering the agent failed: ${String(error.message)}`);
    }
    return { agent: view(data), key: minted.key };
  }

  /** A new key; the old one stops working at once. Owner only. */
  async rotate(userId: string, id: string): Promise<{ agent: AccountAgent; key: string }> {
    const agent = await this.get(id);
    if (agent?.ownerUserId !== userId) throw new AgentAccessError('Agent not found', 404);
    const minted = mintAgentKey(id);
    const { data, error } = await this.db
      .from('account_agents')
      .update({ key_hash: minted.hash, key_prefix: minted.prefix })
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`Rotating the key failed: ${String(error.message)}`);
    return { agent: view(data), key: minted.key };
  }

  async revoke(userId: string, id: string): Promise<void> {
    const agent = await this.get(id);
    if (agent?.ownerUserId !== userId) throw new AgentAccessError('Agent not found', 404);
    await this.db
      .from('account_agents')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    await this.db
      .from('agent_invites')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('agent_id', id)
      .eq('status', 'pending');
  }

  /** The agent behind a request's Bearer pux_ag_ key (stamps last_seen_at). */
  async fromRequest(request: Request): Promise<AccountAgent | null> {
    const header = request.headers.get('authorization') ?? '';
    const key = /^Bearer\s+(pux_ag_\S+)$/.exec(header)?.[1];
    if (!key) return null;
    const id = agentIdFromKey(key);
    if (!id) return null;
    const { data } = await this.db
      .from('account_agents')
      .select(COLUMNS)
      .eq('id', id)
      .is('revoked_at', null)
      .maybeSingle();
    if (!data || !keyMatches(key, String(data.key_hash))) return null;
    const now = new Date().toISOString();
    await this.db.from('account_agents').update({ last_seen_at: now }).eq('id', id);
    return view({ ...data, last_seen_at: now });
  }

  /** Invite an agent into a meeting (one open invite per agent per meeting). */
  async invite(input: {
    agentId: string;
    sessionId: string;
    invitedBy: string;
    transcript: boolean;
  }): Promise<{ id: string; status: string }> {
    const { data: open } = await this.db
      .from('agent_invites')
      .select('id, status')
      .eq('agent_id', input.agentId)
      .eq('session_id', input.sessionId)
      .in('status', ['pending', 'accepted'])
      .maybeSingle();
    if (open) return { id: String(open.id), status: String(open.status) };
    const { data, error } = await this.db
      .from('agent_invites')
      .insert({
        agent_id: input.agentId,
        session_id: input.sessionId,
        invited_by: input.invitedBy,
        transcript: input.transcript,
      })
      .select('id, status')
      .single();
    if (error) throw new Error(`Inviting the agent failed: ${String(error.message)}`);
    return { id: String(data.id), status: String(data.status) };
  }

  /** Invites for a meeting, newest first, with each agent's name. */
  async invitesForSession(sessionId: string) {
    const { data } = await this.db
      .from('agent_invites')
      .select('id, agent_id, status, transcript, participant_id, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(50);
    return ((data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      agentId: String(row.agent_id),
      status: String(row.status),
      transcript: Boolean(row.transcript),
      participantId: (row.participant_id as string | null) ?? null,
      createdAt: String(row.created_at),
    }));
  }

  /** Pending invites for an agent; stale ones are expired on the way. */
  async pendingFor(agentId: string) {
    const cutoff = new Date(Date.now() - INVITE_TTL_MS).toISOString();
    await this.db
      .from('agent_invites')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('agent_id', agentId)
      .eq('status', 'pending')
      .lt('created_at', cutoff);
    const { data } = await this.db
      .from('agent_invites')
      .select(
        'id, session_id, invited_by, transcript, created_at, sessions(join_code, subject, status)'
      )
      .eq('agent_id', agentId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return ((data ?? []) as any[])
      .filter((row) => row.sessions && row.sessions.status !== 'ended')
      .map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        joinCode: String(row.sessions.join_code),
        subject: (row.sessions.subject as string | null) ?? null,
        transcript: Boolean(row.transcript),
        invitedBy: String(row.invited_by),
        createdAt: String(row.created_at),
      }));
  }

  async getInvite(id: string, agentId: string) {
    if (!UUID.test(id)) return null;
    const { data } = await this.db
      .from('agent_invites')
      .select(
        'id, session_id, status, transcript, invited_by, participant_id, sessions(join_code, status)'
      )
      .eq('id', id)
      .eq('agent_id', agentId)
      .maybeSingle();
    return (data ?? null) as {
      id: string;
      session_id: string;
      status: string;
      transcript: boolean;
      invited_by: string;
      participant_id: string | null;
      sessions: { join_code: string; status: string } | null;
    } | null;
  }

  async setInvite(id: string, patch: { status: string; participant_id?: string | null }) {
    await this.db
      .from('agent_invites')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  /** The accepted invite behind an agent participant (for its transcript grant). */
  async inviteForParticipant(participantId: string) {
    if (!UUID.test(participantId)) return null;
    const { data } = await this.db
      .from('agent_invites')
      .select('id, session_id, transcript, invited_by, agent_id')
      .eq('participant_id', participantId)
      .eq('status', 'accepted')
      .maybeSingle();
    return (data ?? null) as {
      id: string;
      session_id: string;
      transcript: boolean;
      invited_by: string;
      agent_id: string;
    } | null;
  }
}
