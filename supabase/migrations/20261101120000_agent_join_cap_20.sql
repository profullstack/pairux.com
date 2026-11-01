-- Agent CLI joins are authorized by the session's join code and the host's
-- allowAgents setting. Allow up to 20 agent rows alongside the session's
-- human participant allowance, so a 20-person room can reach 40 total.

CREATE OR REPLACE FUNCTION public.join_session_as_agent(
  p_join_code TEXT,
  p_display_name TEXT,
  p_agent_client TEXT DEFAULT NULL,
  p_owner_id UUID DEFAULT NULL
)
RETURNS public.session_participants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
  v_live_agents INTEGER;
BEGIN
  IF p_display_name IS NULL OR length(trim(p_display_name)) < 2 THEN
    RAISE EXCEPTION 'Display name required for agents';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE join_code = UPPER(p_join_code)
    AND status IN ('created', 'active', 'paused')
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or has ended';
  END IF;

  IF COALESCE((v_session.settings->>'allowAgents')::BOOLEAN, TRUE) = FALSE THEN
    RAISE EXCEPTION 'The host is not accepting agents in this session';
  END IF;

  -- Retire agent rows whose CLI stopped heartbeating so they do not linger in
  -- the participant list when an agent process crashes without calling leave.
  UPDATE public.session_participants
  SET left_at = NOW(), connection_status = 'disconnected'
  WHERE session_id = v_session.id AND kind = 'agent' AND left_at IS NULL
    AND last_seen_at < NOW() - INTERVAL '2 minutes';

  SELECT COUNT(*) INTO v_live_agents
  FROM public.session_participants
  WHERE session_id = v_session.id AND kind = 'agent' AND left_at IS NULL;

  IF v_live_agents >= 20 THEN
    RAISE EXCEPTION 'This session already has the maximum of 20 agents';
  END IF;

  INSERT INTO public.session_participants
    (session_id, user_id, display_name, role, control_state, kind, agent_owner_id, agent_client,
     connection_status, last_seen_at)
  VALUES
    (v_session.id, NULL, trim(p_display_name), 'viewer', 'view-only', 'agent', p_owner_id,
     p_agent_client, 'connected', NOW())
  RETURNING * INTO v_participant;

  RETURN v_participant;
END;
$function$;

REVOKE ALL ON FUNCTION public.join_session_as_agent(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_session_as_agent(TEXT, TEXT, TEXT, UUID) TO service_role;
