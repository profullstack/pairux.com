-- Cloud editing of recordings: trim an hour-long recording to the five minutes
-- that matter, fade in/out, add an intro/outro. An edit is a new recordings
-- row rendered by the web server (ffmpeg) from its parent and uploaded under
-- recordings/edits/<user>/<id>.mp4.
--
-- Edits are the owner's working copies, not the session's public recording:
-- they are written with channel_id NULL (so channel pages and counts, which
-- filter on channel_id, never list them) and get_public_session below skips
-- them when choosing a session's recording_url.
--
-- RLS stays deny-by-default; /api/v1/recordings checks ownership and uses the
-- service role.

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS parent_recording_id uuid REFERENCES public.recordings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_plan jsonb,
  ADD COLUMN IF NOT EXISTS edit_progress real,
  ADD COLUMN IF NOT EXISTS edit_error text,
  ADD COLUMN IF NOT EXISTS edit_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS recordings_creator_created_idx
  ON public.recordings (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recordings_edits_processing_idx
  ON public.recordings (edit_updated_at)
  WHERE status = 'processing' AND parent_recording_id IS NOT NULL;

-- Same as 20260829120000_public_session_channel_avatar.sql, plus
-- `parent_recording_id IS NULL` in the recording_url subquery.
DROP FUNCTION IF EXISTS public.get_public_session(text);
CREATE OR REPLACE FUNCTION public.get_public_session(p_join_code text)
RETURNS TABLE(
  id uuid, join_code text, subject text, description text, banner_url text,
  status session_status, is_live boolean, viewer_count bigint,
  published_at timestamptz, created_at timestamptz,
  host_username text, host_display_name text, host_avatar_url text,
  like_count bigint, comment_count bigint, liked boolean,
  channel_handle text, channel_name text, channel_avatar_url text,
  recording_url text
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
    ch.handle, ch.name, ch.avatar_url,
    (SELECT r.playback_url FROM public.recordings r
      WHERE r.session_id = s.id AND r.status = 'ready' AND r.playback_url IS NOT NULL
        AND r.parent_recording_id IS NULL
      ORDER BY r.created_at DESC LIMIT 1)
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  LEFT JOIN public.channels ch ON ch.id = s.channel_id
  WHERE s.is_public = TRUE AND lower(s.join_code) = lower(btrim(COALESCE(p_join_code, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_public_session(text) TO anon, authenticated;
