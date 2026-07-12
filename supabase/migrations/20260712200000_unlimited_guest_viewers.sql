-- Watch-only guests are UNLIMITED. The plan listener cap applies only to
-- authenticated participants (who can publish/present); logged-out guests just
-- subscribe, so they neither hit the cap nor count toward it. Rewrites
-- join_session: the guest branch drops its cap check, and the authed cap counts
-- only user_id IS NOT NULL participants. Default cap bumped 5 -> 20 (free).
CREATE OR REPLACE FUNCTION public.join_session(p_join_code text, p_display_name text DEFAULT NULL::text)
RETURNS session_participants
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
  v_display_name TEXT;
  v_user_id UUID;
  v_current_count INTEGER;
  v_max_participants INTEGER;
BEGIN
  v_user_id := auth.uid();

  SELECT * INTO v_session
  FROM public.sessions
  WHERE join_code = UPPER(p_join_code)
    AND status IN ('created', 'active', 'paused');

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or has ended';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(p_display_name, p.display_name, 'User') INTO v_display_name
    FROM public.profiles p WHERE p.id = v_user_id;

    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id AND user_id = v_user_id AND left_at IS NULL;

    IF v_participant IS NOT NULL THEN
      RETURN v_participant;
    END IF;

    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id AND user_id = v_user_id AND left_at IS NOT NULL
    ORDER BY left_at DESC LIMIT 1;

    IF v_participant IS NOT NULL THEN
      -- Cap counts AUTHENTICATED participants only (guests are unlimited).
      v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 20);
      SELECT COUNT(*) INTO v_current_count
      FROM public.session_participants
      WHERE session_id = v_session.id AND left_at IS NULL AND user_id IS NOT NULL;

      IF v_current_count >= v_max_participants THEN
        RAISE EXCEPTION 'Session is full';
      END IF;

      UPDATE public.session_participants
      SET left_at = NULL,
          display_name = COALESCE(p_display_name, v_participant.display_name),
          connection_status = 'connected',
          last_seen_at = NOW()
      WHERE id = v_participant.id
      RETURNING * INTO v_participant;
      RETURN v_participant;
    END IF;

    v_max_participants := COALESCE((v_session.settings->>'maxParticipants')::INTEGER, 20);
    SELECT COUNT(*) INTO v_current_count
    FROM public.session_participants
    WHERE session_id = v_session.id AND left_at IS NULL AND user_id IS NOT NULL;

    IF v_current_count >= v_max_participants THEN
      RAISE EXCEPTION 'Session is full';
    END IF;

    INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
    VALUES (v_session.id, v_user_id, v_display_name, 'viewer', 'view-only')
    ON CONFLICT (session_id, user_id) WHERE left_at IS NULL AND user_id IS NOT NULL
    DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING * INTO v_participant;

  ELSE
    -- Guest: watch-only, UNLIMITED — no cap check.
    IF p_display_name IS NULL OR p_display_name = '' THEN
      RAISE EXCEPTION 'Display name required for guests';
    END IF;
    v_display_name := p_display_name;

    INSERT INTO public.session_participants (session_id, user_id, display_name, role, control_state)
    VALUES (v_session.id, NULL, v_display_name, 'viewer', 'view-only')
    RETURNING * INTO v_participant;
  END IF;

  RETURN v_participant;
END;
$function$;
