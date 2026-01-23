-- Add recipient_id column for direct messages
ALTER TABLE public.chat_messages
ADD COLUMN recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for efficient DM queries
CREATE INDEX IF NOT EXISTS chat_messages_recipient_idx
ON public.chat_messages(recipient_id)
WHERE recipient_id IS NOT NULL;

-- Drop existing view policies
DROP POLICY IF EXISTS "Session participants can view messages" ON public.chat_messages;

-- Create new policy that handles both public and private messages
CREATE POLICY "Session participants can view messages"
ON public.chat_messages
FOR SELECT
USING (
  -- Public messages (no recipient)
  (recipient_id IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = chat_messages.session_id
      AND (sp.user_id = auth.uid() OR sp.user_id IS NULL)
      AND sp.left_at IS NULL
    )
    OR
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = chat_messages.session_id
      AND s.host_user_id = auth.uid()
    )
  ))
  OR
  -- Private messages: user is sender or recipient
  (recipient_id IS NOT NULL AND (
    user_id = auth.uid() OR recipient_id = auth.uid()
  ))
);

-- Update send_chat_message function to support DMs
CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_session_id UUID,
  p_content TEXT,
  p_participant_id UUID DEFAULT NULL,
  p_recipient_id UUID DEFAULT NULL
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_display_name TEXT;
  v_message public.chat_messages;
BEGIN
  -- Get current user (may be NULL for service role calls)
  v_user_id := auth.uid();

  -- Validate content
  IF length(p_content) = 0 THEN
    RAISE EXCEPTION 'Message content cannot be empty';
  END IF;

  IF length(p_content) > 500 THEN
    RAISE EXCEPTION 'Message content exceeds maximum length of 500 characters';
  END IF;

  -- Check if user is authenticated participant
  IF v_user_id IS NOT NULL THEN
    -- Authenticated user - check participation
    SELECT sp.display_name INTO v_display_name
    FROM public.session_participants sp
    WHERE sp.session_id = p_session_id
    AND sp.user_id = v_user_id
    AND sp.left_at IS NULL;

    -- Also check if user is the host
    IF v_display_name IS NULL THEN
      SELECT p.display_name INTO v_display_name
      FROM public.profiles p
      JOIN public.sessions s ON s.host_user_id = p.id
      WHERE s.id = p_session_id AND s.host_user_id = v_user_id;
    END IF;

    IF v_display_name IS NULL THEN
      RAISE EXCEPTION 'User is not a participant in this session';
    END IF;

    -- If DM, verify recipient is also in the session
    IF p_recipient_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.session_participants sp
        WHERE sp.session_id = p_session_id
        AND sp.user_id = p_recipient_id
        AND sp.left_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = p_session_id
        AND s.host_user_id = p_recipient_id
      ) THEN
        RAISE EXCEPTION 'Recipient is not a participant in this session';
      END IF;
    END IF;
  ELSE
    -- Guest/anonymous - must provide participant_id
    IF p_participant_id IS NULL THEN
      RAISE EXCEPTION 'Participant ID required for guest users';
    END IF;

    SELECT sp.display_name INTO v_display_name
    FROM public.session_participants sp
    WHERE sp.id = p_participant_id
    AND sp.session_id = p_session_id
    AND sp.user_id IS NULL
    AND sp.left_at IS NULL;

    IF v_display_name IS NULL THEN
      RAISE EXCEPTION 'Invalid participant ID or not a guest participant';
    END IF;
  END IF;

  -- Insert the message
  INSERT INTO public.chat_messages (session_id, user_id, display_name, content, message_type, recipient_id)
  VALUES (p_session_id, v_user_id, v_display_name, p_content, 'text', p_recipient_id)
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;

-- Add comment explaining DM support
COMMENT ON COLUMN public.chat_messages.recipient_id IS 'When set, indicates this is a direct message visible only to sender and recipient';
