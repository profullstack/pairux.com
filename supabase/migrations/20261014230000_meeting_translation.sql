-- Live meeting translation (@profullstack/live-translate): prepaid credit sold
-- as Day/Month passes through the existing CoinPay checkout, a few free
-- meetings per host per day, and a usage ledger. The meeting HOST pays for
-- every listener in their meeting. Money is integer micro-USD.
--
-- Every function is SECURITY DEFINER and callable by the service role only:
-- the API routes decide who is charged, never the browser.

ALTER TABLE public.plan_payments DROP CONSTRAINT IF EXISTS plan_payments_plan_check;
ALTER TABLE public.plan_payments ADD CONSTRAINT plan_payments_plan_check
  CHECK (plan IN ('plus', 'pro', 'team', 'translation_day', 'translation_month'));

CREATE TABLE IF NOT EXISTS public.translation_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_micros BIGINT NOT NULL CHECK (balance_micros >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.translation_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcription', 'voice')),
  units BIGINT NOT NULL CHECK (units > 0),
  cost_micros BIGINT NOT NULL,
  charge_micros BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'charged', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS translation_usage_user_idx ON public.translation_usage (user_id, created_at DESC);

-- A free meeting is a lease per (host, meeting), renewed while translation runs.
-- sessions = { "<meeting id>": <lease end, epoch ms> }.
CREATE TABLE IF NOT EXISTS public.translation_free_days (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  uses INTEGER NOT NULL CHECK (uses >= 1),
  sessions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.translation_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_free_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own translation wallet" ON public.translation_wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can view own translation usage" ON public.translation_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can view own free translation" ON public.translation_free_days FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Renew and report an active free lease for this meeting.
CREATE OR REPLACE FUNCTION public.translation_free_active(p_user UUID, p_session TEXT, p_lease_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  UPDATE public.translation_free_days
  SET sessions = sessions || jsonb_build_object(p_session, now_ms + p_lease_seconds * 1000)
  WHERE user_id = p_user AND (sessions->>p_session)::BIGINT > now_ms;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Start (or rejoin) a free meeting: true when a lease exists or one of today's
-- free meetings is left. One row per day serializes concurrent starts.
CREATE OR REPLACE FUNCTION public.translation_free_begin(p_user UUID, p_session TEXT, p_limit INTEGER, p_lease_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  IF public.translation_free_active(p_user, p_session, p_lease_seconds) THEN RETURN TRUE; END IF;
  IF p_limit < 1 THEN RETURN FALSE; END IF;
  INSERT INTO public.translation_free_days AS daily (user_id, day, uses, sessions)
  VALUES (p_user, (NOW() AT TIME ZONE 'utc')::DATE, 1, jsonb_build_object(p_session, now_ms + p_lease_seconds * 1000))
  ON CONFLICT (user_id, day) DO UPDATE
    SET uses = daily.uses + 1, sessions = daily.sessions || EXCLUDED.sessions
    WHERE daily.uses < p_limit;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Reserve one charge before calling the provider: free (zero) inside a free
-- lease, else debited from unexpired credit. NULL = nothing to pay with.
CREATE OR REPLACE FUNCTION public.translation_reserve(
  p_user UUID, p_session TEXT, p_kind TEXT, p_units BIGINT, p_cost BIGINT, p_charge BIGINT, p_lease_seconds INTEGER)
RETURNS UUID AS $$
DECLARE charged BIGINT := 0; usage_id UUID;
BEGIN
  IF NOT public.translation_free_active(p_user, p_session, p_lease_seconds) THEN
    UPDATE public.translation_wallets SET balance_micros = balance_micros - p_charge, updated_at = NOW()
    WHERE user_id = p_user AND expires_at > NOW() AND balance_micros >= p_charge;
    IF NOT FOUND THEN RETURN NULL; END IF;
    charged := p_charge;
  END IF;
  INSERT INTO public.translation_usage (user_id, session_id, kind, units, cost_micros, charge_micros)
  VALUES (p_user, p_session, p_kind, p_units, p_cost, charged) RETURNING id INTO usage_id;
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Commit once the provider accepted; refund (credit returned) if it never did.
CREATE OR REPLACE FUNCTION public.translation_settle(p_id UUID, p_charged BOOLEAN)
RETURNS VOID AS $$
DECLARE undone RECORD;
BEGIN
  IF p_charged THEN
    UPDATE public.translation_usage SET status = 'charged' WHERE id = p_id AND status = 'reserved';
    RETURN;
  END IF;
  UPDATE public.translation_usage SET status = 'refunded' WHERE id = p_id AND status = 'reserved'
  RETURNING user_id, charge_micros INTO undone;
  IF FOUND AND undone.charge_micros > 0 THEN
    UPDATE public.translation_wallets SET balance_micros = balance_micros + undone.charge_micros, updated_at = NOW()
    WHERE user_id = undone.user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Credit a paid pass exactly once, in one statement: a second webhook
-- delivery (confirmed, then forwarded) finds credited_at set and adds nothing.
-- Credit left from an expired pass does not carry over; time stacks.
CREATE OR REPLACE FUNCTION public.translation_credit_payment(p_payment_id TEXT, p_days INTEGER, p_status TEXT)
RETURNS BOOLEAN AS $$
DECLARE paid RECORD;
BEGIN
  UPDATE public.plan_payments SET credited_at = NOW(), status = p_status, updated_at = NOW()
  WHERE coinpay_payment_id = p_payment_id AND credited_at IS NULL AND plan LIKE 'translation\_%'
  RETURNING user_id, amount_usd INTO paid;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.translation_wallets AS wallet (user_id, balance_micros, expires_at)
  VALUES (paid.user_id, (paid.amount_usd * 1000000)::BIGINT, NOW() + (p_days || ' days')::INTERVAL)
  ON CONFLICT (user_id) DO UPDATE SET
    balance_micros = CASE WHEN wallet.expires_at > NOW() THEN wallet.balance_micros ELSE 0 END + EXCLUDED.balance_micros,
    expires_at = GREATEST(wallet.expires_at, EXCLUDED.expires_at),
    updated_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.translation_free_active(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.translation_free_begin(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.translation_reserve(UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.translation_settle(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.translation_credit_payment(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.translation_free_active(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.translation_free_begin(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.translation_reserve(UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.translation_settle(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.translation_credit_payment(TEXT, INTEGER, TEXT) TO service_role;
