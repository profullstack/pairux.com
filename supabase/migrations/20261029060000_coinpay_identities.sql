-- Sign in with CoinPay (apps/web/src/lib/coinpay-signin.ts).
--
-- One row binds a PairUX auth user to a CoinPay `sub`. Binding is by sub only,
-- never by email: coinpay_email is unverified contact information from CoinPay
-- and must never be used to find or merge an account. Server-only: RLS is on
-- with no policies, so only the service role reads or writes it.
CREATE TABLE IF NOT EXISTS public.coinpay_identities (
  coinpay_sub text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  coinpay_email text,
  coinpay_name text,
  created_via text NOT NULL CHECK (created_via IN ('connect', 'signup')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

ALTER TABLE public.coinpay_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coinpay_identities FROM anon, authenticated;
GRANT ALL ON public.coinpay_identities TO service_role;
