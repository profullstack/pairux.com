/**
 * Entitlements for the paid multistream plugin.
 *
 * Free plan can stream to YouTube only. Pro/team plans unlock every other
 * platform and simultaneous fan-out. This module is the single source of
 * truth for that rule and is shared by the main-process gate (enforcement)
 * and the renderer UI (lock badges / upgrade prompts).
 */

import type { Plan } from '@pairux/shared-types';
import type { StreamPlatform } from '../preload/api';

/** Platforms available on the free plan without an upgrade. */
export const FREE_PLATFORMS: readonly StreamPlatform[] = ['youtube'];

/** Plans that unlock all streaming platforms. */
const PAID_PLANS: readonly Plan[] = ['pro', 'team'];

export function isPaidPlan(plan: Plan): boolean {
  return PAID_PLANS.includes(plan);
}

/** True when the given plan is allowed to stream to the given platform. */
export function isPlatformAllowed(platform: StreamPlatform, plan: Plan): boolean {
  return FREE_PLATFORMS.includes(platform) || isPaidPlan(plan);
}

/** True when a platform requires a paid plan regardless of the current plan. */
export function isPaidPlatform(platform: StreamPlatform): boolean {
  return !FREE_PLATFORMS.includes(platform);
}

export const UPGRADE_REQUIRED_MESSAGE =
  'Streaming to this platform requires the PairUX multistream plugin. Upgrade to stream everywhere at once — YouTube stays free.';
