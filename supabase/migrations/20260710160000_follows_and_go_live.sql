-- Follow creators + notify followers when they go live.
--
-- Follows are account-based. Public reads/writes go through SECURITY DEFINER
-- RPCs (same pattern as the rest of /live) rather than loosening RLS.

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, creator_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> creator_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS follows_creator_idx ON public.follows(creator_id);

DROP POLICY IF EXISTS "Users manage their own follows" ON public.follows;
CREATE POLICY "Users manage their own follows"
  ON public.follows FOR ALL
  TO authenticated
  USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);

-- Dedupe go-live notifications: stamped when a live session notifies followers,
-- so repeated heartbeats / brief reconnects don't re-notify.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS live_notified_at TIMESTAMPTZ;

-- Follow a creator by username. Returns the creator's new follower count.
CREATE OR REPLACE FUNCTION public.follow_creator(p_username text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_creator uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_creator FROM public.profiles
   WHERE username IS NOT NULL AND lower(username) = lower(btrim(COALESCE(p_username, '')));
  IF v_creator IS NULL THEN RAISE EXCEPTION 'Creator not found'; END IF;
  IF v_creator = auth.uid() THEN RAISE EXCEPTION 'You cannot follow yourself'; END IF;

  INSERT INTO public.follows (follower_id, creator_id)
  VALUES (auth.uid(), v_creator)
  ON CONFLICT (follower_id, creator_id) DO NOTHING;

  RETURN (SELECT COUNT(*) FROM public.follows WHERE creator_id = v_creator);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.follow_creator(text) TO authenticated;

-- Unfollow. Returns the creator's new follower count.
CREATE OR REPLACE FUNCTION public.unfollow_creator(p_username text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_creator uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_creator FROM public.profiles
   WHERE username IS NOT NULL AND lower(username) = lower(btrim(COALESCE(p_username, '')));
  IF v_creator IS NULL THEN RAISE EXCEPTION 'Creator not found'; END IF;

  DELETE FROM public.follows WHERE follower_id = auth.uid() AND creator_id = v_creator;

  RETURN (SELECT COUNT(*) FROM public.follows WHERE creator_id = v_creator);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.unfollow_creator(text) TO authenticated;

-- Follow state for a creator: total followers + whether the caller follows them.
CREATE OR REPLACE FUNCTION public.get_follow_state(p_creator_id uuid)
RETURNS TABLE(follower_count bigint, is_following boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.follows f WHERE f.creator_id = p_creator_id),
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.follows f WHERE f.creator_id = p_creator_id AND f.follower_id = auth.uid()
    ));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_follow_state(uuid) TO anon, authenticated;

-- Atomically claim the "went live" notification for a public, currently-hosted
-- room. Returns the creator + subject + join_code only when THIS call flipped
-- live_notified_at (so the caller notifies followers exactly once); no rows
-- otherwise. The 1-hour guard means a brief drop/reconnect won't re-notify.
CREATE OR REPLACE FUNCTION public.mark_room_went_live(p_session_id uuid)
RETURNS TABLE(creator_id uuid, subject text, join_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  UPDATE public.sessions s
  SET live_notified_at = NOW()
  WHERE s.id = p_session_id
    AND s.is_public = TRUE
    AND s.current_host_id IS NOT NULL
    AND (s.current_host_id = auth.uid() OR s.creator_id = auth.uid() OR s.host_user_id = auth.uid())
    AND (s.live_notified_at IS NULL OR s.live_notified_at < NOW() - interval '1 hour')
  RETURNING s.creator_id, s.subject, s.join_code;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.mark_room_went_live(uuid) TO authenticated;

-- A creator's full live history: every public room they've published (including
-- ended ones), live rooms first, then newest.
CREATE OR REPLACE FUNCTION public.list_creator_lives(p_username text, p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.join_code, s.subject, s.description, s.banner_url, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp
      WHERE sp.session_id = s.id AND sp.left_at IS NULL) AS viewer_count,
    s.published_at, s.created_at
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  WHERE p.username IS NOT NULL
    AND lower(p.username) = lower(btrim(COALESCE(p_username, '')))
    AND s.is_public = TRUE
  ORDER BY
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    s.published_at DESC NULLS LAST,
    s.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.list_creator_lives(text, integer) TO anon, authenticated;
