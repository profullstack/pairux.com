-- Organizations and teams.
--
-- An organization (e.g. "Profullstack") has members with a role:
--   owner  - one per org; pays, can delete the org
--   admin  - manages members, teams and every org resource
--   member - uses what the org and their teams share with them
-- Inside an org, teams (e.g. "Engineering") group members; a team lead can
-- manage the team's members and the team's channels.
--
-- Resources gain an optional owner org and team next to their personal owner:
--   channels.org_id/team_id       anyone in the team (or, with no team, the
--                                 org) can broadcast to the channel
--   sessions.org_id/team_id       the call belongs to that workspace
--   call_analyses.org_id/team_id  reports are readable by that team/org only
-- A resource with neither stays personal, exactly as before.
--
-- The org's plan covers its members: user_effective_plan() is the best of a
-- user's own plan and the plan of every org they belong to (the org owner's
-- plan while it is paid up).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (lower(slug));

CREATE TABLE IF NOT EXISTS public.org_members (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members (user_id);

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_org_name ON public.teams (org_id, lower(name));

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members (user_id);

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_open
  ON public.org_invitations (org_id, lower(email)) WHERE accepted_at IS NULL;

-- Service-role writes only (the API checks roles); members read their orgs.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so RLS policies can call them without
-- recursing through org_members' own policy)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.org_role(p_org UUID, p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.org_members WHERE org_id = p_org AND user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.org_role(p_org, p_user) IN ('owner', 'admin'), FALSE);
$$;

/** In the team, or an admin of its org. */
CREATE OR REPLACE FUNCTION public.can_access_team(p_team UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team AND user_id = p_user)
      OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team AND public.is_org_admin(t.org_id, p_user));
$$;

/** Team lead, or an admin of its org. */
CREATE OR REPLACE FUNCTION public.can_manage_team(p_team UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team AND user_id = p_user AND role = 'lead')
      OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team AND public.is_org_admin(t.org_id, p_user));
$$;

/**
 * Who may use a resource: its personal owner, or - when it belongs to a team -
 * that team (and the org's admins), or - when it belongs to an org without a
 * team - any member of that org.
 */
CREATE OR REPLACE FUNCTION public.can_use_resource(p_owner UUID, p_org UUID, p_team UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    p_owner = p_user
    OR (p_team IS NOT NULL AND public.can_access_team(p_team, p_user))
    OR (p_team IS NULL AND p_org IS NOT NULL AND public.org_role(p_org, p_user) IS NOT NULL)
  );
$$;

/** Who may change a resource's settings: its owner, org admins, team leads. */
CREATE OR REPLACE FUNCTION public.can_manage_resource(p_owner UUID, p_org UUID, p_team UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    p_owner = p_user
    OR (p_org IS NOT NULL AND public.is_org_admin(p_org, p_user))
    OR (p_team IS NOT NULL AND public.can_manage_team(p_team, p_user))
  );
$$;

