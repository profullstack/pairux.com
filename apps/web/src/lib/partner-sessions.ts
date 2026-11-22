/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * Ordinary PairUX sessions opened by a partner's server (see lib/partners.ts).
 *
 * board.saas is the first user: a voice board meeting is a normal SFU session
 * owned by the partner's service account, so the founder joins it from the
 * desktop app or the web/PWA with a normal join link, and the board's six AI
 * members join it as agent participants (join_session_as_agent) and speak with
 * microphone-only tokens from /api/v1/agents/:id/voice-token.
 *
 * What makes these rooms different from a host's own session:
 *  - the owner never connects, so the session starts `active` with no host row;
 *  - settings.partner marks the room as the partner's, and only that partner
 *    may read or end it;
 *  - settings.guestsCanSpeak lets a guest who joined by the link publish a
 *    microphone (normal rooms keep guests listen-only), so the founder can talk
 *    to the board without a PairUX account. The LiveKit token route reads it.
 * Seats follow the owner's plan (session_seat_usage), never the joiner's, so a
 * partner's service account on a paid plan is never blocked by Free caps.
 */
import { z } from 'zod';
import { maxListeners, participantCap } from '@pairux/shared-types';
import type { serviceClient } from '@/lib/supabase/service';
import { getUniqueJoinCode } from '@/lib/join-code';
import { resolveUserPlan } from '@/lib/orgs';
import type { Partner } from '@/lib/partners';

type ServiceClient = ReturnType<typeof serviceClient>;

/** Agents a partner may seat in one call (join_session_as_agent allows 20 per room). */
export const PARTNER_MAX_AGENTS = 8;

export const partnerSessionSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  agents: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(50),
        client: z.string().trim().max(60).optional(),
      })
    )
    .max(PARTNER_MAX_AGENTS)
    .default([]),
  guestsCanSpeak: z.boolean().default(true),
  /** Shown to everyone: the partner says it records the call itself. */
  recorded: z.boolean().default(false),
});
export type PartnerSessionInput = z.infer<typeof partnerSessionSchema>;

export interface PartnerAgent {
  participantId: string;
  name: string;
}

export interface PartnerSession {
  sessionId: string;
  joinCode: string;
  joinUrl: string;
  roomName: string;
  agents: PartnerAgent[];
}

export function joinUrlFor(origin: string, joinCode: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${joinCode}`;
}

export async function createPartnerSession(
  db: ServiceClient,
  partner: Partner,
  input: PartnerSessionInput,
  origin: string
): Promise<PartnerSession> {
  if (!partner.ownerUserId) throw new PartnerSessionError('This partner cannot open sessions', 403);
  const owner = partner.ownerUserId;
  const plan = await resolveUserPlan(db, owner);
  const joinCode = await getUniqueJoinCode(db);
  const now = new Date().toISOString();

  const { data: session, error } = (await (db as any)
    .from('sessions')
    .insert({
      host_user_id: owner,
      creator_id: owner,
      current_host_id: owner,
      host_last_seen_at: now,
      status: 'active',
      mode: 'sfu',
      join_code: joinCode,
      subject: input.subject,
      is_public: false,
      settings: {
        quality: 'medium',
        allowControl: false,
        allowAgents: true,
        guestsCanSpeak: input.guestsCanSpeak,
        recorded: input.recorded,
        partner: partner.id,
        maxParticipants: participantCap(plan),
        maxListeners: maxListeners(plan),
      },
    })
    .select('id, join_code')
    .single()) as {
    data: { id: string; join_code: string } | null;
    error: { message?: string } | null;
  };
  if (error || !session) {
    throw new PartnerSessionError(
      `Could not open the session: ${error?.message ?? 'unknown'}`,
      500
    );
  }

  const agents: PartnerAgent[] = [];
  for (const a of input.agents) {
    const { data, error: joinError } = await (db.rpc as any)('join_session_as_agent', {
      p_join_code: session.join_code,
      p_display_name: a.name,
      p_agent_client: a.client ?? partner.name,
      p_owner_id: owner,
    });
    if (joinError || !data) {
      await endPartnerSession(db, partner, session.id).catch(() => undefined);
      throw new PartnerSessionError(
        `Agent ${a.name} could not join: ${String(joinError?.message ?? 'unknown')}`,
        500
      );
    }
    agents.push({ participantId: data.id, name: data.display_name });
  }

  return {
    sessionId: session.id,
    joinCode: session.join_code,
    joinUrl: joinUrlFor(origin, session.join_code),
    roomName: `session-${session.id}`,
    agents,
  };
}

interface PartnerSessionRow {
  id: string;
  status: string;
  join_code: string;
  subject: string | null;
  settings: { partner?: string } | null;
}

async function loadOwned(db: ServiceClient, partner: Partner, sessionId: string) {
  const { data } = (await (db as any)
    .from('sessions')
    .select('id, status, join_code, subject, settings')
    .eq('id', sessionId)
    .maybeSingle()) as { data: PartnerSessionRow | null };
  if (data?.settings?.partner !== partner.id)
    throw new PartnerSessionError('Session not found', 404);
  return data;
}

/** Status and live roster (humans and agents) of a partner's session. */
export async function partnerSessionStatus(db: ServiceClient, partner: Partner, sessionId: string) {
  const session = await loadOwned(db, partner, sessionId);
  const { data: participants } = (await (db as any)
    .from('session_participants')
    .select('id, display_name, kind, user_id, connection_status, last_seen_at, joined_at')
    .eq('session_id', sessionId)
    .is('left_at', null)
    .order('joined_at', { ascending: true })) as {
    data:
      | {
          id: string;
          display_name: string;
          kind: string;
          user_id: string | null;
          connection_status: string | null;
          last_seen_at: string | null;
          joined_at: string;
        }[]
      | null;
  };
  return {
    sessionId: session.id,
    status: session.status,
    joinCode: session.join_code,
    subject: session.subject,
    participants: (participants ?? []).map((p) => ({
      id: p.id,
      name: p.display_name,
      kind: p.kind,
      signedIn: Boolean(p.user_id),
      connectionStatus: p.connection_status,
      lastSeenAt: p.last_seen_at,
      joinedAt: p.joined_at,
    })),
  };
}

/** End the session: everyone is let go and the join link stops working. */
export async function endPartnerSession(db: ServiceClient, partner: Partner, sessionId: string) {
  const session = await loadOwned(db, partner, sessionId);
  if (session.status === 'ended') return { sessionId, ended: true };
  const now = new Date().toISOString();
  await (db as any).from('sessions').update({ status: 'ended', ended_at: now }).eq('id', sessionId);
  await (db as any)
    .from('session_participants')
    .update({ left_at: now, connection_status: 'disconnected' })
    .eq('session_id', sessionId)
    .is('left_at', null);
  return { sessionId, ended: true };
}

export class PartnerSessionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
