-- Server-side session recording via LiveKit Egress.
--
-- The egress service (already running on the SFU droplet) composites each SFU
-- room and uploads an MP4 straight to Supabase Storage's S3 endpoint. This
-- migration adds the storage bucket, the recordings table, an exactly-once
-- "recording started" flip on sessions, and public read RPCs + playback_url so
-- finished recordings can be watched later on /l/<join_code> and channel pages.

-- 1. Public bucket for finished recordings (lives are already public).
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. Exactly-once trigger flag: set when egress starts for a session.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS recording_started_at timestamptz;

-- 3. Recordings table. Written only by the service role (egress start/stop +
--    the LiveKit webhook); read publicly via SECURITY DEFINER RPCs below.
CREATE TABLE IF NOT EXISTS public.recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  creator_id uuid,
  egress_id text,
  storage_path text NOT NULL,
  playback_url text,
  subject text,
  status text NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'processing', 'ready', 'failed')),
  duration_seconds integer,
  size_bytes bigint,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recordings_session_idx ON public.recordings (session_id);
CREATE INDEX IF NOT EXISTS recordings_channel_ready_idx
  ON public.recordings (channel_id, created_at DESC) WHERE status = 'ready';
CREATE UNIQUE INDEX IF NOT EXISTS recordings_egress_idx
  ON public.recordings (egress_id) WHERE egress_id IS NOT NULL;

ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
-- No policies: service role bypasses RLS for writes; all reads go through the
-- SECURITY DEFINER RPCs below. (Deny-by-default for anon/authenticated.)

-- 4. mark_recording_started: atomically claims the "start recording" moment for
--    an SFU session with a live host, exactly once. Called from the heartbeat
--    for every session (public or not) — recording covers ALL sfu sessions.
CREATE OR REPLACE FUNCTION public.mark_recording_started(p_session_id uuid)
RETURNS TABLE(session_id uuid, channel_id uuid, creator_id uuid, subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  UPDATE public.sessions s SET recording_started_at = NOW()
  WHERE s.id = p_session_id
    AND s.mode = 'sfu'
    AND s.current_host_id IS NOT NULL
    AND s.recording_started_at IS NULL
    AND (s.current_host_id = auth.uid() OR s.creator_id = auth.uid() OR s.host_user_id = auth.uid())
  RETURNING s.id, s.channel_id, s.creator_id, s.subject;
END; $function$;
GRANT EXECUTE ON FUNCTION public.mark_recording_started(uuid) TO authenticated;

-- 5. Extend get_public_session with the latest ready recording's playback URL.
DROP FUNCTION IF EXISTS public.get_public_session(text);
CREATE OR REPLACE FUNCTION public.get_public_session(p_join_code text)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text,
  like_count bigint, comment_count bigint, liked boolean,
  channel_handle text, channel_name text, recording_url text
)
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
    ch.handle, ch.name,
    (SELECT r.playback_url FROM public.recordings r
      WHERE r.session_id = s.id AND r.status = 'ready' AND r.playback_url IS NOT NULL
      ORDER BY r.created_at DESC LIMIT 1)
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  LEFT JOIN public.channels ch ON ch.id = s.channel_id
  WHERE s.is_public = TRUE AND lower(s.join_code) = lower(btrim(COALESCE(p_join_code, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_public_session(text) TO anon, authenticated;

-- 6. list_channel_recordings: finished recordings for a channel's past-streams
--    list (watch later). Public read.
CREATE OR REPLACE FUNCTION public.list_channel_recordings(p_handle text, p_limit integer DEFAULT 30)
RETURNS TABLE(
  id uuid, join_code text, subject text, banner_url text, playback_url text,
  duration_seconds integer, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  RETURN QUERY
  SELECT r.id, s.join_code, COALESCE(r.subject, s.subject), s.banner_url, r.playback_url,
    r.duration_seconds, r.created_at
  FROM public.recordings r
  JOIN public.channels ch ON ch.id = r.channel_id
  JOIN public.sessions s ON s.id = r.session_id
  WHERE lower(ch.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND r.status = 'ready' AND r.playback_url IS NOT NULL AND s.is_public = TRUE
  ORDER BY r.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_channel_recordings(text, integer) TO anon, authenticated;
