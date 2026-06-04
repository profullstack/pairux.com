-- Scheduled Sessions Migration
-- Allows users to pre-schedule meetings and invite attendees via email

-- =============================================================================
-- STEP 1: Create scheduled_sessions table
-- =============================================================================

CREATE TABLE public.scheduled_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  join_code TEXT NOT NULL UNIQUE,
  session_id UUID REFERENCES public.sessions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_sessions_host ON public.scheduled_sessions (host_user_id);
CREATE INDEX idx_scheduled_sessions_scheduled_at ON public.scheduled_sessions (scheduled_at);
CREATE INDEX idx_scheduled_sessions_status ON public.scheduled_sessions (status);

-- =============================================================================
-- STEP 2: Create scheduled_session_invitees table
-- =============================================================================

CREATE TABLE public.scheduled_session_invitees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scheduled_session_id UUID NOT NULL REFERENCES public.scheduled_sessions(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  rsvp_status TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending', 'accepted', 'declined')),
  invite_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scheduled_session_id, email)
);

CREATE INDEX idx_invitees_scheduled_session ON public.scheduled_session_invitees (scheduled_session_id);
CREATE INDEX idx_invitees_token ON public.scheduled_session_invitees (invite_token);

-- =============================================================================
-- STEP 3: Enable RLS
-- =============================================================================

ALTER TABLE public.scheduled_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_session_invitees ENABLE ROW LEVEL SECURITY;

-- Hosts can fully manage their own scheduled sessions
CREATE POLICY "Users manage own scheduled sessions"
  ON public.scheduled_sessions FOR ALL
  TO authenticated
  USING (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

-- Hosts can manage invitees for their sessions
CREATE POLICY "Host manages invitees"
  ON public.scheduled_session_invitees FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.scheduled_sessions ss
      WHERE ss.id = scheduled_session_invitees.scheduled_session_id
        AND ss.host_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scheduled_sessions ss
      WHERE ss.id = scheduled_session_invitees.scheduled_session_id
        AND ss.host_user_id = auth.uid()
    )
  );

-- Anyone can look up an invitee by token (for public RSVP page)
CREATE POLICY "Public read invitee by token"
  ON public.scheduled_session_invitees FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anyone can update their own RSVP via token (UPDATE is restricted to rsvp_status only in app layer)
CREATE POLICY "Public update rsvp status"
  ON public.scheduled_session_invitees FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- STEP 4: Update create_session to accept an optional pre-assigned join code
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_session(JSONB, public.session_mode);

CREATE OR REPLACE FUNCTION public.create_session(
  p_settings JSONB DEFAULT NULL,
  p_mode public.session_mode DEFAULT 'p2p',
  p_join_code TEXT DEFAULT NULL
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_default_settings JSONB := '{"quality": "medium", "allowControl": true, "maxParticipants": 5}'::jsonb;
  v_join_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Use provided join code or generate a unique one
  IF p_join_code IS NOT NULL THEN
    v_join_code := UPPER(p_join_code);
    -- Validate it's not already taken
    IF EXISTS (SELECT 1 FROM public.sessions WHERE join_code = v_join_code) THEN
      RAISE EXCEPTION 'Join code already in use';
    END IF;
  ELSE
    v_join_code := public.generate_unique_join_code();
  END IF;

  INSERT INTO public.sessions (host_user_id, creator_id, current_host_id, settings, status, mode, join_code)
  VALUES (
    auth.uid(),
    auth.uid(),
    auth.uid(),
    COALESCE(p_settings, v_default_settings),
    'created',
    p_mode,
    v_join_code
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

GRANT EXECUTE ON FUNCTION public.create_session(JSONB, public.session_mode, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_session(JSONB, public.session_mode, TEXT) IS
  'Creates a new session. p_join_code: optionally pre-assign a join code (for scheduled sessions).';
