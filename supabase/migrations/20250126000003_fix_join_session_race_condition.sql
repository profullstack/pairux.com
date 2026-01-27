-- Fix join_session race condition by using ON CONFLICT
-- This ensures idempotent behavior when the same user joins from multiple devices

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

  -- Determine display name first (needed for both paths)
  IF v_user_id IS NOT NULL THEN
    -- Authenticated user: use provided name or profile name
    SELECT COALESCE(p_display_name, p.display_name, 'User') INTO v_display_name
    FROM public.profiles p
    WHERE p.id = v_user_id;

    -- For authenticated users, use INSERT ... ON CONFLICT to handle race conditions
    -- First check if already a participant (as host or viewer)
    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id
      AND user_id = v_user_id
      AND left_at IS NULL;

    IF v_participant IS NOT NULL THEN
      -- Already joined (possibly as host), return existing participation
      RETURN v_participant;
    END IF;

    -- Check max participants before inserting
    v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 5);
    SELECT COUNT(*) INTO v_current_count
    FROM public.session_participants
    WHERE session_id = v_session.id AND left_at IS NULL;

    IF v_current_count >= v_max_participants THEN
      RAISE EXCEPTION 'Session is full';
    END IF;

    -- Insert with ON CONFLICT to handle race condition
    INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
    VALUES (v_session.id, v_user_id, v_display_name, 'viewer', 'view-only')
    ON CONFLICT (session_id, user_id) WHERE left_at IS NULL AND user_id IS NOT NULL
    DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING * INTO v_participant;

  ELSE
    -- Guest: require display name
    IF p_display_name IS NULL OR p_display_name = '' THEN
      RAISE EXCEPTION 'Display name required for guests';
    END IF;
    v_display_name := p_display_name;

    -- Check max participants for guests too
    v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 5);
    SELECT COUNT(*) INTO v_current_count
    FROM public.session_participants
    WHERE session_id = v_session.id AND left_at IS NULL;

    IF v_current_count >= v_max_participants THEN
      RAISE EXCEPTION 'Session is full';
    END IF;

    -- Create participant record for guest (no conflict possible with NULL user_id)
    INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
    VALUES (v_session.id, NULL, v_display_name, 'viewer', 'view-only')
    RETURNING * INTO v_participant;
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
