import { isCopilotMode, isCopilotRole, type CopilotStatus } from '@pairux/meeting-copilot/types';
import { errorResponse, successResponse } from '@/lib/api';
import { authorizeCopilotCaller } from '@/lib/copilot/access';
import { COPILOT_REQUIRES_PRO } from '@/lib/copilot/account';
import { body, copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { copilotRuntime } from '@/lib/copilot/runtime';
import { upgradePath } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/sessions/:id/copilot?participantId= — who has a copilot listening
// (everyone sees it), whether the caller may start one, and the caller's own.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const participantId = new URL(request.url).searchParams.get('participantId') ?? '';
    const runtime = copilotRuntime();
    // Guests without an account still see who is listening.
    let caller;
    try {
      caller = await authorizeCopilotCaller(request, sessionId, participantId);
    } catch {
      caller = null;
    }
    if (!runtime || !caller) {
      const status: CopilotStatus = {
        available: Boolean(runtime),
        eligible: false,
        upgradeUrl: null,
        active: runtime?.active(sessionId) ?? [],
        mine: null,
        mode: 'auto',
        role: 'general',
      };
      return successResponse(status);
    }
    const [eligible, settings] = await Promise.all([
      runtime.accounts.eligible(caller.userId),
      runtime.accounts.settingsFor(caller.userId),
    ]);
    // A copilot left live by a redeploy resumes as soon as its owner looks.
    const mine =
      runtime.get(sessionId, caller.userId)?.state ??
      (await recoverIfLive(runtime, sessionId, caller.userId));
    const status: CopilotStatus = {
      available: true,
      eligible,
      upgradeUrl: eligible ? null : upgradePath('pro'),
      active: runtime.active(sessionId),
      mine,
      mode: settings.mode,
      role: settings.role,
    };
    return successResponse(status);
  } catch (error) {
    return copilotError(error);
  }
}

async function recoverIfLive(
  runtime: NonNullable<ReturnType<typeof copilotRuntime>>,
  sessionId: string,
  userId: string
) {
  const live = await runtime.store.findLive(sessionId, userId);
  if (!live) return null;
  const recovered = await runtime.recover(live);
  if (!recovered) return null;
  return 'state' in recovered ? recovered.state : recovered;
}

// POST /api/sessions/:id/copilot — start (or resume) the caller's copilot.
// Body: { participantId, role, mode }.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const runtime = runtimeOrThrow();
    const caller = await authorizeCopilotCaller(
      request,
      sessionId,
      typeof input.participantId === 'string' ? input.participantId : ''
    );
    if (caller.sessionStatus === 'ended') return errorResponse('This meeting has ended.', 400);
    if (!(await runtime.accounts.eligible(caller.userId)))
      return errorResponse(COPILOT_REQUIRES_PRO, 403);
    const settings = await runtime.accounts.settingsFor(caller.userId);
    const role = isCopilotRole(input.role) ? input.role : settings.role;
    const mode = isCopilotMode(input.mode) ? input.mode : settings.mode;
    // Remember the choice for next time (and for the CLI).
    if (role !== settings.role || mode !== settings.mode)
      await runtime.accounts.saveSettings(caller.userId, { role, mode });
    const agent = await runtime.start({
      sessionId,
      userId: caller.userId,
      participantId: caller.participantId,
      role,
      mode,
      title: caller.title,
    });
    if (agent.state.role !== role || agent.state.mode !== mode) {
      agent.state.role = role;
      agent.state.mode = mode;
      await agent.save();
    }
    return successResponse(agent.state);
  } catch (error) {
    return copilotError(error);
  }
}

// DELETE /api/sessions/:id/copilot — stop it; answers the final state with
// follow-ups and the review.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const runtime = runtimeOrThrow();
    const caller = await authorizeCopilotCaller(
      request,
      sessionId,
      new URL(request.url).searchParams.get('participantId') ?? ''
    );
    const state = await runtime.stop(sessionId, caller.userId);
    if (state) return successResponse(state);
    const live = await runtime.store.findLive(sessionId, caller.userId);
    if (live) return successResponse(await runtime.finishStored(live));
    return errorResponse('No copilot is running for you in this meeting.', 404);
  } catch (error) {
    return copilotError(error);
  }
}
