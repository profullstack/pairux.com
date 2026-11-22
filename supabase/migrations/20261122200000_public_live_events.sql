-- Public live events: a scheduled meeting the host chooses to list on its
-- broadcast channel, with a page (/e/<id>) and a subscribable calendar feed
-- (/c/<handle>/calendar.ics). Private stays the default: nothing that exists
-- today becomes visible.
--
-- A public event needs a channel. channel_id is ON DELETE SET NULL, so a CHECK
-- would make deleting the channel fail; the trigger instead turns an event
-- private the moment it loses its channel.

ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

DO $$ BEGIN
  ALTER TABLE public.scheduled_sessions
    ADD CONSTRAINT scheduled_sessions_visibility_check CHECK (visibility IN ('private', 'public'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.scheduled_sessions_public_needs_channel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel_id IS NULL THEN
    NEW.visibility := 'private';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_sessions_public_needs_channel ON public.scheduled_sessions;
CREATE TRIGGER trg_scheduled_sessions_public_needs_channel
  BEFORE INSERT OR UPDATE OF channel_id, visibility ON public.scheduled_sessions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_sessions_public_needs_channel();

CREATE INDEX IF NOT EXISTS scheduled_sessions_public_channel_idx
  ON public.scheduled_sessions (channel_id, scheduled_at)
  WHERE visibility = 'public' AND status = 'pending';

-- Anonymous readers never touch scheduled_sessions (its only policy is the
-- host's). These SECURITY DEFINER functions return public events only, and only
-- public fields: never join_code, invitees, host_user_id or booking data.
-- Rows whose series already ended are still returned when status is pending;
-- the app computes the current occurrence (scheduled_at is rolled forward lazily).

CREATE OR REPLACE FUNCTION public.list_channel_events(p_handle text, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, title text, description text, scheduled_at timestamptz, duration_minutes integer,
  recurrence_freq text, recurrence_interval integer, recurrence_count integer, occurrences_elapsed integer,
  recurrence_anchor_at timestamptz, updated_at timestamptz, channel_handle text, channel_name text,
  channel_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.description, s.scheduled_at, s.duration_minutes,
    s.recurrence_freq, s.recurrence_interval, s.recurrence_count, s.occurrences_elapsed,
    s.recurrence_anchor_at, s.updated_at, c.handle, c.name, c.avatar_url
  FROM public.scheduled_sessions s
  JOIN public.channels c ON c.id = s.channel_id
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, '')))
    AND s.visibility = 'public'
    AND s.status = 'pending'
    -- One-offs that ended over a day ago are history; series may still have occurrences ahead.
    AND (s.recurrence_freq IS NOT NULL OR s.scheduled_at > now() - interval '1 day')
  ORDER BY s.scheduled_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.get_public_event(p_id uuid)
RETURNS TABLE(id uuid, title text, description text, scheduled_at timestamptz, duration_minutes integer,
  recurrence_freq text, recurrence_interval integer, recurrence_count integer, occurrences_elapsed integer,
  recurrence_anchor_at timestamptz, updated_at timestamptz, channel_handle text, channel_name text,
  channel_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.description, s.scheduled_at, s.duration_minutes,
    s.recurrence_freq, s.recurrence_interval, s.recurrence_count, s.occurrences_elapsed,
    s.recurrence_anchor_at, s.updated_at, c.handle, c.name, c.avatar_url
  FROM public.scheduled_sessions s
  JOIN public.channels c ON c.id = s.channel_id
  WHERE s.id = p_id AND s.visibility = 'public' AND s.status = 'pending';
$$;

CREATE OR REPLACE FUNCTION public.list_upcoming_public_events(p_limit integer DEFAULT 24)
RETURNS TABLE(id uuid, title text, description text, scheduled_at timestamptz, duration_minutes integer,
  recurrence_freq text, recurrence_interval integer, recurrence_count integer, occurrences_elapsed integer,
  recurrence_anchor_at timestamptz, updated_at timestamptz, channel_handle text, channel_name text,
  channel_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.description, s.scheduled_at, s.duration_minutes,
    s.recurrence_freq, s.recurrence_interval, s.recurrence_count, s.occurrences_elapsed,
    s.recurrence_anchor_at, s.updated_at, c.handle, c.name, c.avatar_url
  FROM public.scheduled_sessions s
  JOIN public.channels c ON c.id = s.channel_id
  WHERE s.visibility = 'public'
    AND s.status = 'pending'
    AND (s.recurrence_freq IS NOT NULL OR s.scheduled_at > now() - interval '1 day')
  ORDER BY s.scheduled_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_channel_events(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_upcoming_public_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_channel_events(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_event(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_upcoming_public_events(integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
