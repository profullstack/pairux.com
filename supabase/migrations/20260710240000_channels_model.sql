-- YouTube-style channels. A user can own many channels; a channel has a public
-- @handle, name/description/avatar/banner, and an RTMP stream key (used by the
-- upcoming LiveKit Ingress). Public lives (sessions) belong to a channel. People
-- subscribe to channels. Managed from /dashboard; public page at /c/<handle>.
-- Public reads/writes go through SECURITY DEFINER RPCs (same pattern as /live).

CREATE TABLE IF NOT EXISTS public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  stream_key TEXT NOT NULL DEFAULT ('sk_live_' || encode(gen_random_bytes(24), 'hex')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channels_handle_format CHECK (handle ~ '^[A-Za-z0-9_]{3,30}$')
);
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS channels_handle_lower_idx ON public.channels(lower(handle));
CREATE UNIQUE INDEX IF NOT EXISTS channels_stream_key_idx ON public.channels(stream_key);
CREATE INDEX IF NOT EXISTS channels_owner_idx ON public.channels(owner_id);

-- Owners can read their own channels directly (incl. stream_key); public reads
-- of other channels go through get_channel (which omits the key).
DROP POLICY IF EXISTS "owners read own channels" ON public.channels;
CREATE POLICY "owners read own channels" ON public.channels FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

CREATE TRIGGER channels_updated_at BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- A public live belongs to a channel.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sessions_channel_idx ON public.sessions(channel_id);

CREATE TABLE IF NOT EXISTS public.channel_subscriptions (
  subscriber_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscriber_id, channel_id)
);
ALTER TABLE public.channel_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS channel_subs_channel_idx ON public.channel_subscriptions(channel_id);
DROP POLICY IF EXISTS "own channel subscriptions" ON public.channel_subscriptions;
CREATE POLICY "own channel subscriptions" ON public.channel_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = subscriber_id) WITH CHECK (auth.uid() = subscriber_id);

-- Create a channel for the caller. Returns the new channel id.
CREATE OR REPLACE FUNCTION public.create_channel(p_handle text, p_name text, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_handle text; v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_handle := btrim(COALESCE(p_handle, ''));
  IF v_handle !~ '^[A-Za-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'Handle must be 3-30 letters, numbers, or underscores';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channels WHERE lower(handle) = lower(v_handle)) THEN
    RAISE EXCEPTION 'That handle is taken';
  END IF;
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  INSERT INTO public.channels (owner_id, handle, name, description)
  VALUES (auth.uid(), v_handle, COALESCE(v_name, v_handle), NULLIF(btrim(COALESCE(p_description, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.create_channel(text, text, text) TO authenticated;

-- Update a channel's editable fields (owner only). NULL args leave a field as-is.
CREATE OR REPLACE FUNCTION public.update_channel(
  p_channel_id uuid, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL, p_banner_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.channels
  SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
      description = COALESCE(p_description, description),
      avatar_url = COALESCE(p_avatar_url, avatar_url),
      banner_url = COALESCE(p_banner_url, banner_url)
  WHERE id = p_channel_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel not found or not yours'; END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.update_channel(uuid, text, text, text, text) TO authenticated;

-- The caller's channels (with stream_key + subscriber count) — for /dashboard.
CREATE OR REPLACE FUNCTION public.list_my_channels()
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text,
  banner_url text, stream_key text, subscriber_count bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url, c.stream_key,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    c.created_at
  FROM public.channels c WHERE c.owner_id = auth.uid()
  ORDER BY c.created_at ASC;
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_my_channels() TO authenticated;

-- Public channel by handle (no stream_key) + subscriber count + caller state.
CREATE OR REPLACE FUNCTION public.get_channel(p_handle text)
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text,
  banner_url text, subscriber_count bigint, is_subscribed boolean, is_owner boolean,
  is_live boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id AND cs.subscriber_id = auth.uid())),
    (auth.uid() IS NOT NULL AND c.owner_id = auth.uid()),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
       AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl)
  FROM public.channels c WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_channel(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.subscribe_channel(p_handle text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ch uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_ch FROM public.channels WHERE lower(handle) = lower(btrim(COALESCE(p_handle, '')));
  IF v_ch IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  INSERT INTO public.channel_subscriptions (subscriber_id, channel_id) VALUES (auth.uid(), v_ch)
  ON CONFLICT DO NOTHING;
  RETURN (SELECT COUNT(*) FROM public.channel_subscriptions WHERE channel_id = v_ch);
END; $function$;
GRANT EXECUTE ON FUNCTION public.subscribe_channel(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unsubscribe_channel(p_handle text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ch uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_ch FROM public.channels WHERE lower(handle) = lower(btrim(COALESCE(p_handle, '')));
  IF v_ch IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  DELETE FROM public.channel_subscriptions WHERE subscriber_id = auth.uid() AND channel_id = v_ch;
  RETURN (SELECT COUNT(*) FROM public.channel_subscriptions WHERE channel_id = v_ch);
END; $function$;
GRANT EXECUTE ON FUNCTION public.unsubscribe_channel(text) TO authenticated;

-- A channel's streams (public sessions), live first then newest — the channel page.
CREATE OR REPLACE FUNCTION public.list_channel_streams(p_handle text, p_limit integer DEFAULT 60)
RETURNS TABLE(id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint, published_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at
  FROM public.sessions s
  JOIN public.channels c ON c.id = s.channel_id
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) AND s.is_public = TRUE
  ORDER BY (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    COALESCE(s.published_at, s.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_channel_streams(text, integer) TO anon, authenticated;

-- Assign a live to one of the caller's channels (owner-only on both sides).
CREATE OR REPLACE FUNCTION public.set_session_channel(p_session_id uuid, p_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Channel not found or not yours';
  END IF;
  UPDATE public.sessions SET channel_id = p_channel_id
  WHERE id = p_session_id
    AND (creator_id = auth.uid() OR host_user_id = auth.uid() OR current_host_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found or not yours'; END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.set_session_channel(uuid, uuid) TO authenticated;
