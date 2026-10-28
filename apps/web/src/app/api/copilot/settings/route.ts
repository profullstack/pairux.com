import { isCopilotMode, isCopilotRole } from '@pairux/meeting-copilot/types';
import { errorResponse, successResponse } from '@/lib/api';
import {
  KEY_PROVIDERS,
  byokAvailable,
  validKeyShape,
  type KeyProvider,
} from '@/lib/copilot/account';
import { body, copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { formatUsd } from '@/lib/copilot/pricing';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/copilot/settings — mode, role, which own keys are set (last 4 only),
// eligibility and the pay-as-you-go balance.
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in first.', 401);
    const runtime = runtimeOrThrow();
    const [settings, eligible, balance] = await Promise.all([
      runtime.accounts.publicSettings(user.id),
      runtime.accounts.eligible(user.id),
      runtime.accounts.balanceMicros(user.id),
    ]);
    return successResponse({
      ...settings,
      eligible,
      byokAvailable: byokAvailable(),
      balanceMicros: balance,
      balance: formatUsd(balance),
    });
  } catch (error) {
    return copilotError(error);
  }
}

// PUT /api/copilot/settings — { mode?, role?, keys?: { anthropic?: string|null, ... } }.
// A key string replaces the stored key; null or "" deletes it.
export async function PUT(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in first.', 401);
    const runtime = runtimeOrThrow();
    const input = await body(request);
    if (input.mode !== undefined && !isCopilotMode(input.mode))
      return errorResponse('mode must be auto, free, byok or cloud.', 400);
    if (input.role !== undefined && !isCopilotRole(input.role))
      return errorResponse('Unknown role.', 400);
    const keys: Partial<Record<KeyProvider, string | null>> = {};
    const raw =
      input.keys && typeof input.keys === 'object' ? (input.keys as Record<string, unknown>) : {};
    for (const provider of KEY_PROVIDERS) {
      const value = raw[provider];
      if (value === undefined) continue;
      if (value === null || value === '') {
        keys[provider] = null;
        continue;
      }
      if (typeof value !== 'string' || !validKeyShape(provider, value.trim()))
        return errorResponse(`That does not look like a ${provider} API key.`, 400);
      if (!byokAvailable()) return errorResponse('Own keys are not enabled on this server.', 503);
      keys[provider] = value.trim();
    }
    const saved = await runtime.accounts.saveSettings(user.id, {
      ...(isCopilotMode(input.mode) ? { mode: input.mode } : {}),
      ...(isCopilotRole(input.role) ? { role: input.role } : {}),
      keys,
    });
    return successResponse(saved);
  } catch (error) {
    return copilotError(error);
  }
}
