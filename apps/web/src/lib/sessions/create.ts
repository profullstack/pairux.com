import { canUseCallAnalysis, maxListeners, participantCap } from '@pairux/shared-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ANALYSIS_REQUIRES_PRO } from '@/lib/plans';
import { serviceClient } from '@/lib/supabase/service';
import { canUseWorkspace, resolveUserPlan } from '@/lib/orgs';
import type { CreateSessionInput } from '@/lib/validations';

export type CreateSessionResult =
  | { ok: true; session: Record<string, unknown> & { id: string; join_code: string } }
  | { ok: false; status: number; error: string };

/**
 * Create a session as `userId`, through the user's own Supabase client
 * (create_session reads auth.uid()). Shared by POST /api/sessions and personal
 * rooms, so both get the same plan caps.
 *
 * Size the room to the owner's plan (Free: 2 participants, the host included,
 * + 20 listeners; Plus 100 + 100; Pro/Team more). join_session enforces the
 * plan's caps live on every join; settings.maxParticipants and maxListeners
 * are the display copy. A lapsed paid plan falls back to free. The
 * client-requested value is ignored (clients hardcode a default). The owner's
 * own plan or the plan of any organization they belong to.
 */
export async function createSessionFor(
  supabase: SupabaseClient,
  userId: string,
  settings: CreateSessionInput
): Promise<CreateSessionResult> {
  const svc = serviceClient();
  const plan = await resolveUserPlan(svc, userId);

  // Workspace: a personal call, or one that belongs to an org or a team.
  const workspace = await canUseWorkspace(svc, userId, settings.orgId, settings.teamId);
  if (!workspace)
    return { ok: false, status: 403, error: 'You are not a member of that organization or team' };
  const maxParticipants = participantCap(plan);

  // AI call analysis is chosen here, before the call exists, and is fixed for
  // the session's life. It is a Pro/Team feature.
  const analysis = settings.analysis?.enabled ? settings.analysis : undefined;
  if (analysis && !canUseCallAnalysis(plan))
    return { ok: false, status: 403, error: ANALYSIS_REQUIRES_PRO };

  const rpcParams: Record<string, unknown> = {
    p_settings: {
      quality: 'medium',
      allowControl: settings.allowGuestControl,
      maxParticipants,
      maxListeners: maxListeners(plan),
      ...(analysis ? { analysis } : {}),
    },
    p_mode: settings.mode,
  };
  if (settings.joinCode) rpcParams.p_join_code = settings.joinCode;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('create_session', rpcParams);

  if (error) {
    console.error('Create session error:', error);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return { ok: false, status: 400, error: String(error.message) };
  }

  const session = data as Record<string, unknown> & { id: string; join_code: string };
  if (workspace.orgId) {
    await svc
      .from('sessions')
      .update({ org_id: workspace.orgId, team_id: workspace.teamId } as never)
      .eq('id', session.id);
    Object.assign(session, { org_id: workspace.orgId, team_id: workspace.teamId });
  }
  return { ok: true, session };
}
