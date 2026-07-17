-- Account-to-account direct messages (DMs).
--
-- Private 1:1 messages between two registered users, independent of live
-- sessions (the existing chat_messages DMs are scoped to a room). Same design
-- as follows/channels: RLS locks the table to the two participants, and all
-- public read/write goes through SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CONSTRAINT direct_messages_no_self CHECK (sender_id <> recipient_id),
  CONSTRAINT direct_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 4000)
);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Efficient thread + inbox queries.
CREATE INDEX IF NOT EXISTS direct_messages_recipient_idx
  ON public.direct_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx
  ON public.direct_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_unread_idx
  ON public.direct_messages (recipient_id) WHERE read_at IS NULL;

-- Participants may read their own DMs directly (RPCs use SECURITY DEFINER, but
-- this also makes Realtime subscriptions work if wired up later).
DROP POLICY IF EXISTS "Participants read their own DMs" ON public.direct_messages;
CREATE POLICY "Participants read their own DMs"
  ON public.direct_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- =============================================================================
-- send_direct_message — send a DM to a user by username.
-- Returns the new message id + recipient id so the caller can fire
-- push/email notifications. Rejects self-messages and empty/oversized bodies.
-- =============================================================================
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

  SELECT id INTO v_recipient FROM public.profiles
   WHERE username IS NOT NULL AND lower(username) = lower(btrim(COALESCE(p_username, '')));
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF v_recipient = auth.uid() THEN RAISE EXCEPTION 'You cannot message yourself'; END IF;

  INSERT INTO public.direct_messages (sender_id, recipient_id, body)
  VALUES (auth.uid(), v_recipient, v_body)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_recipient;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_direct_message(TEXT, TEXT) TO authenticated;

-- =============================================================================
-- get_dm_conversation — the full 1:1 thread between the caller and p_username,
-- oldest first. Side effect: marks the partner's messages to the caller read.
-- =============================================================================
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

  SELECT p.id INTO v_partner FROM public.profiles p
   WHERE p.username IS NOT NULL AND lower(p.username) = lower(btrim(COALESCE(p_username, '')));
  IF v_partner IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Mark their messages to me as read.
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

-- =============================================================================
-- list_dm_threads — inbox: one row per conversation partner with the last
-- message and the caller's unread count for that thread. Newest first.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_dm_threads()
RETURNS TABLE (
  partner_id UUID,
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

-- =============================================================================
-- get_dm_unread_count — total unread DMs for the caller (header badge).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dm_unread_count()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::bigint FROM public.direct_messages
   WHERE recipient_id = auth.uid() AND read_at IS NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_count() TO authenticated;
