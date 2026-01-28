-- Push Subscriptions Table
-- Stores Web Push subscription info per device/browser per user
-- Supports both authenticated users and guests (via participant_id)

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES public.session_participants(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(endpoint)
);

-- Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_participant_id_idx ON public.push_subscriptions(participant_id);

-- RLS Policies

-- Authenticated users can view their own subscriptions
CREATE POLICY "Users can view own push subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can insert their own subscriptions
CREATE POLICY "Users can create push subscriptions"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can delete their own subscriptions
CREATE POLICY "Users can delete own push subscriptions"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Guests can insert subscriptions (user_id must be NULL, participant_id required)
CREATE POLICY "Guests can create push subscriptions"
  ON public.push_subscriptions FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL AND participant_id IS NOT NULL);

-- Guests can delete their own subscriptions by endpoint (via RPC only)
CREATE POLICY "Guests can delete own push subscriptions"
  ON public.push_subscriptions FOR DELETE
  TO anon
  USING (user_id IS NULL AND participant_id IS NOT NULL);

-- Updated_at trigger
CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Grant permissions
GRANT ALL ON public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO anon;

-- RPC: Upsert push subscription (handles re-subscribe on same endpoint)
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_user_agent TEXT DEFAULT NULL,
  p_participant_id UUID DEFAULT NULL
)
RETURNS public.push_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_subscription public.push_subscriptions;
BEGIN
  v_user_id := auth.uid();

  -- Either user_id or participant_id must be provided
  IF v_user_id IS NULL AND p_participant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or participant ID must be provided';
  END IF;

  -- Upsert: insert or update on conflict (same endpoint)
  INSERT INTO public.push_subscriptions (user_id, participant_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_user_id, p_participant_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = COALESCE(v_user_id, push_subscriptions.user_id),
    participant_id = COALESCE(p_participant_id, push_subscriptions.participant_id),
    p256dh = p_p256dh,
    auth = p_auth,
    user_agent = COALESCE(p_user_agent, push_subscriptions.user_agent),
    updated_at = NOW()
  RETURNING * INTO v_subscription;

  RETURN v_subscription;
END;
$$;

-- RPC: Remove push subscription by endpoint
CREATE OR REPLACE FUNCTION public.remove_push_subscription(
  p_endpoint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint
    AND (user_id = auth.uid() OR (auth.uid() IS NULL AND user_id IS NULL))
  RETURNING TRUE INTO v_deleted;

  RETURN COALESCE(v_deleted, FALSE);
END;
$$;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_push_subscription TO anon, authenticated;
