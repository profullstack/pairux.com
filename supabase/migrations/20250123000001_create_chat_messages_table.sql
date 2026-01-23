-- Create message type enum
CREATE TYPE public.message_type AS ENUM ('text', 'system');

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL for guests
  display_name TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type public.message_type NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON public.chat_messages(session_id, created_at);

-- RLS Policies

-- Anyone in the session can view messages
CREATE POLICY "Session participants can view messages"
  ON public.chat_messages
  FOR SELECT
  USING (
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
  );

-- Authenticated users can send messages to sessions they're in
CREATE POLICY "Session participants can send messages"
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = chat_messages.session_id
      AND sp.user_id = auth.uid()
      AND sp.left_at IS NULL
    )
    OR
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = chat_messages.session_id
      AND s.host_user_id = auth.uid()
    )
  );

-- RPC function to send a chat message (handles guest participants)
CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_session_id UUID,
  p_content TEXT,
  p_participant_id UUID DEFAULT NULL
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
  INSERT INTO public.chat_messages (session_id, user_id, display_name, content, message_type)
  VALUES (p_session_id, v_user_id, v_display_name, p_content, 'text')
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;

-- RPC function to send a system message (join/leave/control)
CREATE OR REPLACE FUNCTION public.send_system_message(
  p_session_id UUID,
  p_content TEXT,
  p_display_name TEXT DEFAULT 'System'
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message public.chat_messages;
BEGIN
  -- Insert the system message
  INSERT INTO public.chat_messages (session_id, user_id, display_name, content, message_type)
  VALUES (p_session_id, NULL, p_display_name, p_content, 'system')
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;

-- Enable realtime for chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
