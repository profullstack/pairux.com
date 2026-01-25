-- RPC function: kick_participant
-- Allows the host to remove a participant from the session
CREATE OR REPLACE FUNCTION public.kick_participant(
  p_session_id UUID,
  p_participant_id UUID
)
RETURNS public.session_participants AS $$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify user is host of this session
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (host_user_id = auth.uid() OR current_host_id = auth.uid());

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the host';
  END IF;

  -- Verify participant exists and is not the host
  SELECT * INTO v_participant
  FROM public.session_participants
  WHERE id = p_participant_id
    AND session_id = p_session_id
    AND left_at IS NULL;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;

  IF v_participant.role = 'host' THEN
    RAISE EXCEPTION 'Cannot kick the host';
  END IF;

  -- Mark participant as left
  UPDATE public.session_participants
  SET left_at = NOW(), control_state = 'view-only'
  WHERE id = p_participant_id
  RETURNING * INTO v_participant;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add the function to the Database type definition (this is just documentation)
COMMENT ON FUNCTION public.kick_participant IS 'Kicks a participant from the session (host only)';
