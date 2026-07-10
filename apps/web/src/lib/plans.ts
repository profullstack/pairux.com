/**
 * Paid plan catalog.
 *
 * CoinPay is invoice-based, so each payment buys one term (TERM_DAYS).
 * Renewal = pay again; the webhook extends profiles.plan_expires_at.
 * Prices mirror the public /pricing page.
 *
 * plus  = $1/mo audience tier — host rooms with up to 100 listeners.
 * pro/team = plus larger rooms and every streaming platform.
 */

import type { Plan } from '@pairux/shared-types';
import { maxListeners } from '@pairux/shared-types';

export type PaidPlan = Exclude<Plan, 'free'>;

export interface PlanDef {
  id: PaidPlan;
  label: string;
  priceUsd: number;
  /** Max concurrent listeners this plan can host (mirrors LISTENER_CAP). */
  listeners: number;
}

/** How much access one payment buys (mirrors agentbbs PodTerm = 31 days). */
export const TERM_DAYS = 31;

export const PLANS: Record<PaidPlan, PlanDef> = {
  plus: { id: 'plus', label: 'PairUX Plus', priceUsd: 1, listeners: maxListeners('plus') },
  pro: { id: 'pro', label: 'PairUX Pro', priceUsd: 12, listeners: maxListeners('pro') },
  team: { id: 'team', label: 'PairUX Team', priceUsd: 49, listeners: maxListeners('team') },
};

export function getPlanDef(id: string): PlanDef | null {
  return id === 'plus' || id === 'pro' || id === 'team' ? PLANS[id] : null;
}
