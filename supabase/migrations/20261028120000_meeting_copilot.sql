-- PairUX Copilot: an in-call AI agent for one owner (plans/MEETING-COPILOT.md).
-- Free self-hosted models first; paid cloud models are pay as you go at
-- provider cost + 10% from a prepaid wallet, or the owner's own keys.
-- Money is integer micro-USD.
--
-- Every function is SECURITY DEFINER and callable by the service role only:
-- the API routes decide who is charged, never the browser.

ALTER TABLE public.plan_payments DROP CONSTRAINT IF EXISTS plan_payments_plan_check;
ALTER TABLE public.plan_payments ADD CONSTRAINT plan_payments_plan_check
  CHECK (plan IN ('plus', 'pro', 'team', 'translation_day', 'translation_month',
                  'copilot_credit_5', 'copilot_credit_20', 'copilot_credit_50'));

CREATE TABLE IF NOT EXISTS public.meeting_copilots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The owner's participant id in the meeting ("you" in the transcript), '' if unknown.
  participant_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'general',
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'free', 'byok', 'cloud')),
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  title TEXT,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  figures JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_ups JSONB,
  review JSONB,
  providers JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS meeting_copilots_user_idx ON public.meeting_copilots (user_id, started_at DESC);
ALTER TABLE public.meeting_copilots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meeting_copilots_owner_read ON public.meeting_copilots;
CREATE POLICY meeting_copilots_owner_read ON public.meeting_copilots
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Per-user preferences and BYOK keys (AES-256-GCM ciphertext; only the API decrypts).
CREATE TABLE IF NOT EXISTS public.copilot_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'free', 'byok', 'cloud')),
  role TEXT NOT NULL DEFAULT 'general',
  anthropic_key TEXT,
  anthropic_last4 TEXT,
  openai_key TEXT,
  openai_last4 TEXT,
  elevenlabs_key TEXT,
  elevenlabs_last4 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.copilot_settings ENABLE ROW LEVEL SECURITY;
-- No policies: browsers never read key material; the API answers masked values.

CREATE TABLE IF NOT EXISTS public.copilot_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.copilot_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS copilot_wallets_owner_read ON public.copilot_wallets;
CREATE POLICY copilot_wallets_owner_read ON public.copilot_wallets
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.copilot_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcription', 'llm')),
  units BIGINT NOT NULL CHECK (units >= 0),
  cost_micros BIGINT NOT NULL CHECK (cost_micros >= 0),
  charge_micros BIGINT NOT NULL CHECK (charge_micros >= 0),
  status TEXT NOT NULL DEFAULT 'charged' CHECK (status IN ('charged', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS copilot_usage_user_idx ON public.copilot_usage (user_id, created_at DESC);
ALTER TABLE public.copilot_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS copilot_usage_owner_read ON public.copilot_usage;
CREATE POLICY copilot_usage_owner_read ON public.copilot_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Take one charge from the wallet. A model call's cost is only known after it
-- ran (the caller checked the balance first), so the charge takes whatever is
-- left when it exceeds the balance. Returns the ledger id, or NULL when the
-- wallet is empty (nothing is taken then).
CREATE OR REPLACE FUNCTION public.copilot_charge(
  p_user UUID, p_session TEXT, p_provider TEXT, p_kind TEXT,
  p_units BIGINT, p_cost BIGINT, p_charge BIGINT)
RETURNS UUID AS $$
DECLARE usage_id UUID; balance BIGINT; taken BIGINT;
BEGIN
  IF p_charge < 0 OR p_cost < 0 THEN RAISE EXCEPTION 'negative charge'; END IF;
  SELECT balance_micros INTO balance FROM public.copilot_wallets WHERE user_id = p_user FOR UPDATE;
  IF balance IS NULL OR balance <= 0 THEN RETURN NULL; END IF;
  taken := LEAST(balance, p_charge);
  UPDATE public.copilot_wallets SET balance_micros = balance_micros - taken, updated_at = NOW()
  WHERE user_id = p_user;
  INSERT INTO public.copilot_usage (user_id, session_id, provider, kind, units, cost_micros, charge_micros)
  VALUES (p_user, p_session, p_provider, p_kind, p_units, p_cost, taken)
  RETURNING id INTO usage_id;
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Give a charge back (the provider call failed after we took it). Once only.
CREATE OR REPLACE FUNCTION public.copilot_refund(p_id UUID)
RETURNS BOOLEAN AS $$
DECLARE used RECORD;
BEGIN
  UPDATE public.copilot_usage SET status = 'refunded'
  WHERE id = p_id AND status = 'charged'
  RETURNING user_id, charge_micros INTO used;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE public.copilot_wallets SET balance_micros = balance_micros + used.charge_micros, updated_at = NOW()
  WHERE user_id = used.user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A settled top-up: marked credited and added to the wallet in one statement.
CREATE OR REPLACE FUNCTION public.copilot_credit_payment(p_payment_id TEXT, p_status TEXT)
RETURNS BOOLEAN AS $$
DECLARE paid RECORD;
BEGIN
  UPDATE public.plan_payments SET credited_at = NOW(), status = p_status, updated_at = NOW()
  WHERE coinpay_payment_id = p_payment_id AND credited_at IS NULL AND plan LIKE 'copilot\_credit\_%'
  RETURNING user_id, amount_usd INTO paid;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.copilot_wallets AS wallet (user_id, balance_micros)
  VALUES (paid.user_id, (paid.amount_usd * 1000000)::BIGINT)
  ON CONFLICT (user_id) DO UPDATE SET
    balance_micros = wallet.balance_micros + EXCLUDED.balance_micros,
    updated_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.copilot_charge(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.copilot_refund(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.copilot_credit_payment(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copilot_charge(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.copilot_refund(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.copilot_credit_payment(TEXT, TEXT) TO service_role;

GRANT SELECT ON public.meeting_copilots, public.copilot_wallets, public.copilot_usage TO authenticated;
GRANT ALL ON public.meeting_copilots, public.copilot_settings, public.copilot_wallets, public.copilot_usage TO service_role;
