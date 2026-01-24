-- Room-Centric Architecture Migration
-- Principle: A room is a durable object. A host is just a role.
-- This enables session resilience for SFU mode (Pro/Team plans)

-- =============================================================================
-- STEP 1: Modify sessions table for room-centric model
-- =============================================================================

-- Add current_host_id (nullable - room can exist without active host)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS current_host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add host presence tracking
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS host_last_seen_at TIMESTAMPTZ;

-- Add room expiration (TTL)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add mode column for P2P vs SFU
CREATE TYPE public.session_mode AS ENUM ('p2p', 'sfu');
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS mode public.session_mode NOT NULL DEFAULT 'p2p';

-- Backfill: set current_host_id to host_user_id for existing sessions
UPDATE public.sessions
SET current_host_id = host_user_id
WHERE current_host_id IS NULL AND status != 'ended';

-- Rename host_user_id to creator_id for clarity (keep for billing/ownership)
-- Note: We do this via a new column to avoid breaking existing code
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.sessions
SET creator_id = host_user_id
WHERE creator_id IS NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN public.sessions.host_user_id IS 'DEPRECATED: Use creator_id for owner, current_host_id for active host';
COMMENT ON COLUMN public.sessions.creator_id IS 'User who created the room (for billing/ownership)';
COMMENT ON COLUMN public.sessions.current_host_id IS 'Currently active host (nullable - room survives without host)';
COMMENT ON COLUMN public.sessions.host_last_seen_at IS 'Last heartbeat from current host';
COMMENT ON COLUMN public.sessions.expires_at IS 'When room expires if inactive (TTL)';
COMMENT ON COLUMN public.sessions.mode IS 'Connection mode: p2p (free) or sfu (pro/team)';

-- Create index for presence queries
CREATE INDEX IF NOT EXISTS sessions_host_last_seen_idx ON public.sessions(host_last_seen_at);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions(expires_at);

-- =============================================================================
-- STEP 2: Create media_sessions table (ephemeral screen shares)
-- =============================================================================

CREATE TYPE public.media_session_status AS ENUM ('active', 'paused', 'ended');

CREATE TABLE IF NOT EXISTS public.media_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  publisher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode public.session_mode NOT NULL DEFAULT 'p2p',
  status public.media_session_status NOT NULL DEFAULT 'active',

  -- SFU-specific fields
  sfu_endpoint TEXT,
  sfu_room_id TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  -- Metadata
  capture_source JSONB -- { type: 'screen'|'window', name: string, id: string }
);

-- Enable RLS
ALTER TABLE public.media_sessions ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS media_sessions_room_id_idx ON public.media_sessions(room_id);
CREATE INDEX IF NOT EXISTS media_sessions_publisher_id_idx ON public.media_sessions(publisher_id);
CREATE INDEX IF NOT EXISTS media_sessions_status_idx ON public.media_sessions(status);

COMMENT ON TABLE public.media_sessions IS 'Ephemeral screen share sessions within a room. Room survives when media_session ends.';

-- =============================================================================
-- STEP 3: Add presence tracking to participants
-- =============================================================================

ALTER TABLE public.session_participants
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.session_participants
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'connected'
  CHECK (connection_status IN ('connected', 'reconnecting', 'disconnected'));

-- Create index for presence queries
CREATE INDEX IF NOT EXISTS session_participants_last_seen_idx ON public.session_participants(last_seen_at);

-- =============================================================================
-- STEP 4: Add backup host designation
-- =============================================================================

ALTER TABLE public.session_participants
ADD COLUMN IF NOT EXISTS is_backup_host BOOLEAN DEFAULT FALSE;

-- =============================================================================
-- STEP 5: RLS Policies for media_sessions
-- =============================================================================

-- Publishers can manage their own media sessions
CREATE POLICY "Publishers can manage own media sessions"
  ON public.media_sessions
  FOR ALL
  TO authenticated
  USING (publisher_id = auth.uid())
  WITH CHECK (publisher_id = auth.uid());

-- Room participants can view media sessions
CREATE POLICY "Room participants can view media sessions"
  ON public.media_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = room_id
        AND sp.user_id = auth.uid()
        AND sp.left_at IS NULL
    )
  );

-- Room creators can manage all media sessions in their rooms
CREATE POLICY "Room creators can manage room media sessions"
  ON public.media_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = room_id
        AND s.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = room_id
        AND s.creator_id = auth.uid()
    )
  );

-- =============================================================================
-- STEP 6: New RPC Functions
-- =============================================================================

