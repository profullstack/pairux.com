-- RPC function: create_session
-- Creates a new session with the authenticated user as host
CREATE OR REPLACE FUNCTION public.create_session(
  p_settings JSONB DEFAULT NULL
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_default_settings JSONB := '{"quality": "medium", "allowControl": true, "maxParticipants": 5}'::jsonb;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Create the session
  INSERT INTO public.sessions (host_user_id, settings, status)
  VALUES (
    auth.uid(),
    COALESCE(p_settings, v_default_settings),
    'created'
  )
  RETURNING * INTO v_session;

  -- Add host as participant
  INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
  SELECT
    v_session.id,
    auth.uid(),
    COALESCE(p.display_name, 'Host'),
    'host',
    'granted'
  FROM public.profiles p
  WHERE p.id = auth.uid();

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function: join_session
-- Joins an existing session by join code
CREATE OR REPLACE FUNCTION public.join_session(
  p_join_code TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS public.session_participants AS $$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
  v_display_name TEXT;
  v_user_id UUID;
  v_current_count INTEGER;
  v_max_participants INTEGER;
BEGIN
  v_user_id := auth.uid();

  -- Find the session by join code
  SELECT * INTO v_session
  FROM public.sessions
  WHERE join_code = UPPER(p_join_code)
    AND status IN ('created', 'active', 'paused');

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or has ended';
  END IF;

  -- Check max participants
  v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 5);
  SELECT COUNT(*) INTO v_current_count
  FROM public.session_participants
  WHERE session_id = v_session.id AND left_at IS NULL;

  IF v_current_count >= v_max_participants THEN
    RAISE EXCEPTION 'Session is full';
  END IF;

  -- Determine display name
  IF v_user_id IS NOT NULL THEN
    -- Authenticated user: use provided name or profile name
    SELECT COALESCE(p_display_name, p.display_name, 'User') INTO v_display_name
    FROM public.profiles p
    WHERE p.id = v_user_id;

    -- Check if already a participant
    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id
      AND user_id = v_user_id
      AND left_at IS NULL;

    IF v_participant IS NOT NULL THEN
      -- Already joined, return existing participation
      RETURN v_participant;
    END IF;
  ELSE
    -- Guest: require display name
    IF p_display_name IS NULL OR p_display_name = '' THEN
      RAISE EXCEPTION 'Display name required for guests';
    END IF;
    v_display_name := p_display_name;
  END IF;

  -- Create participant record
  INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
  VALUES (v_session.id, v_user_id, v_display_name, 'viewer', 'view-only')
  RETURNING * INTO v_participant;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function: end_session
-- Ends a session (host only)
CREATE OR REPLACE FUNCTION public.end_session(
  p_session_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Find and update the session (only if host)
  UPDATE public.sessions
  SET status = 'ended', ended_at = NOW()
  WHERE id = p_session_id
    AND host_user_id = auth.uid()
    AND status != 'ended'
  RETURNING * INTO v_session;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the host';
  END IF;

  -- Mark all participants as left
  UPDATE public.session_participants
  SET left_at = NOW()
  WHERE session_id = p_session_id AND left_at IS NULL;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function: update_control_state
-- Updates control state for a participant (host only)
CREATE OR REPLACE FUNCTION public.update_control_state(
  p_session_id UUID,
  p_participant_id UUID,
  p_control_state public.control_state
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
  WHERE id = p_session_id AND host_user_id = auth.uid();

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the host';
  END IF;

  -- Update participant control state
  UPDATE public.session_participants
  SET control_state = p_control_state
  WHERE id = p_participant_id
    AND session_id = p_session_id
    AND left_at IS NULL
  RETURNING * INTO v_participant;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function: request_control
-- Allows a viewer to request control
CREATE OR REPLACE FUNCTION public.request_control(
  p_session_id UUID
)
RETURNS public.session_participants AS $$
DECLARE
  v_participant public.session_participants;
BEGIN
  -- Find and update own participant record
  UPDATE public.session_participants
  SET control_state = 'requested'
  WHERE session_id = p_session_id
    AND (user_id = auth.uid() OR (auth.uid() IS NULL AND id = p_session_id))
    AND role = 'viewer'
    AND control_state = 'view-only'
    AND left_at IS NULL
  RETURNING * INTO v_participant;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Cannot request control';
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function: leave_session
-- Allows a participant to leave a session
CREATE OR REPLACE FUNCTION public.leave_session(
  p_session_id UUID
)
RETURNS public.session_participants AS $$
DECLARE
  v_participant public.session_participants;
BEGIN
  -- Mark participant as left
  UPDATE public.session_participants
  SET left_at = NOW()
  WHERE session_id = p_session_id
    AND user_id = auth.uid()
    AND left_at IS NULL
  RETURNING * INTO v_participant;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
