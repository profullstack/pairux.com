-- Optional website link per channel, shown on /@<handle> as an identity link
-- (rel="me") and in the channel directory. The app normalizes input (adds
-- https://, rejects non-http schemes) before calling update_channel; the CHECK
-- constraint is the backstop so nothing but an http(s) URL can ever be stored.

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_website_url_format;
ALTER TABLE public.channels ADD CONSTRAINT channels_website_url_format CHECK (
  website_url IS NULL
  OR (
    char_length(website_url) <= 500
    AND website_url ~* '^https?://[^[:space:]/?#@]+\.[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'
  )
);

-- update_channel gains p_website_url: NULL leaves it unchanged, '' clears it.
-- The old 5-arg overload must go, or named-arg calls would be ambiguous.
DROP FUNCTION IF EXISTS public.update_channel(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.update_channel(
  p_channel_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.channels
  SET name = COALESCE(NULLIF(btrim(p_name), ''), name), description = COALESCE(p_description, description),
      avatar_url = COALESCE(p_avatar_url, avatar_url), banner_url = COALESCE(p_banner_url, banner_url),
      website_url = CASE
        WHEN p_website_url IS NULL THEN website_url
        ELSE NULLIF(btrim(p_website_url), '')
      END
  WHERE id = p_channel_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel not found or not yours'; END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.update_channel(uuid, text, text, text, text, text) TO authenticated;

-- get_channel: + website_url (return type changes, so drop and recreate).
DROP FUNCTION IF EXISTS public.get_channel(text);
CREATE FUNCTION public.get_channel(p_handle text)
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_subscribed boolean, is_owner boolean, is_live boolean,
  live_viewers bigint, owner_username text, owner_addr text, website_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id AND cs.subscriber_id = auth.uid())),
    (auth.uid() IS NOT NULL AND c.owner_id = auth.uid()),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
       AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.session_participants sp
       JOIN public.sessions s2 ON s2.id = sp.session_id
       WHERE s2.channel_id = c.id AND s2.is_public
         AND s2.current_host_id IS NOT NULL AND s2.host_last_seen_at > NOW() - live_ttl
         AND sp.left_at IS NULL),
    (SELECT p.username FROM public.profiles p WHERE p.id = c.owner_id),
    (SELECT COALESCE(p.username, c.owner_id::text) FROM public.profiles p WHERE p.id = c.owner_id),
    c.website_url
  FROM public.channels c
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_channel(text) TO anon, authenticated;

-- list_my_channels: + website_url so the dashboard can edit it.
DROP FUNCTION IF EXISTS public.list_my_channels();
CREATE FUNCTION public.list_my_channels()
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text, banner_url text,
  stream_key text, subscriber_count bigint, restream_enabled boolean, created_at timestamptz,
  website_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url, c.stream_key,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    c.restream_enabled, c.created_at, c.website_url
  FROM public.channels c WHERE c.owner_id = auth.uid() ORDER BY c.created_at ASC;
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_my_channels() TO authenticated;

-- list_all_channels (the /channels directory): + website_url.
DROP FUNCTION IF EXISTS public.list_all_channels(integer);
CREATE FUNCTION public.list_all_channels(p_limit integer DEFAULT 48)
RETURNS TABLE(handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_live boolean, live_count bigint, recording_count bigint,
  website_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.recordings r
      JOIN public.sessions s ON s.id = r.session_id
      WHERE r.channel_id = c.id AND r.status = 'ready' AND r.playback_url IS NOT NULL
        AND s.is_public = TRUE),
    c.website_url
  FROM public.channels c
  ORDER BY EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id) DESC, c.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 48), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_all_channels(integer) TO anon, authenticated;
