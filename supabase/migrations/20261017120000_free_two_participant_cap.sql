-- Free rooms hold 2 participants (the host and one other person), as /pricing
-- has always said. Until now join_session only capped SIGNED-IN joiners, at
-- settings.maxParticipants = the owner's listener cap (Free 20), and anonymous
-- guests were never counted, so a Free room never filled.
--
-- Who takes which seat (mirrored by seatUsage() in @pairux/shared-types):
--
--   PARTICIPANT  can be heard or take control. The host (one seat, always held
--                for them, even while they reconnect), every signed-in joiner
--                (their SFU token may publish), and every anonymous guest in a
--                P2P room (a direct connection to the host: microphone, and the
--                host can hand them control).
--                Caps: Free 2, Plus 100, Pro 500, Team 2000.
--   LISTENER     an anonymous guest in an SFU room. The LiveKit token is
--                subscribe-only: they watch and listen, nothing else.
--                Caps: Free 20, Plus 100, Pro 500, Team 2000.
--
-- Agents keep their own limit (5, join_session_as_agent) and take no seat.
--
-- Caps come from the owner's plan RIGHT NOW (user_effective_plan, org plans
-- included), not from the value baked into sessions.settings at creation, so
-- an upgrade takes effect on the next join. settings.maxParticipants and
-- settings.maxListeners are kept in step for display only.
--
-- A seat is held while its row has been seen in the last 3 minutes. Rows were
-- never refreshed before (323 live-but-abandoned guest rows sat in open rooms
-- on 2026-10-17), so counting every row with left_at IS NULL would lock most
-- Free rooms for good. Clients now ping claim_session_seat every 30 s; the
-- desktop/mobile signaling stream does it for them server-side.
--
-- Nobody already in a call is removed: a row that is still fresh is let back
-- in without a check (reloads, token refreshes). A row that went quiet is
-- treated as a new join.

