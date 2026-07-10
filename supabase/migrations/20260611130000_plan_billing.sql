-- Plan billing for the paid multistream plugin (CoinPay).
-- CoinPay is invoice-based: each payment buys one term, so we track a paid
-- subscription as profiles.plan + profiles.plan_expires_at. The webhook
-- records payments in plan_payments (idempotency) and extends the expiry.

-- When the current paid period lapses, the effective plan falls back to free.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.plan_expires_at IS
  'When the current paid plan period ends. NULL or past = treat as free (YouTube-only streaming).';

-- One row per CoinPay payment. Service role writes; users read their own.
CREATE TABLE IF NOT EXISTS public.plan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coinpay_payment_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('plus', 'pro', 'team')),
  amount_usd NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Set once the plan has been granted, so duplicate webhook events
  -- (crypto confirmed, then merchant payout forwarded) only extend once.
  credited_at TIMESTAMPTZ,
  tx_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.plan_payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS plan_payments_user_id_idx ON public.plan_payments(user_id);

-- Users can see their own payment history. Inserts/updates come from the
-- service role (webhook + checkout), which bypasses RLS.
CREATE POLICY "Users can view own plan payments"
  ON public.plan_payments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER plan_payments_updated_at
  BEFORE UPDATE ON public.plan_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Atomically grant/extend a paid plan. Extends from the later of now() and
-- the current expiry, so stacking payments accumulates time. SECURITY DEFINER
-- so it can run from the service-role webhook context.
CREATE OR REPLACE FUNCTION public.grant_plan(
  p_user_id UUID,
  p_plan TEXT,
  p_days INTEGER
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  new_expiry TIMESTAMPTZ;
BEGIN
  UPDATE public.profiles
  SET plan = p_plan,
      plan_expires_at = GREATEST(NOW(), COALESCE(plan_expires_at, NOW()))
                          + (p_days || ' days')::interval,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING plan_expires_at INTO new_expiry;

  RETURN new_expiry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
