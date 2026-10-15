-- Sessions that actually connected, and the Realtime feeds the session pages
-- already subscribe to.
--
-- 1. Activation signal. Two session_participants rows prove only that a viewer
--    clicked join; they exist for sessions whose video never arrived. A viewer
--    page now reports once its <video> is playing frames from the host, and
--    mark_media_connected records it:
--      session_participants.media_connected_at  first frame for that viewer
--      sessions.connected_at                    first frame for any viewer
--    and moves the room to status 'active'. Before this nothing in the web or
--    desktop flow ever set 'active' (only the unused start_media_session RPC
--    did), so every room sat at 'created' until the host left ('paused').
--
--    Countable by SQL, e.g. activated sessions in the last 30 days:
--      SELECT count(*) FROM sessions WHERE connected_at > now() - interval '30 days';
--
-- 2. Realtime. useParticipants listens to session_participants and the guest
--    viewer listens to sessions UPDATEs, but the supabase_realtime publication
--    only ever got chat_messages, so both pages logged "Unable to subscribe to
--    changes" and saw no live updates.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS connected_at timestamptz;

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS media_connected_at timestamptz;

CREATE INDEX IF NOT EXISTS sessions_connected_at_idx
  ON public.sessions(connected_at) WHERE connected_at IS NOT NULL;

-- Called through POST /api/sessions/<id>/connected by a viewer whose video is
-- playing. The participant is identified the same way the signal route does:
-- by the participant row id (guests), or by the signed-in user's active row.
-- The host's own row never counts. Idempotent: first timestamps win.
CREATE OR REPLACE FUNCTION public.mark_media_connected(
  p_session_id uuid,
  p_participant_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_participant_id uuid;
BEGIN
  SELECT sp.id INTO v_participant_id
  FROM public.session_participants sp
  JOIN public.sessions s ON s.id = sp.session_id
  WHERE sp.session_id = p_session_id
    AND sp.left_at IS NULL
    AND sp.role <> 'host'
    AND s.status <> 'ended'
    AND (
      sp.id = p_participant_id
      OR (auth.uid() IS NOT NULL AND sp.user_id = auth.uid())
    )
  ORDER BY (sp.id = p_participant_id) DESC NULLS LAST
  LIMIT 1;

  IF v_participant_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.session_participants
  SET media_connected_at = COALESCE(media_connected_at, NOW())
  WHERE id = v_participant_id;

  UPDATE public.sessions
  SET
    connected_at = COALESCE(connected_at, NOW()),
    status = CASE WHEN status IN ('created', 'paused') THEN 'active'::session_status ELSE status END
  WHERE id = p_session_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_media_connected(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_media_connected(uuid, uuid) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'session_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;
  END IF;
END $$;
