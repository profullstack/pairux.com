-- Only record PUBLIC lives, not every SFU session. Adds is_public to the
-- mark_recording_started gate — keeps recording load to the handful of public
-- lives instead of all 1:1 sessions (droplet is 4 vCPU; each composite ~2 CPU).
CREATE OR REPLACE FUNCTION public.mark_recording_started(p_session_id uuid)
RETURNS TABLE(session_id uuid, channel_id uuid, creator_id uuid, subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  UPDATE public.sessions s SET recording_started_at = NOW()
  WHERE s.id = p_session_id
    AND s.mode = 'sfu'
    AND s.is_public = TRUE
    AND s.current_host_id IS NOT NULL
    AND s.recording_started_at IS NULL
    AND (s.current_host_id = auth.uid() OR s.creator_id = auth.uid() OR s.host_user_id = auth.uid())
  RETURNING s.id, s.channel_id, s.creator_id, s.subject;
END; $function$;
GRANT EXECUTE ON FUNCTION public.mark_recording_started(uuid) TO authenticated;
