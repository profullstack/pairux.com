-- Likes + comments on a public live (a session). Both are account-based and go
-- through SECURITY DEFINER RPCs (same pattern as the rest of the directory).
-- They live on the live detail page /l/<join_code>, which works for live and
-- past lives alike.

CREATE TABLE IF NOT EXISTS public.session_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, session_id)
);
ALTER TABLE public.session_likes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS session_likes_session_idx ON public.session_likes(session_id);
DROP POLICY IF EXISTS "own likes" ON public.session_likes;
CREATE POLICY "own likes" ON public.session_likes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.session_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.session_comments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS session_comments_session_idx ON public.session_comments(session_id, created_at);
DROP POLICY IF EXISTS "own comments" ON public.session_comments;
CREATE POLICY "own comments" ON public.session_comments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Like a public session. Returns the new like count.
CREATE OR REPLACE FUNCTION public.like_session(p_session_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO public.session_likes (user_id, session_id)
  SELECT auth.uid(), s.id FROM public.sessions s WHERE s.id = p_session_id AND s.is_public = TRUE
  ON CONFLICT (user_id, session_id) DO NOTHING;
  RETURN (SELECT COUNT(*) FROM public.session_likes WHERE session_id = p_session_id);
END; $function$;
GRANT EXECUTE ON FUNCTION public.like_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlike_session(p_session_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.session_likes WHERE user_id = auth.uid() AND session_id = p_session_id;
  RETURN (SELECT COUNT(*) FROM public.session_likes WHERE session_id = p_session_id);
END; $function$;
GRANT EXECUTE ON FUNCTION public.unlike_session(uuid) TO authenticated;

-- Post a comment on a public session. Returns the new comment id.
CREATE OR REPLACE FUNCTION public.add_comment(p_session_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_body text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_body := btrim(COALESCE(p_body, ''));
  IF length(v_body) < 1 THEN RAISE EXCEPTION 'Comment cannot be empty'; END IF;
  v_body := left(v_body, 1000);
  IF NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = p_session_id AND s.is_public = TRUE) THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  INSERT INTO public.session_comments (session_id, user_id, body)
  VALUES (p_session_id, auth.uid(), v_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.add_comment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.session_comments WHERE id = p_comment_id AND user_id = auth.uid();
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;

-- Comments for a public session, oldest first, with author info + whether the
-- caller owns each (so the UI can show a delete button).
CREATE OR REPLACE FUNCTION public.list_comments(p_session_id uuid, p_limit integer DEFAULT 200)
RETURNS TABLE(
  id uuid, body text, created_at timestamptz,
  author_username text, author_display_name text, author_avatar_url text, is_mine boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id, c.body, c.created_at,
    p.username, p.display_name, p.avatar_url,
    (auth.uid() IS NOT NULL AND c.user_id = auth.uid())
  FROM public.session_comments c
  JOIN public.sessions s ON s.id = c.session_id AND s.is_public = TRUE
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.session_id = p_session_id
  ORDER BY c.created_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_comments(uuid, integer) TO anon, authenticated;

-- Public detail for one live by join code (the /l/<join_code> page). Safe columns
-- + like/comment counts + whether the caller liked it.
CREATE OR REPLACE FUNCTION public.get_public_session(p_join_code text)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text,
  like_count bigint, comment_count bigint, liked boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT s.id, s.join_code, s.subject, s.description, s.banner_url, s.status,
    (s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) AS is_live,
    (SELECT COUNT(*) FROM public.session_participants sp WHERE sp.session_id = s.id AND sp.left_at IS NULL) AS viewer_count,
    s.published_at, s.created_at,
    p.username, p.display_name, p.avatar_url,
    (SELECT COUNT(*) FROM public.session_likes sl WHERE sl.session_id = s.id) AS like_count,
    (SELECT COUNT(*) FROM public.session_comments sc WHERE sc.session_id = s.id) AS comment_count,
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.session_likes sl WHERE sl.session_id = s.id AND sl.user_id = auth.uid()
    )) AS liked
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  WHERE s.is_public = TRUE AND lower(s.join_code) = lower(btrim(COALESCE(p_join_code, '')))
  LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_public_session(text) TO anon, authenticated;
