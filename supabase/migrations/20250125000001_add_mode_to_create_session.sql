-- Add mode parameter to create_session RPC
-- This allows setting P2P vs SFU mode at session creation time

-- Drop the old function with single parameter signature
DROP FUNCTION IF EXISTS public.create_session(JSONB);

CREATE OR REPLACE FUNCTION public.create_session(
  p_settings JSONB DEFAULT NULL,
  p_mode public.session_mode DEFAULT 'p2p'
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

  -- Create the session with mode
  INSERT INTO public.sessions (host_user_id, creator_id, current_host_id, settings, status, mode)
  VALUES (
    auth.uid(),
    auth.uid(),
    auth.uid(),
    COALESCE(p_settings, v_default_settings),
    'created',
    p_mode
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

COMMENT ON FUNCTION public.create_session(JSONB, public.session_mode) IS 'Creates a new session/room with the authenticated user as host. Supports P2P or SFU mode.';
