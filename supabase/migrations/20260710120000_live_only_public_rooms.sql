-- The /live directory should list only rooms that are ACTIVELY live right now,
-- and a room must drop off the moment the host goes away — including a hard
-- app kill / crash where host_leave_session never runs.
--
-- current_host_id alone isn't enough: on a hard exit it's never cleared, leaving
-- "zombie" rooms live forever. So we add a host heartbeat: the desktop host pings
-- host_last_seen_at while live, and the live directory only shows rooms pinged
-- within LIVE_TTL. A killed host stops pinging and the room falls off on its own.
--
-- p_live_only is a flag (not a hard filter) because the /u/<username> profile
-- still lists a user's published rooms with a live/offline badge (default false).
-- /live passes true.

-- Heartbeat: the current host stamps host_last_seen_at. Host-only (matches the
-- session's current_host_id), SECURITY DEFINER so it runs under RLS.
CREATE OR REPLACE FUNCTION public.host_heartbeat(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.sessions
  SET host_last_seen_at = NOW()
  WHERE id = p_session_id
    AND status <> 'ended'
    AND (current_host_id = auth.uid() OR creator_id = auth.uid() OR host_user_id = auth.uid());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.host_heartbeat(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.list_public_rooms(integer, text);

CREATE OR REPLACE FUNCTION public.list_public_rooms(
  p_limit integer DEFAULT 50,
  p_username text DEFAULT NULL,
  p_live_only boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  join_code text,
  subject text,
  description text,
  mode session_mode,
  status session_status,
  is_live boolean,
  viewer_count bigint,
  published_at timestamptz,
  created_at timestamptz,
  host_username text,
  host_display_name text,
  host_avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- A host that hasn't pinged within this window is treated as gone.
  live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.join_code,
    s.subject,
    s.description,
    s.mode,
    s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (
      SELECT COUNT(*) FROM public.session_participants sp
      WHERE sp.session_id = s.id AND sp.left_at IS NULL
    ) AS viewer_count,
    s.published_at,
    s.created_at,
    p.username AS host_username,
    p.display_name AS host_display_name,
    p.avatar_url AS host_avatar_url
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  WHERE s.is_public = TRUE
    AND s.status IN ('created', 'active', 'paused')
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    AND (p_username IS NULL OR lower(p.username) = lower(p_username))
    -- Live directory: only rooms whose host pinged within the TTL.
    AND (
      NOT p_live_only
      OR (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl)
    )
  ORDER BY
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    s.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_public_rooms(integer, text, boolean) TO anon, authenticated;
