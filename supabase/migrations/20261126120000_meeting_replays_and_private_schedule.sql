-- Meeting replays on the channel page, and the owner's private schedule there.
--
-- 1. scheduled_sessions.replay_visibility: what happens to the recording of each
--    occurrence. 'off' (default: nothing that exists today changes), 'private'
--    (recorded, the replay is shown to the channel's managers only) or 'public'
--    (recorded, the replay is published on the channel page and its RSS feed
--    once the occurrence ends). A public replay needs a channel; the existing
--    trigger demotes it to private when the channel goes away.
--
-- 2. sessions.scheduled_session_id: the meeting a room was opened for. The
--    meeting row's own session_id is cleared on every roll-forward, so this is
--    the only link that survives to tell a finished recording which meeting it
--    belongs to (and so which replay setting applies).
--
-- 3. A meeting room's join code is the meeting's code until the next occurrence
--    takes it back, so a replay of a meeting never exposes it: replay listings
--    return join_code NULL for those rows and link to /c/<handle>/replay/<id>.

ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS replay_visibility text NOT NULL DEFAULT 'off';

DO $$ BEGIN
  ALTER TABLE public.scheduled_sessions
    ADD CONSTRAINT scheduled_sessions_replay_visibility_check
    CHECK (replay_visibility IN ('off', 'private', 'public'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.scheduled_sessions_public_needs_channel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel_id IS NULL THEN
    NEW.visibility := 'private';
    IF NEW.replay_visibility = 'public' THEN
      NEW.replay_visibility := 'private';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_sessions_public_needs_channel ON public.scheduled_sessions;
CREATE TRIGGER trg_scheduled_sessions_public_needs_channel
  BEFORE INSERT OR UPDATE OF channel_id, visibility, replay_visibility ON public.scheduled_sessions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_sessions_public_needs_channel();

CREATE INDEX IF NOT EXISTS scheduled_sessions_private_channel_idx
  ON public.scheduled_sessions (channel_id, scheduled_at)
  WHERE visibility = 'private' AND status = 'pending' AND channel_id IS NOT NULL;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS scheduled_session_id uuid
  REFERENCES public.scheduled_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_scheduled_session_idx
  ON public.sessions (scheduled_session_id) WHERE scheduled_session_id IS NOT NULL;

-- The one rule for "anyone may watch this recording". A room opened for a
-- meeting follows the meeting's replay setting ('off' keeps the old rule: the
-- room itself was public); any other room is public when the room was.
CREATE OR REPLACE FUNCTION public.recording_is_public(p_session_public boolean, p_replay text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_replay, 'off')
    WHEN 'public' THEN TRUE
    WHEN 'private' THEN FALSE
    ELSE COALESCE(p_session_public, FALSE)
  END;
$$;

-- Server-side recording starts on the first heartbeat of a public SFU room, and
-- now also of an SFU room opened for a meeting that keeps replays.
CREATE OR REPLACE FUNCTION public.mark_recording_started(p_session_id uuid)
RETURNS TABLE(session_id uuid, channel_id uuid, creator_id uuid, subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  UPDATE public.sessions s SET recording_started_at = NOW()
  WHERE s.id = p_session_id
    AND s.mode = 'sfu'
    AND (
      s.is_public = TRUE
      OR EXISTS (
        SELECT 1 FROM public.scheduled_sessions ss
        WHERE ss.id = s.scheduled_session_id AND ss.replay_visibility <> 'off'
      )
    )
    AND s.current_host_id IS NOT NULL
    AND s.recording_started_at IS NULL
    AND (s.current_host_id = auth.uid() OR s.creator_id = auth.uid() OR s.host_user_id = auth.uid())
  RETURNING s.id, s.channel_id, s.creator_id,
    COALESCE(s.subject, (SELECT ss.title FROM public.scheduled_sessions ss WHERE ss.id = s.scheduled_session_id));
END; $$;

CREATE OR REPLACE FUNCTION public.list_channel_recordings(p_handle text, p_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, join_code text, subject text, banner_url text, playback_url text,
  duration_seconds integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT r.id,
    CASE WHEN s.scheduled_session_id IS NULL THEN s.join_code END,
    COALESCE(r.subject, s.subject, ss.title), s.banner_url, r.playback_url,
    r.duration_seconds, r.created_at
  FROM public.recordings r
  JOIN public.channels ch ON ch.id = r.channel_id
  JOIN public.sessions s ON s.id = r.session_id
  LEFT JOIN public.scheduled_sessions ss ON ss.id = s.scheduled_session_id
  WHERE lower(ch.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND r.status = 'ready' AND r.playback_url IS NOT NULL
    AND public.recording_is_public(s.is_public, ss.replay_visibility)
  ORDER BY r.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
END; $$;

-- One replay for /c/<handle>/replay/<id>: public ones for anybody, private ones
-- for whoever manages the channel.
CREATE OR REPLACE FUNCTION public.get_channel_replay(p_handle text, p_id uuid)
RETURNS TABLE(id uuid, subject text, description text, banner_url text, playback_url text,
  duration_seconds integer, created_at timestamptz, is_public boolean,
  channel_handle text, channel_name text, channel_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, COALESCE(r.subject, s.subject, ss.title), COALESCE(s.description, ss.description),
    s.banner_url, r.playback_url, r.duration_seconds, r.created_at,
    public.recording_is_public(s.is_public, ss.replay_visibility),
    ch.handle, ch.name, ch.avatar_url
  FROM public.recordings r
  JOIN public.channels ch ON ch.id = r.channel_id
  JOIN public.sessions s ON s.id = r.session_id
  LEFT JOIN public.scheduled_sessions ss ON ss.id = s.scheduled_session_id
  WHERE r.id = p_id
    AND lower(ch.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND r.status = 'ready' AND r.playback_url IS NOT NULL
    AND (
      public.recording_is_public(s.is_public, ss.replay_visibility)
      OR (auth.uid() IS NOT NULL
          AND public.can_manage_resource(ch.owner_id, ch.org_id, ch.team_id, auth.uid()))
    );
$$;

-- The channel's private schedule and private replays, for its managers only.
-- Anyone else (and anon) gets no rows, never an error, so the page can always ask.
CREATE OR REPLACE FUNCTION public.list_channel_private_events(p_handle text, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, title text, description text, scheduled_at timestamptz, duration_minutes integer,
  recurrence_freq text, recurrence_interval integer, recurrence_count integer, occurrences_elapsed integer,
  recurrence_anchor_at timestamptz, updated_at timestamptz, channel_handle text, channel_name text,
  channel_avatar_url text, join_code text, replay_visibility text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.description, s.scheduled_at, s.duration_minutes,
    s.recurrence_freq, s.recurrence_interval, s.recurrence_count, s.occurrences_elapsed,
    s.recurrence_anchor_at, s.updated_at, c.handle, c.name, c.avatar_url,
    s.join_code, s.replay_visibility
  FROM public.scheduled_sessions s
  JOIN public.channels c ON c.id = s.channel_id
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND auth.uid() IS NOT NULL
    AND public.can_manage_resource(c.owner_id, c.org_id, c.team_id, auth.uid())
    AND s.visibility = 'private'
    AND s.status = 'pending'
    AND (s.recurrence_freq IS NOT NULL OR s.scheduled_at > now() - interval '1 day')
  ORDER BY s.scheduled_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.list_channel_private_recordings(p_handle text, p_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, join_code text, subject text, banner_url text, playback_url text,
  duration_seconds integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, NULL::text, COALESCE(r.subject, s.subject, ss.title), s.banner_url, r.playback_url,
    r.duration_seconds, r.created_at
  FROM public.recordings r
  JOIN public.channels ch ON ch.id = r.channel_id
  JOIN public.sessions s ON s.id = r.session_id
  JOIN public.scheduled_sessions ss ON ss.id = s.scheduled_session_id
  WHERE lower(ch.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND auth.uid() IS NOT NULL
    AND public.can_manage_resource(ch.owner_id, ch.org_id, ch.team_id, auth.uid())
    AND r.status = 'ready' AND r.playback_url IS NOT NULL
    AND NOT public.recording_is_public(s.is_public, ss.replay_visibility)
  ORDER BY r.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
$$;

-- The directory's recording count must match what the channel page lists.
CREATE OR REPLACE FUNCTION public.list_all_channels(p_limit integer DEFAULT 48)
RETURNS TABLE(handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_live boolean, live_count bigint, recording_count bigint, website_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.recordings r
      JOIN public.sessions s ON s.id = r.session_id
      LEFT JOIN public.scheduled_sessions ss ON ss.id = s.scheduled_session_id
      WHERE r.channel_id = c.id AND r.status = 'ready' AND r.playback_url IS NOT NULL
        AND public.recording_is_public(s.is_public, ss.replay_visibility)),
    c.website_url
  FROM public.channels c
  ORDER BY EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id) DESC, c.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 48), 100));
END; $$;

REVOKE ALL ON FUNCTION public.recording_is_public(boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_channel_replay(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_channel_private_events(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_channel_private_recordings(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recording_is_public(boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_channel_replay(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_channel_private_events(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_channel_private_recordings(text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
