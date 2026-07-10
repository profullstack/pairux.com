-- Optional banner image for a published room, shown on /live. Hosts upload it
-- from the desktop publish modal (cover-cropped to 16:9 client-side); the web
-- endpoint stores it in the public room-banners bucket and sets banner_url.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- Public bucket for room banners (readable by anyone; writes go through the
-- service role in the upload route, which enforces host ownership).
INSERT INTO storage.buckets (id, name, public)
VALUES ('room-banners', 'room-banners', true)
ON CONFLICT (id) DO NOTHING;

-- Surface banner_url on the public directory.
DROP FUNCTION IF EXISTS public.list_public_rooms(integer, text, boolean);

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
  banner_url text,
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
  live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.join_code,
    s.subject,
    s.description,
    s.banner_url,
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
    AND (NOT p_live_only OR (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl))
  ORDER BY
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    s.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_public_rooms(integer, text, boolean) TO anon, authenticated;
