/**
 * Profullstack Pass on PairUX: a CoinPay user who deposited $99 into their own
 * CoinPay wallet gets a free month of Pro.
 *
 * CoinPay reports the pass only in the userinfo `pass` claim at sign-in
 * (finishSignIn() reads it with passFromUserinfo()). The callback hands it to
 * plan_apply_coinpay_pass (supabase/migrations/20261107120000_coinpay_pass.sql)
 * for the account bound to the CoinPay `sub`, never one matched by email. That
 * writes profiles.plan / plan_expires_at with max semantics, so every reader
 * (effectivePlan, LiveKit limits, the desktop app) sees Pro until the pass
 * ends, and a paid term that runs longer is kept.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PASS_URL, type CoinpayPass } from '@profullstack/coinpay-onboard/pass';

export { PASS_URL };

/** The pass end to apply, or null when the claim grants nothing. */
export function passUntilToApply(
  pass: CoinpayPass | null | undefined,
  now: number = Date.now()
): string | null {
  if (!pass?.active || !pass.expiresAt) return null;
  const t = pass.expiresAt.getTime();
  return Number.isFinite(t) && t > now ? pass.expiresAt.toISOString() : null;
}

/** Applies an active pass to the account. Returns the new plan expiry, or null when nothing changed. */
export async function applyCoinpayPass(
  db: Pick<SupabaseClient, 'rpc'>,
  userId: string,
  pass: CoinpayPass | null | undefined,
  now: number = Date.now()
): Promise<string | null> {
  const until = passUntilToApply(pass, now);
  if (!userId || !until) return null;
  const res = (await db.rpc('plan_apply_coinpay_pass', {
    p_user_id: userId,
    p_until: until,
  })) as { data: string | null; error: { message: string } | null };
  if (res.error) throw new Error(`plan_apply_coinpay_pass: ${res.error.message}`);
  return res.data ?? null;
}
