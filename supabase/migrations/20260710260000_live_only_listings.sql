-- We don't record/store lives yet, so a "past" live is a dead entry you can't
-- watch. Until recording (LiveKit Egress → storage → VOD) exists, only list
-- rooms that are live RIGHT NOW. The rows are preserved — we just stop showing
-- ended/idle ones — so history can return once recordings are saved.

CREATE OR REPLACE FUNCTION public.list_channel_streams(p_handle text, p_limit integer DEFAULT 60)
RETURNS TABLE(id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint, published_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.status, TRUE,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at
  FROM public.sessions s JOIN public.channels c ON c.id = s.channel_id
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) AND s.is_public = TRUE
    AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl
  ORDER BY COALESCE(s.published_at, s.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 100));
END; $function$;

CREATE OR REPLACE FUNCTION public.list_channels(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, join_code text, subject text, description text, banner_url text,
  mode session_mode, status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.mode, s.status, TRUE,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at,
    p.username, p.display_name, p.avatar_url
  FROM public.sessions s JOIN public.profiles p ON p.id = s.creator_id
  WHERE s.is_public = TRUE
    AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl
  ORDER BY COALESCE(s.published_at, s.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 100)) OFFSET GREATEST(0, COALESCE(p_offset, 0));
END; $function$;

CREATE OR REPLACE FUNCTION public.list_creator_lives(p_username text, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint, published_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.status, TRUE,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at
  FROM public.sessions s JOIN public.profiles p ON p.id = s.creator_id
  WHERE p.username IS NOT NULL AND lower(p.username) = lower(btrim(COALESCE(p_username, '')))
    AND s.is_public = TRUE
    AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl
  ORDER BY COALESCE(s.published_at, s.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END; $function$;

-- /channels becomes a directory OF channels (not a flat list of lives): every
-- channel, live ones first, then by subscribers.
CREATE OR REPLACE FUNCTION public.list_all_channels(p_limit integer DEFAULT 48)
RETURNS TABLE(handle text, name text, description text, avatar_url text, banner_url text, subscriber_count bigint, is_live boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl)
  FROM public.channels c
  ORDER BY EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id) DESC, c.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 48), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_all_channels(integer) TO anon, authenticated;
