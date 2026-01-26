-- Fix remaining infinite recursion in RLS policies
-- The recursion happens when:
-- 1. Query sessions → "Participants can view their sessions" → EXISTS on session_participants
-- 2. session_participants RLS → "Host can view session participants" → EXISTS on sessions
-- This creates a circular dependency.

-- The is_session_participant and is_session_host functions already exist from
-- migration 20250123000002, but they haven't been applied to all problematic policies.

-- =============================================================================
-- STEP 1: Fix sessions table policies that query session_participants
-- =============================================================================

-- Drop the problematic policy on sessions table
DROP POLICY IF EXISTS "Participants can view their sessions" ON public.sessions;

-- Recreate using SECURITY DEFINER helper function
CREATE POLICY "Participants can view their sessions"
  ON public.sessions FOR SELECT
  USING (
    public.is_session_participant(id, auth.uid())
  );

-- =============================================================================
-- STEP 2: Fix session_participants policies that query sessions
-- =============================================================================

-- Drop and recreate "Host can view session participants"
DROP POLICY IF EXISTS "Host can view session participants" ON public.session_participants;

CREATE POLICY "Host can view session participants"
  ON public.session_participants FOR SELECT
  USING (
    public.is_session_host(session_id, auth.uid())
  );

-- Drop and recreate "Host can update participants"
DROP POLICY IF EXISTS "Host can update participants" ON public.session_participants;

CREATE POLICY "Host can update participants"
  ON public.session_participants FOR UPDATE
  USING (
    public.is_session_host(session_id, auth.uid())
  );

-- Drop and recreate "Host can delete participants"
DROP POLICY IF EXISTS "Host can delete participants" ON public.session_participants;

CREATE POLICY "Host can delete participants"
  ON public.session_participants FOR DELETE
  USING (
    public.is_session_host(session_id, auth.uid())
  );

-- =============================================================================
-- STEP 3: Fix media_sessions policies that query session_participants or sessions
-- =============================================================================

-- Drop and recreate "Room participants can view media sessions"
DROP POLICY IF EXISTS "Room participants can view media sessions" ON public.media_sessions;

CREATE POLICY "Room participants can view media sessions"
  ON public.media_sessions
  FOR SELECT
  TO authenticated
  USING (
    public.is_session_participant(room_id, auth.uid())
    OR public.is_session_host(room_id, auth.uid())
  );

-- =============================================================================
-- STEP 4: Add a helper function to check creator status
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_session_creator(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = p_session_id
      AND creator_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_session_creator TO anon, authenticated;

-- Update "Room creators can manage room media sessions" to use helper
DROP POLICY IF EXISTS "Room creators can manage room media sessions" ON public.media_sessions;

CREATE POLICY "Room creators can manage room media sessions"
  ON public.media_sessions
  FOR ALL
  TO authenticated
  USING (
    public.is_session_creator(room_id, auth.uid())
  )
  WITH CHECK (
    public.is_session_creator(room_id, auth.uid())
  );