CREATE OR REPLACE FUNCTION public.plan_participant_cap(p_plan TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_plan WHEN 'team' THEN 2000 WHEN 'pro' THEN 500 WHEN 'plus' THEN 100 ELSE 2 END;
$$;

CREATE OR REPLACE FUNCTION public.plan_listener_cap(p_plan TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_plan WHEN 'team' THEN 2000 WHEN 'pro' THEN 500 WHEN 'plus' THEN 100 ELSE 20 END;
$$;

-- Seats in use and the caps that apply. p_exclude leaves one row out of the
-- count (the joiner's own row when it is being re-admitted).
CREATE OR REPLACE FUNCTION public.session_seat_usage(p_session_id UUID, p_exclude UUID DEFAULT NULL)
RETURNS TABLE (
  plan TEXT,
  participant_cap INTEGER,
  listener_cap INTEGER,
  participants INTEGER,
  listeners INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.sessions;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  plan := COALESCE(public.user_effective_plan(v_session.host_user_id), 'free');
  participant_cap := public.plan_participant_cap(plan);
  listener_cap := public.plan_listener_cap(plan);

  SELECT
    1 + COUNT(*) FILTER (WHERE sp.user_id IS NOT NULL OR v_session.mode::TEXT IS DISTINCT FROM 'sfu'),
    COUNT(*) FILTER (WHERE sp.user_id IS NULL AND v_session.mode::TEXT = 'sfu')
  INTO participants, listeners
  FROM public.session_participants sp
  WHERE sp.session_id = p_session_id
    AND sp.left_at IS NULL
    AND sp.kind = 'human'
    AND sp.user_id IS DISTINCT FROM v_session.host_user_id
    AND sp.last_seen_at > NOW() - INTERVAL '3 minutes'
    AND (p_exclude IS NULL OR sp.id <> p_exclude);

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.session_seat_usage(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_seat_usage(UUID, UUID) TO service_role;

-- NULL when the joiner fits, else which kind of seat ran out.
CREATE OR REPLACE FUNCTION public.session_seat_refusal(
  p_session_id UUID,
  p_signed_in BOOLEAN,
  p_exclude UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mode TEXT;
  v_usage RECORD;
BEGIN
  SELECT mode::TEXT INTO v_mode FROM public.sessions WHERE id = p_session_id;
  SELECT * INTO v_usage FROM public.session_seat_usage(p_session_id, p_exclude);

  IF p_signed_in OR v_mode IS DISTINCT FROM 'sfu' THEN
    IF v_usage.participants >= v_usage.participant_cap THEN
      RETURN 'participants';
    END IF;
  ELSIF v_usage.listeners >= v_usage.listener_cap THEN
    RETURN 'listeners';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.session_seat_refusal(UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_seat_refusal(UUID, BOOLEAN, UUID) TO service_role;

-- Keep the display copy of the caps (settings.maxParticipants/maxListeners) in
-- step with the owner's plan. Enforcement never reads them.
CREATE OR REPLACE FUNCTION public.sync_session_caps(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage RECORD;
BEGIN
  SELECT * INTO v_usage FROM public.session_seat_usage(p_session_id);
  IF v_usage.plan IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.sessions
  SET settings = COALESCE(settings, '{}'::jsonb)
    || jsonb_build_object(
      'maxParticipants', v_usage.participant_cap,
      'maxListeners', v_usage.listener_cap
    )
  WHERE id = p_session_id
    AND (
      (settings->>'maxParticipants')::INTEGER IS DISTINCT FROM v_usage.participant_cap
      OR (settings->>'maxListeners')::INTEGER IS DISTINCT FROM v_usage.listener_cap
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_session_caps(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_session_caps(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.join_session(p_join_code TEXT, p_display_name TEXT DEFAULT NULL::TEXT)
RETURNS public.session_participants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
  v_display_name TEXT;
  v_user_id UUID;
  v_is_owner BOOLEAN;
  v_refusal TEXT;
BEGIN
  v_user_id := auth.uid();

  -- The row lock serialises joins to one room, so two people cannot both see
  -- one free seat and both take it.
  SELECT * INTO v_session
  FROM public.sessions
  WHERE join_code = UPPER(p_join_code)
    AND status IN ('created', 'active', 'paused')
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found or has ended';
  END IF;

  v_is_owner := v_user_id IS NOT NULL AND v_user_id = v_session.host_user_id;

  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(p_display_name, p.display_name, 'User') INTO v_display_name
    FROM public.profiles p WHERE p.id = v_user_id;

    -- Already in the room: a reload or a second device.
    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id AND user_id = v_user_id AND left_at IS NULL;

    IF v_participant.id IS NOT NULL THEN
      -- Still in the call: never turned away. Gone quiet: a new join.
      IF NOT v_is_owner AND v_participant.last_seen_at <= NOW() - INTERVAL '3 minutes' THEN
        v_refusal := public.session_seat_refusal(v_session.id, TRUE, v_participant.id);
        IF v_refusal IS NOT NULL THEN
          RAISE EXCEPTION 'Session is full (%)', v_refusal;
        END IF;
      END IF;
      UPDATE public.session_participants
      SET last_seen_at = NOW(), connection_status = 'connected'
      WHERE id = v_participant.id
      RETURNING * INTO v_participant;
      PERFORM public.sync_session_caps(v_session.id);
      RETURN v_participant;
    END IF;

    IF NOT v_is_owner THEN
      v_refusal := public.session_seat_refusal(v_session.id, TRUE, NULL);
      IF v_refusal IS NOT NULL THEN
        RAISE EXCEPTION 'Session is full (%)', v_refusal;
      END IF;
    END IF;

    SELECT * INTO v_participant
    FROM public.session_participants
    WHERE session_id = v_session.id AND user_id = v_user_id AND left_at IS NOT NULL
    ORDER BY left_at DESC LIMIT 1;

    IF v_participant.id IS NOT NULL THEN
      UPDATE public.session_participants
      SET left_at = NULL,
          display_name = COALESCE(p_display_name, v_participant.display_name),
          connection_status = 'connected',
          last_seen_at = NOW()
      WHERE id = v_participant.id
      RETURNING * INTO v_participant;
    ELSE
      INSERT INTO public.session_participants
        (session_id, user_id, display_name, role, control_state, connection_status, last_seen_at)
      VALUES (v_session.id, v_user_id, v_display_name, 'viewer', 'view-only', 'connected', NOW())
      ON CONFLICT (session_id, user_id) WHERE left_at IS NULL AND user_id IS NOT NULL
      DO UPDATE SET display_name = EXCLUDED.display_name, last_seen_at = NOW()
      RETURNING * INTO v_participant;
    END IF;

  ELSE
    IF p_display_name IS NULL OR p_display_name = '' THEN
      RAISE EXCEPTION 'Display name required for guests';
    END IF;
    v_display_name := p_display_name;

    -- A guest is a participant in a P2P room and a listener in an SFU room.
    v_refusal := public.session_seat_refusal(v_session.id, FALSE, NULL);
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION 'Session is full (%)', v_refusal;
    END IF;

    INSERT INTO public.session_participants
      (session_id, user_id, display_name, role, control_state, connection_status, last_seen_at)
    VALUES (v_session.id, NULL, v_display_name, 'viewer', 'view-only', 'connected', NOW())
    RETURNING * INTO v_participant;
  END IF;

  PERFORM public.sync_session_caps(v_session.id);
  RETURN v_participant;
END;
$function$;

-- Keep a seat (every 30 s from the viewer pages, the desktop app and the
-- signaling stream), or take it back after going quiet. The row is found the
-- way mark_media_connected finds it: by participant row id (guests), or the
-- signed-in caller's active row. Returns:
--   'ok'            the caller holds a seat
--   'participants'  their row went quiet and the participant seats are taken
--   'listeners'     their row went quiet and the listener seats are taken
--   'gone'          no active row (left, removed, or the room ended)
-- A refusal never removes anyone; it only stops a quiet row from coming back
-- into a full room (the LiveKit token mint turns that into a 403).
CREATE OR REPLACE FUNCTION public.claim_session_seat(
  p_session_id UUID,
  p_participant_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
  v_refusal TEXT;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND status <> 'ended'
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN 'gone';
  END IF;

  SELECT sp.* INTO v_participant
  FROM public.session_participants sp
  WHERE sp.session_id = p_session_id
    AND sp.left_at IS NULL
    AND sp.kind = 'human'
    AND (
      sp.id = p_participant_id
      OR (auth.uid() IS NOT NULL AND sp.user_id = auth.uid())
    )
  ORDER BY (sp.id = p_participant_id) DESC NULLS LAST
  LIMIT 1;

  IF v_participant.id IS NULL THEN
    RETURN 'gone';
  END IF;

  IF v_participant.user_id IS DISTINCT FROM v_session.host_user_id
     AND v_participant.last_seen_at <= NOW() - INTERVAL '3 minutes' THEN
    v_refusal := public.session_seat_refusal(
      p_session_id, v_participant.user_id IS NOT NULL, v_participant.id
    );
    IF v_refusal IS NOT NULL THEN
      RETURN v_refusal;
    END IF;
  END IF;

  UPDATE public.session_participants
  SET last_seen_at = NOW(), connection_status = 'connected'
  WHERE id = v_participant.id;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_session_seat(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_session_seat(UUID, UUID) TO anon, authenticated, service_role;

-- Rooms already open carry the old baked caps (Free 20). Bring the display
-- copy in line with each owner's plan now; enforcement reads the plan anyway.
DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM public.sessions WHERE status <> 'ended' LOOP
    PERFORM public.sync_session_caps(v_id);
  END LOOP;
END $$;
