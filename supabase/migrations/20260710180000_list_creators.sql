-- Browse creators on /live even when nobody is live right now. Lists every
-- profile that has claimed a public handle, live creators first, then by
-- followers, then newest. Anon-readable (safe columns only), same SECURITY
-- DEFINER pattern as the rest of the public directory.
CREATE OR REPLACE FUNCTION public.list_creators(p_limit integer DEFAULT 24)
RETURNS TABLE(
  username text,
  display_name text,
  avatar_url text,
  bio text,
  follower_count bigint,
  is_live boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    (SELECT COUNT(*) FROM public.follows f WHERE f.creator_id = p.id) AS follower_count,
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.creator_id = p.id AND s.is_public = TRUE
        AND s.current_host_id IS NOT NULL
        AND s.host_last_seen_at > NOW() - live_ttl
    ) AS is_live
  FROM public.profiles p
  WHERE p.username IS NOT NULL
  ORDER BY is_live DESC, follower_count DESC, p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 24), 100));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_creators(integer) TO anon, authenticated;