-- Update host presence (heartbeat)
CREATE OR REPLACE FUNCTION public.update_host_presence(
  p_session_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Update host_last_seen_at if user is current host
  UPDATE public.sessions
  SET host_last_seen_at = NOW()
  WHERE id = p_session_id
    AND current_host_id = auth.uid()
    AND status != 'ended'
  RETURNING * INTO v_session;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the current host';
  END IF;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update participant presence (heartbeat)
CREATE OR REPLACE FUNCTION public.update_participant_presence(
  p_session_id UUID
)
RETURNS public.session_participants AS $$
DECLARE
  v_participant public.session_participants;
BEGIN
  UPDATE public.session_participants
  SET
    last_seen_at = NOW(),
    connection_status = 'connected'
  WHERE session_id = p_session_id
    AND user_id = auth.uid()
    AND left_at IS NULL
  RETURNING * INTO v_participant;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Start a media session (begin screen sharing)
CREATE OR REPLACE FUNCTION public.start_media_session(
  p_room_id UUID,
  p_mode public.session_mode DEFAULT 'p2p',
  p_capture_source JSONB DEFAULT NULL
)
RETURNS public.media_sessions AS $$
DECLARE
  v_session public.sessions;
  v_media_session public.media_sessions;
BEGIN
  -- Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify room exists and is not ended
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_room_id AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Room not found or has ended';
  END IF;

  -- End any existing active media sessions from this publisher in this room
  UPDATE public.media_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE room_id = p_room_id
    AND publisher_id = auth.uid()
    AND status = 'active';

  -- Create new media session
  INSERT INTO public.media_sessions (room_id, publisher_id, mode, capture_source)
  VALUES (p_room_id, auth.uid(), p_mode, p_capture_source)
  RETURNING * INTO v_media_session;

  -- Update room: set current host and activate room
  UPDATE public.sessions
  SET
    current_host_id = auth.uid(),
    host_last_seen_at = NOW(),
    status = 'active',
    mode = p_mode
  WHERE id = p_room_id;

  RETURN v_media_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pause media session (host disconnecting gracefully)
CREATE OR REPLACE FUNCTION public.pause_media_session(
  p_media_session_id UUID
)
RETURNS public.media_sessions AS $$
DECLARE
  v_media_session public.media_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.media_sessions
  SET status = 'paused', paused_at = NOW()
  WHERE id = p_media_session_id
    AND publisher_id = auth.uid()
    AND status = 'active'
  RETURNING * INTO v_media_session;

  IF v_media_session IS NULL THEN
    RAISE EXCEPTION 'Media session not found or not yours';
  END IF;

  -- Update room status
  UPDATE public.sessions
  SET status = 'paused'
  WHERE id = v_media_session.room_id
    AND current_host_id = auth.uid();

  RETURN v_media_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- End media session
CREATE OR REPLACE FUNCTION public.end_media_session(
  p_media_session_id UUID
)
RETURNS public.media_sessions AS $$
DECLARE
  v_media_session public.media_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.media_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE id = p_media_session_id
    AND publisher_id = auth.uid()
    AND status IN ('active', 'paused')
  RETURNING * INTO v_media_session;

  IF v_media_session IS NULL THEN
    RAISE EXCEPTION 'Media session not found or not yours';
  END IF;

  -- Note: Room stays alive! Just clear the current host if this was their stream
  UPDATE public.sessions
  SET
    current_host_id = NULL,
    status = 'paused'
  WHERE id = v_media_session.room_id
    AND current_host_id = auth.uid();

  RETURN v_media_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Transfer host role to another participant
CREATE OR REPLACE FUNCTION public.transfer_host(
  p_session_id UUID,
  p_new_host_participant_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_new_host public.session_participants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify caller is current host or room creator
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (current_host_id = auth.uid() OR creator_id = auth.uid())
    AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not authorized to transfer host';
  END IF;

  -- Get the new host participant (must be active in session)
  SELECT * INTO v_new_host
  FROM public.session_participants
  WHERE id = p_new_host_participant_id
    AND session_id = p_session_id
    AND left_at IS NULL
    AND user_id IS NOT NULL; -- Must be authenticated user, not guest

  IF v_new_host IS NULL THEN
    RAISE EXCEPTION 'New host participant not found or is a guest';
  END IF;

  -- Demote old host to viewer
  UPDATE public.session_participants
  SET role = 'viewer'
  WHERE session_id = p_session_id
    AND role = 'host'
    AND left_at IS NULL;

  -- Promote new host
  UPDATE public.session_participants
  SET role = 'host', control_state = 'granted'
  WHERE id = p_new_host_participant_id;

  -- Update session
  UPDATE public.sessions
  SET current_host_id = v_new_host.user_id
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Designate backup host
CREATE OR REPLACE FUNCTION public.set_backup_host(
  p_session_id UUID,
  p_participant_id UUID,
  p_is_backup BOOLEAN DEFAULT TRUE
)
RETURNS public.session_participants AS $$
DECLARE
  v_session public.sessions;
  v_participant public.session_participants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify caller is current host or room creator
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND (current_host_id = auth.uid() OR creator_id = auth.uid())
    AND status != 'ended';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not authorized';
  END IF;

  -- If setting as backup, clear any existing backup first
  IF p_is_backup THEN
    UPDATE public.session_participants
    SET is_backup_host = FALSE
    WHERE session_id = p_session_id AND is_backup_host = TRUE;
  END IF;

  -- Update the participant
  UPDATE public.session_participants
  SET is_backup_host = p_is_backup
  WHERE id = p_participant_id
    AND session_id = p_session_id
    AND left_at IS NULL
    AND user_id IS NOT NULL -- Must be authenticated
  RETURNING * INTO v_participant;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'Participant not found or is a guest';
  END IF;

  RETURN v_participant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-promote backup host (called when host is detected offline)
CREATE OR REPLACE FUNCTION public.auto_promote_backup_host(
  p_session_id UUID
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
  v_backup public.session_participants;
BEGIN
  -- This should be called by a service role or edge function
  -- Verify session exists and has no active host
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND status != 'ended'
    AND (
      current_host_id IS NULL
      OR host_last_seen_at < NOW() - INTERVAL '2 minutes'
    );

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or host is still active';
  END IF;

  -- Find backup host
  SELECT * INTO v_backup
  FROM public.session_participants
  WHERE session_id = p_session_id
    AND is_backup_host = TRUE
    AND left_at IS NULL
    AND user_id IS NOT NULL
    AND connection_status = 'connected';

  IF v_backup IS NULL THEN
    -- No backup host, try to find any connected authenticated participant
    SELECT * INTO v_backup
    FROM public.session_participants
    WHERE session_id = p_session_id
      AND left_at IS NULL
      AND user_id IS NOT NULL
      AND connection_status = 'connected'
      AND role != 'host'
    ORDER BY joined_at ASC
    LIMIT 1;
  END IF;

  IF v_backup IS NOT NULL THEN
    -- Demote old host
    UPDATE public.session_participants
    SET role = 'viewer'
    WHERE session_id = p_session_id
      AND role = 'host'
      AND left_at IS NULL;

    -- Promote backup
    UPDATE public.session_participants
    SET role = 'host', control_state = 'granted', is_backup_host = FALSE
    WHERE id = v_backup.id;

    -- Update session
    UPDATE public.sessions
    SET
      current_host_id = v_backup.user_id,
      host_last_seen_at = NULL -- New host needs to send heartbeat
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  ELSE
    -- No one to promote, just mark session as paused (no host)
    UPDATE public.sessions
    SET
      current_host_id = NULL,
      status = 'paused'
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get session with host status
CREATE OR REPLACE FUNCTION public.get_session_status(
  p_session_id UUID
)
RETURNS TABLE (
  session_id UUID,
  status public.session_status,
  mode public.session_mode,
  host_online BOOLEAN,
  host_last_seen TIMESTAMPTZ,
  current_host_name TEXT,
  participant_count BIGINT,
  has_active_media BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id AS session_id,
    s.status,
    s.mode,
    s.current_host_id IS NOT NULL
      AND s.host_last_seen_at > NOW() - INTERVAL '1 minute' AS host_online,
    s.host_last_seen_at AS host_last_seen,
    p.display_name AS current_host_name,
    (SELECT COUNT(*) FROM public.session_participants sp
     WHERE sp.session_id = s.id AND sp.left_at IS NULL) AS participant_count,
    EXISTS (
      SELECT 1 FROM public.media_sessions ms
      WHERE ms.room_id = s.id AND ms.status = 'active'
    ) AS has_active_media
  FROM public.sessions s
  LEFT JOIN public.session_participants p
    ON p.session_id = s.id
    AND p.user_id = s.current_host_id
    AND p.left_at IS NULL
  WHERE s.id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Set room TTL (expiration)
CREATE OR REPLACE FUNCTION public.set_room_expiration(
  p_session_id UUID,
  p_hours INTEGER DEFAULT 24
)
RETURNS public.sessions AS $$
DECLARE
  v_session public.sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.sessions
  SET expires_at = NOW() + (p_hours || ' hours')::INTERVAL
  WHERE id = p_session_id
    AND creator_id = auth.uid()
  RETURNING * INTO v_session;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or you are not the creator';
  END IF;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- STEP 7: Cleanup function for expired rooms (run via cron/edge function)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_rooms()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- End sessions that have expired
  WITH expired AS (
    UPDATE public.sessions
    SET status = 'ended', ended_at = NOW()
    WHERE status != 'ended'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;

  -- Also mark participants as left
  UPDATE public.session_participants sp
  SET left_at = NOW()
  FROM public.sessions s
  WHERE sp.session_id = s.id
    AND s.status = 'ended'
    AND sp.left_at IS NULL;

  -- End orphaned media sessions
  UPDATE public.media_sessions ms
  SET status = 'ended', ended_at = NOW()
  FROM public.sessions s
  WHERE ms.room_id = s.id
    AND s.status = 'ended'
    AND ms.status != 'ended';

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- STEP 8: Mark stale participants as disconnected
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_stale_participants()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Mark participants as disconnected if no heartbeat for 1 minute
  WITH stale AS (
    UPDATE public.session_participants
    SET connection_status = 'disconnected'
    WHERE left_at IS NULL
      AND connection_status = 'connected'
      AND last_seen_at < NOW() - INTERVAL '1 minute'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM stale;

  -- Mark hosts as offline if no heartbeat for 2 minutes
  UPDATE public.sessions
  SET current_host_id = NULL, status = 'paused'
  WHERE status = 'active'
    AND host_last_seen_at < NOW() - INTERVAL '2 minutes';

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
