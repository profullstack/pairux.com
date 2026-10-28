-- Your own agents: AI agents registered on an account (optionally shared with
-- an org) that can be invited into a meeting, alongside PairUX's own copilot.
-- An agent authenticates with its key (Bearer pux_ag_<id>_<secret>; only a
-- SHA-256 hash is stored), picks up invites, and joins as an agent participant
-- owned by the account. An invite from an eligible (Pro/Team) inviter also
-- grants the live transcript.
--
-- Service role only: the API routes decide who may register, invite and join.

CREATE TABLE IF NOT EXISTS public.account_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 50),
  handle TEXT NOT NULL CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, handle)
);
CREATE INDEX IF NOT EXISTS account_agents_org_idx ON public.account_agents (org_id) WHERE org_id IS NOT NULL;
ALTER TABLE public.account_agents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.agent_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.account_agents(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The inviter's plan covers the transcript (free self-hosted speech-to-text).
  transcript BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'left')),
  participant_id UUID REFERENCES public.session_participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_invites_agent_idx ON public.agent_invites (agent_id, status);
CREATE INDEX IF NOT EXISTS agent_invites_session_idx ON public.agent_invites (session_id);
CREATE INDEX IF NOT EXISTS agent_invites_participant_idx ON public.agent_invites (participant_id);
-- One open invite per agent per meeting.
CREATE UNIQUE INDEX IF NOT EXISTS agent_invites_open_idx
  ON public.agent_invites (agent_id, session_id) WHERE status IN ('pending', 'accepted');
ALTER TABLE public.agent_invites ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.account_agents, public.agent_invites TO service_role;
