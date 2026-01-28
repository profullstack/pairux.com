-- ===========================================
-- Add SFU endpoint/room parameters to start_media_session
-- ===========================================
-- When mode='sfu', allow storing the LiveKit endpoint and room ID
-- so viewers can discover the SFU server to connect to.
-- ===========================================

CREATE OR REPLACE FUNCTION public.start_media_session(
  p_room_id UUID,
  p_mode public.session_mode DEFAULT 'p2p',
  p_capture_source JSONB DEFAULT NULL,
  p_sfu_endpoint TEXT DEFAULT NULL,
  p_sfu_room_id TEXT DEFAULT NULL
)
RETURNS public.media_sessions AS $$
DECLARE
  v_session public.sessions;
  v_media_session public.media_sessions;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify room exists and is not ended
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_room_id AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Room not found or has ended';
  END IF;

  -- End any existing active media sessions from this publisher in this room
  UPDATE public.media_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE room_id = p_room_id
    AND publisher_id = auth.uid()
    AND status = 'active';

  -- Create new media session (include SFU info when mode is 'sfu')
  INSERT INTO public.media_sessions (room_id, publisher_id, mode, capture_source, sfu_endpoint, sfu_room_id)
  VALUES (p_room_id, auth.uid(), p_mode, p_capture_source, p_sfu_endpoint, p_sfu_room_id)
  RETURNING * INTO v_media_session;

  -- Update room: set current host and activate room
  UPDATE public.sessions
  SET
    current_host_id = auth.uid(),
    host_last_seen_at = NOW(),
    status = 'active',
    mode = p_mode
  WHERE id = p_room_id;

  RETURN v_media_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
