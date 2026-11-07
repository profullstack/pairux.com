-- Profullstack Pass (https://coinpayportal.com/pass): a CoinPay user who
-- deposited $99 into their own CoinPay wallet gets a free month of Pro on
-- every Profullstack property. CoinPay reports it only in the userinfo `pass`
-- claim at sign-in, so the CoinPay callback calls plan_apply_coinpay_pass()
-- for the account bound to the CoinPay sub (never by email).
--
-- The pass is written into profiles.plan / plan_expires_at, the columns every
-- reader already checks (web effectivePlan, LiveKit limits, the desktop app),
-- with max semantics, unlike plan_grant_days which adds days:
--   plan            = the bigger of the running plan and 'pro'
--   plan_expires_at = GREATEST(running expiry, pass end)
-- coinpay_pass_until keeps the latest pass end seen, so a repeat sign-in with
-- the same pass is a no-op. Service role only; the existing trigger keeps
-- users from writing either column.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coinpay_pass_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.plan_apply_coinpay_pass(
  p_user_id UUID,
  p_until TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_expiry TIMESTAMPTZ;
BEGIN
  IF p_until IS NULL OR p_until <= NOW() THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles
     SET plan = CASE
                  WHEN plan_expires_at > NOW()
                   AND array_position(ARRAY['free','plus','pro','team'], plan)
                       > array_position(ARRAY['free','plus','pro','team'], 'pro')
                  THEN plan
                  ELSE 'pro'
                END,
         plan_expires_at = CASE
                  WHEN plan_expires_at > NOW() AND plan <> 'free'
                  THEN GREATEST(plan_expires_at, p_until)
                  ELSE p_until
                END,
         coinpay_pass_until = p_until,
         updated_at = NOW()
   WHERE id = p_user_id
     AND (coinpay_pass_until IS NULL OR coinpay_pass_until < p_until)
  RETURNING plan_expires_at INTO new_expiry;

  RETURN new_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_apply_coinpay_pass(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_apply_coinpay_pass(UUID, TIMESTAMPTZ) TO service_role;
