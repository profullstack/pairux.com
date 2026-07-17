-- Generalize DM addressing so users without a username are still messageable
-- (channel owners commonly have no username). A DM "address" is either a
-- username or, as a fallback, the recipient's profile id (uuid) as text. All
-- DM RPCs resolve an address the same way, and threads/inbox carry an `addr`
-- that always routes (COALESCE(username, id)).

-- Resolve a DM address (username or uuid) to a profile id, or NULL.
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

  BEGIN
    SELECT id INTO v_id FROM public.profiles WHERE id = v_norm::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_dm_target(text) TO authenticated;

-- send_direct_message now accepts a username OR uuid address.
CREATE OR REPLACE FUNCTION public.send_direct_message(p_username TEXT, p_body TEXT)
RETURNS TABLE (message_id UUID, recipient_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_recipient UUID;
  v_body TEXT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_body := btrim(COALESCE(p_body, ''));
  IF v_body = '' THEN RAISE EXCEPTION 'Message cannot be empty'; END IF;
  IF char_length(v_body) > 4000 THEN RAISE EXCEPTION 'Message is too long'; END IF;

  v_recipient := public.resolve_dm_target(p_username);
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF v_recipient = auth.uid() THEN RAISE EXCEPTION 'You cannot message yourself'; END IF;

  INSERT INTO public.direct_messages (sender_id, recipient_id, body)
  VALUES (auth.uid(), v_recipient, v_body)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_recipient;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_direct_message(TEXT, TEXT) TO authenticated;

-- get_dm_conversation now accepts a username OR uuid address.
CREATE OR REPLACE FUNCTION public.get_dm_conversation(p_username TEXT, p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID,
  sender_id UUID,
  body TEXT,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  is_mine BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_partner UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_partner := public.resolve_dm_target(p_username);
  IF v_partner IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  UPDATE public.direct_messages dm
     SET read_at = NOW()
   WHERE dm.recipient_id = auth.uid()
     AND dm.sender_id = v_partner
     AND dm.read_at IS NULL;

  RETURN QUERY
  SELECT dm.id, dm.sender_id, dm.body, dm.created_at, dm.read_at,
         (dm.sender_id = auth.uid()) AS is_mine
    FROM public.direct_messages dm
   WHERE (dm.sender_id = auth.uid() AND dm.recipient_id = v_partner)
      OR (dm.sender_id = v_partner AND dm.recipient_id = auth.uid())
   ORDER BY dm.created_at ASC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dm_conversation(TEXT, INTEGER) TO authenticated;

-- get_dm_partner — public card for the person at a DM address (username or
-- uuid), so the thread header renders even when they have no username.
CREATE OR REPLACE FUNCTION public.get_dm_partner(p_addr TEXT)
RETURNS TABLE (id UUID, username TEXT, display_name TEXT, avatar_url TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.resolve_dm_target(p_addr);
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url
    FROM public.profiles p WHERE p.id = v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dm_partner(TEXT) TO authenticated;

-- list_dm_threads: add an `addr` that always routes (username, else uuid).
DROP FUNCTION IF EXISTS public.list_dm_threads();
CREATE OR REPLACE FUNCTION public.list_dm_threads()
RETURNS TABLE (
  partner_id UUID,
  addr TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
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
    COALESCE(p.username, l.pid::text) AS addr,
    p.username,
    p.display_name,
    p.avatar_url,
    l.body,
    l.created_at,
    (l.sender_id = auth.uid()) AS last_from_me,
    (SELECT COUNT(*) FROM mine m2
      WHERE m2.pid = l.pid AND m2.recipient_id = auth.uid() AND m2.read_at IS NULL) AS unread_count
  FROM latest l
  JOIN public.profiles p ON p.id = l.pid
  ORDER BY l.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_threads() TO authenticated;

-- get_channel: add owner_addr (username, else owner uuid) for the "Message"
-- button on /@handle. owner_username is kept for display.
DROP FUNCTION IF EXISTS public.get_channel(text);
CREATE OR REPLACE FUNCTION public.get_channel(p_handle text)
RETURNS TABLE(
  id uuid, handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_subscribed boolean, is_owner boolean, is_live boolean,
  live_viewers bigint, owner_username text, owner_addr text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id AND cs.subscriber_id = auth.uid())),
    (auth.uid() IS NOT NULL AND c.owner_id = auth.uid()),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
       AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.session_participants sp
       JOIN public.sessions s2 ON s2.id = sp.session_id
       WHERE s2.channel_id = c.id AND s2.is_public
         AND s2.current_host_id IS NOT NULL AND s2.host_last_seen_at > NOW() - live_ttl
         AND sp.left_at IS NULL),
    (SELECT p.username FROM public.profiles p WHERE p.id = c.owner_id),
    (SELECT COALESCE(p.username, c.owner_id::text) FROM public.profiles p WHERE p.id = c.owner_id)
  FROM public.channels c
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_channel(text) TO anon, authenticated;
