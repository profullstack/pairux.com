-- Fix infinite recursion in session_participants RLS policy
-- The policy "Session participants can view each other" references session_participants
-- in its own USING clause, causing infinite recursion.

-- Create a SECURITY DEFINER function to check participation without triggering RLS
CREATE OR REPLACE FUNCTION public.is_session_participant(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id
      AND user_id = p_user_id
      AND left_at IS NULL
  );
$$;

-- Create helper to check if user is session host
CREATE OR REPLACE FUNCTION public.is_session_host(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = p_session_id
      AND host_user_id = p_user_id
  );
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Session participants can view each other" ON public.session_participants;

-- Recreate using the helper function
CREATE POLICY "Session participants can view each other"
  ON public.session_participants FOR SELECT
  USING (
    public.is_session_participant(session_id, auth.uid())
    OR public.is_session_host(session_id, auth.uid())
  );

-- Also fix the chat_messages policies to use the helper functions
DROP POLICY IF EXISTS "Session participants can view messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Session participants can send messages" ON public.chat_messages;

-- Recreate chat_messages policies using helper functions
CREATE POLICY "Session participants can view messages"
  ON public.chat_messages
  FOR SELECT
  USING (
    public.is_session_participant(session_id, auth.uid())
    OR public.is_session_host(session_id, auth.uid())
  );

CREATE POLICY "Session participants can send messages"
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    public.is_session_participant(session_id, auth.uid())
    OR public.is_session_host(session_id, auth.uid())
  );

-- Grant execute on the helper functions
GRANT EXECUTE ON FUNCTION public.is_session_participant TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_session_host TO anon, authenticated;
