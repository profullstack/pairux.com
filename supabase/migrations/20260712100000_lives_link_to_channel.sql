-- Surface the channel a live belongs to on the directory + detail RPCs so /live
-- and /l link to the channel (/@handle) rather than the host's /u profile.
-- (/u/<username> still exists — it's the user; /@<handle> is a channel, of which
-- a user may own several.)

DROP FUNCTION IF EXISTS public.list_public_rooms(integer, text, boolean);
DROP FUNCTION IF EXISTS public.get_public_session(text);

CREATE OR REPLACE FUNCTION public.list_public_rooms(
  p_limit integer DEFAULT 50, p_username text DEFAULT NULL, p_live_only boolean DEFAULT false)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  mode session_mode, status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text,
  channel_handle text, channel_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.mode, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at, p.username, p.display_name, p.avatar_url, ch.handle, ch.name
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  LEFT JOIN public.channels ch ON ch.id = s.channel_id
  WHERE s.is_public = TRUE AND s.status IN ('created','active','paused')
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    AND (p_username IS NULL OR lower(p.username) = lower(p_username))
    AND (NOT p_live_only OR (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl))
  ORDER BY (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC, s.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_public_rooms(integer, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_session(p_join_code text)
RETURNS TABLE(id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text,
  like_count bigint, comment_count bigint, liked boolean,
  channel_handle text, channel_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL),
    s.published_at, s.created_at, p.username, p.display_name, p.avatar_url,
    (SELECT COUNT(*) FROM public.session_likes sl WHERE sl.session_id = s.id),
    (SELECT COUNT(*) FROM public.session_comments sc WHERE sc.session_id = s.id),
    (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.session_likes sl WHERE sl.session_id = s.id AND sl.user_id = auth.uid())),
    ch.handle, ch.name
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  LEFT JOIN public.channels ch ON ch.id = s.channel_id
  WHERE s.is_public = TRUE AND lower(s.join_code) = lower(btrim(COALESCE(p_join_code, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_public_session(text) TO anon, authenticated;

-- A user's public profile (/u/<username>) lists all their channels.
CREATE OR REPLACE FUNCTION public.list_user_channels(p_username text)
RETURNS TABLE(handle text, name text, avatar_url text, banner_url text, subscriber_count bigint, is_live boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.handle, c.name, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl)
  FROM public.channels c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE p.username IS NOT NULL AND lower(p.username) = lower(btrim(COALESCE(p_username, '')))
  ORDER BY EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id) DESC, c.created_at DESC;
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_user_channels(text) TO anon, authenticated;
