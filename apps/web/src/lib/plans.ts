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
import { PLAN_PRICE_USD, maxListeners } from '@pairux/shared-types';

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
  plus: {
    id: 'plus',
    label: 'PairUX Plus',
    priceUsd: PLAN_PRICE_USD.plus,
    listeners: maxListeners('plus'),
  },
  pro: {
    id: 'pro',
    label: 'PairUX Pro',
    priceUsd: PLAN_PRICE_USD.pro,
    listeners: maxListeners('pro'),
  },
  team: {
    id: 'team',
    label: 'PairUX Team',
    priceUsd: PLAN_PRICE_USD.team,
    listeners: maxListeners('team'),
  },
};

export function getPlanDef(id: string): PlanDef | null {
  return id === 'plus' || id === 'pro' || id === 'team' ? PLANS[id] : null;
}

/** One-click checkout for a plan: /upgrade/<plan> starts CoinPay straight away. */
export function upgradePath(id: PaidPlan): string {
  return `/upgrade/${id}`;
}

/** 403 body when a non-Pro host turns on AI call analysis (read by web + desktop). */
export const ANALYSIS_REQUIRES_PRO = `AI call analysis is a Pro feature ($${String(PLANS.pro.priceUsd)}/month). Upgrade at https://pairux.com${upgradePath('pro')}, or turn it off.`;

export { nextPlan, planForCap } from '@pairux/shared-types';
