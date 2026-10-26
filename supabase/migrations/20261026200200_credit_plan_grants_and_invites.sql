-- Credit codes and invites grant plan days, and the plan columns become
-- server-only.
--
-- 1. plan_grant_days: a redeemed code (@profullstack/redeem-credits) or an
--    invite bonus extends profiles.plan / plan_expires_at, the same columns a
--    CoinPay payment extends (plan_credit_payment), with the same rule: a
--    smaller plan while a bigger one is running adds time and keeps the bigger
--    plan. Service role only.
-- 2. invite_bonuses: one row per (invite, side) once the bonus is decided
--    (granted, or denied with a reason). The row is claimed before the grant,
--    so a retry or a race never pays twice.
-- 3. grant_plan was executable by anon and authenticated (SECURITY DEFINER,
--    default PUBLIC execute): anyone with the public anon key could give any
--    account any plan. Nothing in the app calls it. Service role only now.
-- 4. "Users can update own profile" let a signed-in user PATCH their own
--    plan / plan_expires_at through PostgREST. A trigger now keeps those two
--    columns unchanged for the anon and authenticated roles (and forces a new
--    row to free), so only the service role (webhook, credits) can grant a plan.

CREATE OR REPLACE FUNCTION public.plan_grant_days(
  p_user_id UUID,
  p_plan TEXT,
  p_days INTEGER
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_expiry TIMESTAMPTZ;
BEGIN
  IF p_plan NOT IN ('plus', 'pro', 'team') THEN
    RAISE EXCEPTION 'plan_grant_days: unknown plan %', p_plan;
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3660 THEN
    RAISE EXCEPTION 'plan_grant_days: days must be 1..3660, got %', p_days;
  END IF;

  UPDATE public.profiles
     SET plan = CASE
                  WHEN plan_expires_at > NOW()
                   AND array_position(ARRAY['free','plus','pro','team'], plan)
                       > array_position(ARRAY['free','plus','pro','team'], p_plan)
                  THEN plan
                  ELSE p_plan
                END,
         plan_expires_at = GREATEST(NOW(), COALESCE(plan_expires_at, NOW()))
                             + (p_days || ' days')::INTERVAL,
         updated_at = NOW()
   WHERE id = p_user_id
  RETURNING plan_expires_at INTO new_expiry;

  IF new_expiry IS NULL THEN
    RAISE EXCEPTION 'plan_grant_days: no profile %', p_user_id;
  END IF;
  RETURN new_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_grant_days(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_grant_days(UUID, TEXT, INTEGER) TO service_role;

CREATE TABLE IF NOT EXISTS public.invite_bonuses (
  invite_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('inviter', 'invitee')),
  user_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('granted', 'denied')),
  reason TEXT,
  days INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invite_id, side)
);
CREATE INDEX IF NOT EXISTS invite_bonuses_user_idx ON public.invite_bonuses (user_id, created_at);

ALTER TABLE public.invite_bonuses ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads or writes it.
REVOKE ALL ON public.invite_bonuses FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.grant_plan(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_plan(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_protect_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.plan := 'free';
      NEW.plan_expires_at := NULL;
    ELSE
      NEW.plan := OLD.plan;
      NEW.plan_expires_at := OLD.plan_expires_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_plan ON public.profiles;
CREATE TRIGGER profiles_protect_plan
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_plan();
