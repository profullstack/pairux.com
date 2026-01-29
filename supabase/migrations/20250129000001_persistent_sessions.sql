-- Persistent Sessions Migration
-- Sessions no longer hard-end from the UI. The host "leaves" instead of "ending".
-- Join URLs remain valid indefinitely. Hosts can regenerate join codes to rotate access.

-- =============================================================================
-- STEP 1: host_leave_session RPC
-- Host disconnects gracefully but room stays alive for viewers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.host_leave_session(
  p_session_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify caller is current host, creator, or original host
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (current_host_id = auth.uid() OR creator_id = auth.uid() OR host_user_id = auth.uid())
    AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the host';
  END IF;

  -- End any active media sessions for this host
  UPDATE public.media_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE room_id = p_session_id
    AND publisher_id = auth.uid()
    AND status IN ('active', 'paused');

  -- Clear current host and pause the room (room stays alive!)
  UPDATE public.sessions
  SET
    current_host_id = NULL,
    status = 'paused'
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  -- NOTE: We do NOT set ended_at
  -- NOTE: We do NOT mark participants as left
  -- The room survives for viewers to keep chatting

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- STEP 2: regenerate_join_code RPC
-- Generates a new join code, invalidating the old invite URL
-- =============================================================================

CREATE OR REPLACE FUNCTION public.regenerate_join_code(
  p_session_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_new_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only creator or original host can regenerate
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (creator_id = auth.uid() OR host_user_id = auth.uid())
    AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the creator';
  END IF;

  -- Generate new unique code using existing utility function
  v_new_code := public.generate_unique_join_code();

  -- Update the session with new code
  UPDATE public.sessions
  SET join_code = v_new_code
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- STEP 3: Update join_session to support rejoining
-- When an authenticated user with a previous left_at tries to rejoin,
-- re-activate their existing participant row instead of creating a duplicate
-- =============================================================================

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

    -- Check if previously left and wants to rejoin
    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id
      AND user_id = v_user_id
      AND left_at IS NOT NULL
    ORDER BY left_at DESC
    LIMIT 1;

    IF v_participant IS NOT NULL THEN
      -- Check max participants before reactivating
      v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 5);
      SELECT COUNT(*) INTO v_current_count
      FROM public.session_participants
      WHERE session_id = v_session.id AND left_at IS NULL;

      IF v_current_count >= v_max_participants THEN
        RAISE EXCEPTION 'Session is full';
      END IF;

      -- Rejoin: clear left_at, update display name and connection status
      UPDATE public.session_participants
      SET left_at = NULL,
          display_name = COALESCE(p_display_name, v_participant.display_name),
          connection_status = 'connected',
          last_seen_at = NOW()
      WHERE id = v_participant.id
      RETURNING * INTO v_participant;
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
