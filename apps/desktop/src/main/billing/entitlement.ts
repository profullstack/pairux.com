/**
 * Plan/entitlement resolution for the paid multistream plugin.
 *
 * The web app (profiles.plan) is the source of truth. We fetch it via the
 * authenticated /api/auth/session endpoint and cache it briefly so the
 * streaming gate doesn't hit the network on every start. On any failure we
 * fail closed to 'free' (YouTube-only), never open.
 */

import type { Plan, Profile } from '@pairux/shared-types';
import { effectivePlan } from '@pairux/shared-types';
import { API_BASE_URL } from '../../shared/config';
import { getValidAuth } from '../auth/secure-storage';

const CACHE_TTL_MS = 60_000;

interface CachedPlan {
  plan: Plan;
  fetchedAt: number;
}

let cache: CachedPlan | null = null;

interface SessionResponse {
  data?: { profile?: Profile | null };
  profile?: Profile | null;
}

async function fetchPlanFromServer(): Promise<Plan> {
  const stored = await getValidAuth(API_BASE_URL);
  if (!stored) return 'free';

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stored.accessToken}`,
      },
    });

    if (!response.ok) {
      console.warn('[Billing] Session fetch failed:', response.status);
      return 'free';
    }

    const body = (await response.json()) as SessionResponse;
    const profile = body.data?.profile ?? body.profile ?? null;
    if (!profile) return 'free';
    // A paid plan only counts while its CoinPay-paid period is still active.
    return effectivePlan(profile.plan, profile.plan_expires_at);
  } catch (error) {
    console.warn('[Billing] Failed to resolve plan, defaulting to free:', error);
    return 'free';
  }
}

/**
 * Resolve the current user's plan, using the short-lived cache unless
 * `forceRefresh` is set. Fails closed to 'free'.
 */
export async function getPlan(forceRefresh = false): Promise<Plan> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.plan;
  }

  const plan = await fetchPlanFromServer();
  cache = { plan, fetchedAt: now };
  return plan;
}

/** Last resolved plan without a network call; 'free' until first resolved. */
export function getCachedPlan(): Plan {
  return cache?.plan ?? 'free';
}

/** Clear the cached plan (e.g. on logout). */
export function clearPlanCache(): void {
  cache = null;
}
