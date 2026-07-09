-- Public Rooms Directory + Usernames
-- Lets a host publish a room to the public directory at /live with a subject +
-- description, and gives every user a public profile page at /u/<username>.
--
-- Public reads are exposed through SECURITY DEFINER RPCs so we can surface only
-- safe columns to anon without loosening row-level security on profiles/sessions.

-- =============================================================================
-- STEP 1: profiles — usernames + bio for the public profile page
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;

-- Case-insensitive uniqueness (usernames are stored as typed but compared lower)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Format: 3-30 chars, letters/numbers/underscore only
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,30}$');

COMMENT ON COLUMN public.profiles.username IS 'Unique public handle for /u/<username> (case-insensitive)';
COMMENT ON COLUMN public.profiles.bio IS 'Short public bio shown on the profile page';

-- =============================================================================
-- STEP 2: sessions — public directory fields
-- =============================================================================

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sessions.is_public IS 'Whether the room is listed in the public /live directory';
COMMENT ON COLUMN public.sessions.subject IS 'Public title shown in the /live directory';
COMMENT ON COLUMN public.sessions.description IS 'Public description shown in the /live directory';
COMMENT ON COLUMN public.sessions.published_at IS 'When the room was first made public (drives directory ordering)';

-- Directory listing/ordering index (partial: only public rooms)
CREATE INDEX IF NOT EXISTS sessions_public_published_idx
  ON public.sessions (published_at DESC)
  WHERE is_public = TRUE;

-- =============================================================================
-- STEP 3: set_username — claim/change/clear own public handle
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_username(p_username TEXT)
RETURNS public.profiles AS $$
DECLARE
  v_profile public.profiles;
  v_username TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Normalize: trim; empty string clears the username
  v_username := NULLIF(btrim(COALESCE(p_username, '')), '');

  IF v_username IS NOT NULL THEN
    IF v_username !~ '^[A-Za-z0-9_]{3,30}$' THEN
      RAISE EXCEPTION 'Username must be 3-30 characters: letters, numbers, or underscore';
    END IF;

    -- Uniqueness (case-insensitive), excluding the caller
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE lower(username) = lower(v_username)
        AND id <> auth.uid()
    ) THEN
      RAISE EXCEPTION 'Username is already taken';
    END IF;
  END IF;

  UPDATE public.profiles
  SET username = v_username
  WHERE id = auth.uid()
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.set_username(TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_username(TEXT) IS
  'Sets the authenticated user''s public username. Pass empty/null to clear.';

-- =============================================================================
-- STEP 4: set_room_visibility — publish/unpublish a room to /live
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_room_visibility(
  p_session_id UUID,
  p_is_public BOOLEAN,
  p_subject TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_subject TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Caller must own/host the room and it must not be ended
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (creator_id = auth.uid() OR host_user_id = auth.uid() OR current_host_id = auth.uid())
    AND status <> 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Room not found or you are not the host';
  END IF;

  IF p_is_public THEN
    v_subject := NULLIF(btrim(COALESCE(p_subject, '')), '');
    IF v_subject IS NULL THEN
      RAISE EXCEPTION 'A subject is required to publish a room publicly';
    END IF;
  END IF;

  UPDATE public.sessions
  SET
    is_public = p_is_public,
    -- Keep prior subject/description when unpublishing (nulls left as-is)
    subject = CASE WHEN p_is_public THEN NULLIF(btrim(COALESCE(p_subject, '')), '') ELSE subject END,
    description = CASE WHEN p_is_public THEN NULLIF(btrim(COALESCE(p_description, '')), '') ELSE description END,
    -- Stamp published_at the first time it goes public; keep thereafter
    published_at = CASE
      WHEN p_is_public AND published_at IS NULL THEN NOW()
      ELSE published_at
    END
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.set_room_visibility(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_room_visibility(UUID, BOOLEAN, TEXT, TEXT) IS
  'Publishes or unpublishes a room to the public /live directory (host only).';

-- =============================================================================
-- STEP 5: list_public_rooms — the /live directory (safe columns only)
--         Optional p_username filters to one host (used by /u/<username>).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_public_rooms(
  p_limit INT DEFAULT 50,
  p_username TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  join_code TEXT,
  subject TEXT,
  description TEXT,
  mode public.session_mode,
  status public.session_status,
  is_live BOOLEAN,
  viewer_count BIGINT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  host_username TEXT,
  host_display_name TEXT,
  host_avatar_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.join_code,
    s.subject,
    s.description,
    s.mode,
    s.status,
    (s.current_host_id IS NOT NULL) AS is_live,
    (
      SELECT COUNT(*) FROM public.session_participants sp
      WHERE sp.session_id = s.id AND sp.left_at IS NULL
    ) AS viewer_count,
    s.published_at,
    s.created_at,
    p.username AS host_username,
    p.display_name AS host_display_name,
    p.avatar_url AS host_avatar_url
  FROM public.sessions s
  JOIN public.profiles p ON p.id = s.creator_id
  WHERE s.is_public = TRUE
    AND s.status IN ('created', 'active', 'paused')
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    AND (p_username IS NULL OR lower(p.username) = lower(p_username))
  ORDER BY (s.current_host_id IS NOT NULL) DESC, s.published_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_rooms(INT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.list_public_rooms(INT, TEXT) IS
  'Public directory of rooms explicitly published to /live. Anon-readable, safe columns only.';

-- =============================================================================
-- STEP 6: get_public_profile — public profile card for /u/<username>
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_public_profile(p_username TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ,
  public_room_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.created_at,
    (
      SELECT COUNT(*) FROM public.sessions s
      WHERE s.creator_id = p.id
        AND s.is_public = TRUE
        AND s.status IN ('created', 'active', 'paused')
    ) AS public_room_count
  FROM public.profiles p
  WHERE p.username IS NOT NULL
    AND lower(p.username) = lower(btrim(COALESCE(p_username, '')))
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_public_profile(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_profile(TEXT) IS
  'Public profile card by username for /u/<username>. Anon-readable, safe columns only.';
