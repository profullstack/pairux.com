-- /channels: every public live a creator has ever run (past + present, including
-- ended), newest first. /live stays "only live right now" (list_public_rooms
-- with p_live_only). Same safe-columns SECURITY DEFINER pattern.
CREATE OR REPLACE FUNCTION public.list_channels(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  mode session_mode, status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.join_code, s.subject, s.description, s.banner_url, s.mode, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp
      WHERE sp.session_id = s.id AND sp.left_at IS NULL) AS viewer_count,
    s.published_at, s.created_at,
    p.username AS host_username, p.display_name AS host_display_name, p.avatar_url AS host_avatar_url
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  WHERE s.is_public = TRUE
  ORDER BY
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    COALESCE(s.published_at, s.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_channels(integer, integer) TO anon, authenticated;
