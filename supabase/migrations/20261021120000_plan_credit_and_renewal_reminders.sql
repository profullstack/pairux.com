-- Plan payments: credit exactly once, atomically, and remind before a term ends.
--
-- 1. plan_credit_payment: CoinPay can send confirmed AND forwarded for one
--    payment, close together. The old webhook read credited_at, called
--    grant_plan, then set credited_at: two deliveries could both extend the
--    plan. This marks the row credited and extends the plan in one statement.
-- 2. plan_renewal_reminders: a ledger so the per-minute reminders tick mails
--    each (user, term end, lead) at most once.

CREATE OR REPLACE FUNCTION public.plan_credit_payment(
  p_payment_id TEXT,
  p_days INTEGER,
  p_status TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paid RECORD;
  new_expiry TIMESTAMPTZ;
BEGIN
  UPDATE public.plan_payments
     SET credited_at = NOW(), status = p_status, updated_at = NOW()
   WHERE coinpay_payment_id = p_payment_id
     AND credited_at IS NULL
     AND plan IN ('plus', 'pro', 'team')
  RETURNING user_id, plan INTO paid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles
     SET plan = CASE
                  -- Paying for a smaller plan while a bigger one is still running
                  -- extends the time but keeps the bigger plan.
                  WHEN plan_expires_at > NOW()
                   AND array_position(ARRAY['free','plus','pro','team'], plan)
                       > array_position(ARRAY['free','plus','pro','team'], paid.plan)
                  THEN plan
                  ELSE paid.plan
                END,
         plan_expires_at = GREATEST(NOW(), COALESCE(plan_expires_at, NOW()))
                             + (p_days || ' days')::INTERVAL,
         updated_at = NOW()
   WHERE id = paid.user_id
  RETURNING plan_expires_at INTO new_expiry;

  RETURN new_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_credit_payment(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_credit_payment(TEXT, INTEGER, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.plan_renewal_reminders (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  lead TEXT NOT NULL CHECK (lead IN ('3d', '1d', 'expired')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, expires_at, lead)
);

ALTER TABLE public.plan_renewal_reminders ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (the reminders tick) reads or writes it.
