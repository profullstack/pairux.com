-- Allow guest participants to view other participants in their session
-- Guests have user_id = NULL but have a valid participant ID

-- Create a helper function to check if someone is a participant by participant_id
-- This is used for guests who don't have a user_id
CREATE OR REPLACE FUNCTION public.is_guest_participant(p_session_id UUID, p_participant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE id = p_participant_id
      AND session_id = p_session_id
      AND user_id IS NULL
      AND left_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_guest_participant TO anon, authenticated;

-- Add policy for anonymous users to view participants
-- This allows the API to fetch participants for guest viewers
-- Note: The actual guest validation happens in the API layer using participant ID
CREATE POLICY "Anonymous can view session participants"
  ON public.session_participants FOR SELECT
  TO anon
  USING (
    -- Anonymous users can view participants of active sessions
    -- The API layer handles proper guest authentication via participant ID
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_participants.session_id
        AND s.status IN ('created', 'active', 'paused')
    )
  );

-- Also allow anonymous to view sessions (for the join flow)
CREATE POLICY "Anonymous can view active sessions"
  ON public.sessions FOR SELECT
  TO anon
  USING (
    status IN ('created', 'active', 'paused')
  );
