import { z } from 'zod';
import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents } from '@/lib/account-agents';
import { BroadcastError, endBroadcast, heartbeatBroadcast } from '@/lib/agent-broadcast';
import { serviceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const idSchema = z.guid('Invalid session ID');

/** POST /api/v1/agent/broadcasts/:id — heartbeat; { live } says whether it still is. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const agent = await new AccountAgents().fromRequest(request);
    if (!agent) return errorResponse('Send Authorization: Bearer <pux_ag_ agent key>.', 401);
    const sessionId = idSchema.parse((await params).sessionId);
    return successResponse(await heartbeatBroadcast(serviceClient(), agent, sessionId));
  } catch (error) {
    if (error instanceof BroadcastError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

/** DELETE /api/v1/agent/broadcasts/:id — the broadcast is over. */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const agent = await new AccountAgents().fromRequest(request);
    if (!agent) return errorResponse('Send Authorization: Bearer <pux_ag_ agent key>.', 401);
    const sessionId = idSchema.parse((await params).sessionId);
    const result = await endBroadcast(serviceClient(), agent, sessionId);
    void import('@/lib/channel-restream').then(({ stopChannelRestream }) =>
      stopChannelRestream(sessionId)
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof BroadcastError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
