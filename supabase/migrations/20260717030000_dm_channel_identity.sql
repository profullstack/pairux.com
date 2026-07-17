-- YouTube-style DM identity: a creator's public identity is their @handle
-- (channel) — there is no separate "username" surfaced. DM addresses resolve by
-- profile username OR channel handle OR user id, and the identity shown in the
-- inbox/thread is the profile if set, else the owner's channel (name + @handle).

-- Resolve a DM address to a user id: username, then channel handle, then uuid.
CREATE OR REPLACE FUNCTION public.resolve_dm_target(p_addr text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_norm text;
BEGIN
  v_norm := btrim(COALESCE(p_addr, ''));
  IF v_norm = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.profiles
   WHERE username IS NOT NULL AND lower(username) = lower(v_norm);
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT owner_id INTO v_id FROM public.channels
   WHERE lower(handle) = lower(v_norm) LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  BEGIN
    SELECT id INTO v_id FROM public.profiles WHERE id = v_norm::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_dm_target(text) TO authenticated;

-- The public identity for a user: if they own a channel, that channel IS their
-- identity (name + @handle + avatar), YouTube-style; otherwise their profile.
-- addr is always routable; channel_handle links to /@handle.
CREATE OR REPLACE FUNCTION public.dm_identity(p_user_id uuid)
RETURNS TABLE (
  addr text,
  display_name text,
  avatar_url text,
  username text,
  channel_handle text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(ch.handle, pr.username, p_user_id::text),
    COALESCE(ch.name, pr.display_name, '@' || pr.username, 'User'),
    COALESCE(ch.avatar_url, pr.avatar_url),
    pr.username,
    ch.handle
  FROM (
    SELECT username, display_name, avatar_url FROM public.profiles WHERE id = p_user_id
  ) pr
  LEFT JOIN LATERAL (
    SELECT handle, name, avatar_url FROM public.channels
     WHERE owner_id = p_user_id ORDER BY created_at ASC LIMIT 1
  ) ch ON true;
$$;
GRANT EXECUTE ON FUNCTION public.dm_identity(uuid) TO authenticated;

-- get_dm_partner — identity card for the person at a DM address.
DROP FUNCTION IF EXISTS public.get_dm_partner(text);
CREATE FUNCTION public.get_dm_partner(p_addr TEXT)
RETURNS TABLE (
  id uuid,
  addr text,
  display_name text,
  avatar_url text,
  username text,
  channel_handle text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.resolve_dm_target(p_addr);
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT v_id, di.addr, di.display_name, di.avatar_url, di.username, di.channel_handle
    FROM public.dm_identity(v_id) di;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dm_partner(TEXT) TO authenticated;

-- list_dm_threads — inbox, each partner shown via their public identity.
DROP FUNCTION IF EXISTS public.list_dm_threads();
CREATE FUNCTION public.list_dm_threads()
RETURNS TABLE (
  partner_id UUID,
  addr TEXT,
  display_name TEXT,
  avatar_url TEXT,
  username TEXT,
  channel_handle TEXT,
  last_body TEXT,
  last_created_at TIMESTAMPTZ,
  last_from_me BOOLEAN,
  unread_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT dm.*,
           CASE WHEN dm.sender_id = auth.uid() THEN dm.recipient_id ELSE dm.sender_id END AS pid
      FROM public.direct_messages dm
     WHERE dm.sender_id = auth.uid() OR dm.recipient_id = auth.uid()
  ),
  latest AS (
    SELECT DISTINCT ON (m.pid) m.pid, m.body, m.created_at, m.sender_id
      FROM mine m
     ORDER BY m.pid, m.created_at DESC
  )
  SELECT
    l.pid,
    di.addr,
    di.display_name,
    di.avatar_url,
    di.username,
    di.channel_handle,
    l.body,
    l.created_at,
    (l.sender_id = auth.uid()),
    (SELECT COUNT(*) FROM mine m2
      WHERE m2.pid = l.pid AND m2.recipient_id = auth.uid() AND m2.read_at IS NULL)
  FROM latest l
  CROSS JOIN LATERAL public.dm_identity(l.pid) di
  ORDER BY l.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_threads() TO authenticated;
