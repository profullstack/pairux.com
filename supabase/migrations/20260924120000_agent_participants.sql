-- Agent participants + CLI OAuth 2.1.
--
-- An agent (Claude Code, moshcode, a script) joins a session the way a guest
-- does: with the join code and a display name. It is a watch-only viewer with
-- user_id NULL, so it never counts toward the plan cap and never publishes
-- media. What makes it an agent is `kind`, which every roster (web, PWA,
-- desktop, mobile) reads to badge it, plus who ran it (`agent_owner_id`, set
-- when the CLI is signed in) and what it is (`agent_client`, e.g.
-- "claude-code").
--
-- Agents join only through join_session_as_agent, which only the service role
-- may call (the /api/v1/agents/join route). Hosts can turn agents away for a
-- room with settings.allowAgents = false, and a room holds at most 5 live
-- agents so a leaked join code cannot fill a roster with bots.

DO $$ BEGIN
  CREATE TYPE public.participant_kind AS ENUM ('human', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS kind public.participant_kind NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS agent_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_client TEXT
    CHECK (agent_client IS NULL OR agent_client ~ '^[a-z0-9][a-z0-9._-]{0,39}$');

CREATE INDEX IF NOT EXISTS idx_session_participants_live_agents
  ON public.session_participants (session_id)
  WHERE kind = 'agent' AND left_at IS NULL;

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

  -- An agent whose CLI died never calls leave. Retire any that have not polled
  -- for two minutes, so stale rows neither hold a slot nor linger in rosters.
  UPDATE public.session_participants
  SET left_at = NOW(), connection_status = 'disconnected'
  WHERE session_id = v_session.id AND kind = 'agent' AND left_at IS NULL
    AND last_seen_at < NOW() - INTERVAL '2 minutes';

  -- The row lock on the session serialises concurrent agent joins, so two
  -- agents cannot both see 4 and become the 5th and 6th.
  SELECT COUNT(*) INTO v_live_agents
  FROM public.session_participants
  WHERE session_id = v_session.id AND kind = 'agent' AND left_at IS NULL;

  IF v_live_agents >= 5 THEN
    RAISE EXCEPTION 'This session already has the maximum number of agents';
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

-- ---------------------------------------------------------------------------
-- CLI sign-in: OAuth 2.1 authorization code + PKCE (S256) over a loopback
-- redirect (RFC 8252), with rotating refresh tokens. Only hashes are stored.
-- Both tables are service-role only: RLS on, no policies.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cli_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per issued access/refresh pair. Refreshing rotates: the old row is
-- stamped rotated_at and a new row joins the same family. Presenting a refresh
-- token whose row was already rotated means it leaked, so the whole family is
-- revoked (OAuth 2.1 §4.3.1 refresh token reuse detection).
CREATE TABLE IF NOT EXISTS public.cli_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name TEXT,
  access_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cli_tokens_family ON public.cli_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_cli_tokens_user ON public.cli_tokens (user_id);

ALTER TABLE public.cli_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cli_tokens ENABLE ROW LEVEL SECURITY;
