-- RLS Policies for profiles table

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Profiles are created via trigger, no direct insert needed
-- But allow authenticated users to insert their own profile as fallback
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for sessions table

-- Host can view their own sessions
CREATE POLICY "Host can view own sessions"
  ON public.sessions FOR SELECT
  USING (auth.uid() = host_user_id);

-- Participants can view sessions they're part of
CREATE POLICY "Participants can view their sessions"
  ON public.sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = sessions.id
        AND sp.user_id = auth.uid()
        AND sp.left_at IS NULL
    )
  );

-- Anyone can view session by join code (for joining)
CREATE POLICY "Anyone can lookup session by join code"
  ON public.sessions FOR SELECT
  USING (status IN ('created', 'active', 'paused'));

-- Host can create sessions (via RPC)
CREATE POLICY "Authenticated users can create sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (auth.uid() = host_user_id);

-- Host can update own sessions
CREATE POLICY "Host can update own sessions"
  ON public.sessions FOR UPDATE
  USING (auth.uid() = host_user_id)
  WITH CHECK (auth.uid() = host_user_id);

-- Host can delete own sessions
CREATE POLICY "Host can delete own sessions"
  ON public.sessions FOR DELETE
  USING (auth.uid() = host_user_id);

-- RLS Policies for session_participants table

-- Participants can view participants in their session
CREATE POLICY "Session participants can view each other"
  ON public.session_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = session_participants.session_id
        AND sp.user_id = auth.uid()
        AND sp.left_at IS NULL
    )
  );

-- Host can view all participants in their sessions
CREATE POLICY "Host can view session participants"
  ON public.session_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_participants.session_id
        AND s.host_user_id = auth.uid()
    )
  );

-- Insert is handled via RPC (create_session, join_session)
-- Allow insert for authenticated users joining their own sessions
CREATE POLICY "Users can join sessions"
  ON public.session_participants FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can update their own participant record (e.g., request control)
CREATE POLICY "Users can update own participation"
  ON public.session_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Host can update any participant in their session (for control state)
CREATE POLICY "Host can update participants"
  ON public.session_participants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_participants.session_id
        AND s.host_user_id = auth.uid()
    )
  );

-- Host can remove participants from their session
CREATE POLICY "Host can delete participants"
  ON public.session_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_participants.session_id
        AND s.host_user_id = auth.uid()
    )
  );

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.sessions TO authenticated;
GRANT ALL ON public.session_participants TO authenticated;
GRANT SELECT ON public.sessions TO anon; -- For join code lookup
GRANT INSERT ON public.session_participants TO anon; -- For guest joining

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.create_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_session TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_control TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_session TO authenticated;