/** Best plan in effect for a user: their own, or any org's they belong to. */
CREATE OR REPLACE FUNCTION public.user_effective_plan(p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH plans AS (
    SELECT p.plan, p.plan_expires_at FROM public.profiles p WHERE p.id = p_user
    UNION ALL
    SELECT op.plan, op.plan_expires_at
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.profiles op ON op.id = o.owner_id
    WHERE m.user_id = p_user
  )
  SELECT COALESCE((
    SELECT plan FROM plans
    WHERE plan <> 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at > NOW()
    ORDER BY CASE plan WHEN 'team' THEN 4 WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 ELSE 1 END DESC
    LIMIT 1
  ), 'free');
$$;

REVOKE ALL ON FUNCTION public.user_effective_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_effective_plan(UUID) TO authenticated, service_role;

-- Members read their own orgs, teams and co-members.
DROP POLICY IF EXISTS "Members read their orgs" ON public.organizations;
CREATE POLICY "Members read their orgs" ON public.organizations FOR SELECT TO authenticated
  USING (public.org_role(id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Members read org membership" ON public.org_members;
CREATE POLICY "Members read org membership" ON public.org_members FOR SELECT TO authenticated
  USING (public.org_role(org_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Members read org teams" ON public.teams;
CREATE POLICY "Members read org teams" ON public.teams FOR SELECT TO authenticated
  USING (public.org_role(org_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Members read team membership" ON public.team_members;
CREATE POLICY "Members read team membership" ON public.team_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.org_role(t.org_id, auth.uid()) IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Ownership columns on shared resources
-- ---------------------------------------------------------------------------

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_channels_org ON public.channels (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_analyses_org ON public.call_analyses (org_id) WHERE org_id IS NOT NULL;

-- Channel managers (owner, org admins, team leads) read the channel row.
DROP POLICY IF EXISTS "owners read own channels" ON public.channels;
DROP POLICY IF EXISTS "Managers read channels" ON public.channels;
CREATE POLICY "Managers read channels" ON public.channels FOR SELECT TO authenticated
  USING (public.can_manage_resource(owner_id, org_id, team_id, auth.uid()));

-- Team members read the team's call reports.
DROP POLICY IF EXISTS "Hosts read their own call analyses" ON public.call_analyses;
DROP POLICY IF EXISTS "Team members read call analyses" ON public.call_analyses;
CREATE POLICY "Team members read call analyses" ON public.call_analyses FOR SELECT TO authenticated
  USING (public.can_use_resource(host_user_id, org_id, team_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Channel RPCs: team members broadcast, managers configure
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_channel(text, text, text);
CREATE OR REPLACE FUNCTION public.create_channel(
  p_handle TEXT, p_name TEXT, p_description TEXT DEFAULT NULL,
  p_org_id UUID DEFAULT NULL, p_team_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_id uuid; v_handle text; v_name text; v_org uuid := p_org_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_handle := btrim(COALESCE(p_handle, ''));
  IF v_handle !~ '^[A-Za-z0-9_]{3,30}$' THEN RAISE EXCEPTION 'Handle must be 3-30 letters, numbers, or underscores'; END IF;
  IF EXISTS (SELECT 1 FROM public.channels WHERE lower(handle) = lower(v_handle)) THEN RAISE EXCEPTION 'That handle is taken'; END IF;
  IF p_team_id IS NOT NULL THEN
    SELECT org_id INTO v_org FROM public.teams WHERE id = p_team_id;
    IF v_org IS NULL OR (p_org_id IS NOT NULL AND p_org_id <> v_org) THEN RAISE EXCEPTION 'Team not found'; END IF;
    IF NOT public.can_manage_team(p_team_id, auth.uid()) THEN RAISE EXCEPTION 'Only team leads and org admins can create team channels'; END IF;
  ELSIF v_org IS NOT NULL AND NOT public.is_org_admin(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'Only org admins can create org channels';
  END IF;
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  INSERT INTO public.channels (owner_id, handle, name, description, org_id, team_id)
  VALUES (auth.uid(), v_handle, COALESCE(v_name, v_handle), NULLIF(btrim(COALESCE(p_description, '')), ''), v_org, p_team_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.update_channel(p_channel_id uuid, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text, p_banner_url text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.channels
  SET name = COALESCE(NULLIF(btrim(p_name), ''), name), description = COALESCE(p_description, description),
      avatar_url = COALESCE(p_avatar_url, avatar_url), banner_url = COALESCE(p_banner_url, banner_url),
      website_url = CASE WHEN p_website_url IS NULL THEN website_url ELSE NULLIF(btrim(p_website_url), '') END
  WHERE id = p_channel_id AND public.can_manage_resource(owner_id, org_id, team_id, auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel not found or not yours'; END IF;
END; $function$;

DROP FUNCTION IF EXISTS public.list_my_channels();
CREATE OR REPLACE FUNCTION public.list_my_channels()
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text, banner_url text, stream_key text, subscriber_count bigint, restream_enabled boolean, created_at timestamp with time zone, website_url text, org_id uuid, org_name text, team_id uuid, team_name text, can_manage boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url, c.stream_key,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    c.restream_enabled, c.created_at, c.website_url,
    c.org_id, o.name, c.team_id, t.name,
    public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())
  FROM public.channels c
  LEFT JOIN public.organizations o ON o.id = c.org_id
  LEFT JOIN public.teams t ON t.id = c.team_id
  WHERE public.can_use_resource(c.owner_id, c.org_id, c.team_id, auth.uid())
  ORDER BY (c.owner_id = auth.uid()) DESC, c.created_at ASC;
END; $function$;

CREATE OR REPLACE FUNCTION public.set_session_channel(p_session_id uuid, p_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = p_channel_id AND public.can_use_resource(c.owner_id, c.org_id, c.team_id, auth.uid())
  ) THEN RAISE EXCEPTION 'Channel not found or not yours'; END IF;
  UPDATE public.sessions SET channel_id = p_channel_id
  WHERE id = p_session_id AND (creator_id = auth.uid() OR host_user_id = auth.uid() OR current_host_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found or not yours'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.list_channel_restream_destinations(p_channel_id uuid)
RETURNS TABLE(id uuid, platform text, label text, rtmp_url text, enabled boolean, has_key boolean, created_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  RETURN QUERY
  SELECT d.id, d.platform, d.label, d.rtmp_url, d.enabled,
    (d.stream_key IS NOT NULL AND d.stream_key <> '') AS has_key, d.created_at
  FROM public.channel_restream_destinations d WHERE d.channel_id = p_channel_id ORDER BY d.created_at;
END; $function$;

CREATE OR REPLACE FUNCTION public.upsert_channel_restream_destination(p_channel_id uuid, p_id uuid, p_platform text, p_label text, p_rtmp_url text, p_stream_key text, p_enabled boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  IF p_rtmp_url IS NULL OR p_rtmp_url !~ '^rtmps?://.+' THEN
    RAISE EXCEPTION 'RTMP URL must start with rtmp:// or rtmps://';
  END IF;
  IF p_id IS NULL THEN
    IF p_stream_key IS NULL OR p_stream_key = '' THEN RAISE EXCEPTION 'Stream key required'; END IF;
    INSERT INTO public.channel_restream_destinations (channel_id, platform, label, rtmp_url, stream_key, enabled)
    VALUES (p_channel_id, COALESCE(p_platform, 'custom'), p_label, p_rtmp_url, p_stream_key, COALESCE(p_enabled, TRUE))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.channel_restream_destinations SET
      platform = COALESCE(p_platform, platform), label = p_label, rtmp_url = p_rtmp_url,
      enabled = COALESCE(p_enabled, enabled), stream_key = COALESCE(NULLIF(p_stream_key, ''), stream_key)
    WHERE id = p_id AND channel_id = p_channel_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Destination not found'; END IF;
  END IF;
  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_channel_restream_destination(p_channel_id uuid, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  DELETE FROM public.channel_restream_destinations WHERE id = p_id AND channel_id = p_channel_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.set_channel_restream_enabled(p_channel_id uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE public.channels SET restream_enabled = COALESCE(p_enabled, FALSE), updated_at = NOW()
  WHERE id = p_channel_id AND public.can_manage_resource(owner_id, org_id, team_id, auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Not your channel'; END IF;
END; $function$;

-- get_channel: is_owner now means "can manage this channel".
CREATE OR REPLACE FUNCTION public.get_channel(p_handle text)
RETURNS TABLE(id uuid, handle text, name text, description text, avatar_url text, banner_url text, subscriber_count bigint, is_subscribed boolean, is_owner boolean, is_live boolean, live_viewers bigint, owner_username text, owner_addr text, website_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id AND cs.subscriber_id = auth.uid())),
    (auth.uid() IS NOT NULL AND public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
       AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.session_participants sp
       JOIN public.sessions s2 ON s2.id = sp.session_id
       WHERE s2.channel_id = c.id AND s2.is_public
         AND s2.current_host_id IS NOT NULL AND s2.host_last_seen_at > NOW() - live_ttl
         AND sp.left_at IS NULL),
    (SELECT p.username FROM public.profiles p WHERE p.id = c.owner_id),
    (SELECT COALESCE(p.username, c.owner_id::text) FROM public.profiles p WHERE p.id = c.owner_id),
    c.website_url
  FROM public.channels c
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) LIMIT 1;
END; $function$;
