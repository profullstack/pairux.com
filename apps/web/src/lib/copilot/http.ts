import { errorResponse, handleApiError } from '@/lib/api';
import { CopilotAccessError, authorizeCopilotCaller } from './access';
import { CopilotAgent } from './agent';
import { CopilotLlmError } from './llm';
import { CopilotBusyError, copilotRuntime, type CopilotRuntime } from './runtime';

/** Every copilot route answers its own errors the same way. */
export function copilotError(error: unknown) {
  if (error instanceof CopilotAccessError) return errorResponse(error.message, error.status);
  if (error instanceof CopilotBusyError) return errorResponse(error.message, 503);
  if (error instanceof CopilotLlmError) return errorResponse(error.message, 503);
  return handleApiError(error);
}

export function runtimeOrThrow(): CopilotRuntime {
  const runtime = copilotRuntime();
  if (!runtime) throw new CopilotAccessError('The AI copilot is turned off on this server.', 503);
  return runtime;
}

/** Read a JSON body without throwing on junk. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

export const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** The caller's running copilot in a meeting (resumed after a redeploy), or a 404. */
export async function callerAgent(request: Request, sessionId: string, participantId: string) {
  const runtime = runtimeOrThrow();
  const caller = await authorizeCopilotCaller(request, sessionId, participantId);
  let agent = runtime.get(sessionId, caller.userId);
  if (!agent) {
    const live = await runtime.store.findLive(sessionId, caller.userId);
    const recovered = live ? await runtime.recover(live) : null;
    if (recovered instanceof CopilotAgent) agent = recovered;
  }
  if (!agent) throw new CopilotAccessError('No copilot is running for you in this meeting.', 404);
  agent.lastSeen = Date.now();
  return { runtime, caller, agent };
}
