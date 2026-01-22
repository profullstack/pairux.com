-- Create participant role enum
CREATE TYPE public.participant_role AS ENUM ('host', 'viewer');

-- Create control state enum
CREATE TYPE public.control_state AS ENUM ('view-only', 'requested', 'granted');

-- Create session_participants table
CREATE TABLE IF NOT EXISTS public.session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL for guests
  display_name TEXT NOT NULL,
  role public.participant_role NOT NULL DEFAULT 'viewer',
  control_state public.control_state NOT NULL DEFAULT 'view-only',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS session_participants_session_id_idx ON public.session_participants(session_id);
CREATE INDEX IF NOT EXISTS session_participants_user_id_idx ON public.session_participants(user_id);

-- Create unique constraint: one active participation per user per session
CREATE UNIQUE INDEX IF NOT EXISTS session_participants_unique_active
  ON public.session_participants(session_id, user_id)
  WHERE left_at IS NULL AND user_id IS NOT NULL;
