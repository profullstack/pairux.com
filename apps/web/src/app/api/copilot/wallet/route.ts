import { errorResponse, successResponse } from '@/lib/api';
import { copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { COPILOT_MARKUP, COPILOT_TOPUPS, formatUsd } from '@/lib/copilot/pricing';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/copilot/wallet — pay-as-you-go balance, top-ups on offer and the
// latest charges (provider cost + 10%).
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in first.', 401);
    const runtime = runtimeOrThrow();
    const [balance, usage] = await Promise.all([
      runtime.accounts.balanceMicros(user.id),
      runtime.accounts.usage(user.id),
    ]);
    return successResponse({
      balanceMicros: balance,
      balance: formatUsd(balance),
      markup: COPILOT_MARKUP,
      topups: COPILOT_TOPUPS,
      usage: usage.map((row) => ({
        sessionId: row.session_id,
        provider: row.provider,
        kind: row.kind,
        units: row.units,
        charge: formatUsd(row.charge_micros),
        chargeMicros: row.charge_micros,
        status: row.status,
        at: row.created_at,
      })),
    });
  } catch (error) {
    return copilotError(error);
  }
}
