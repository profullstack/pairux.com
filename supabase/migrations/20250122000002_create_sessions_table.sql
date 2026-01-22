-- Create session status enum
CREATE TYPE public.session_status AS ENUM ('created', 'active', 'paused', 'ended');

-- Create sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.session_status NOT NULL DEFAULT 'created',
  join_code TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{"quality": "medium", "allowControl": true, "maxParticipants": 5}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Create function to generate unique 6-character join code
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Removed ambiguous chars: I,O,0,1
  code TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Create function to generate unique join code with retry
CREATE OR REPLACE FUNCTION public.generate_unique_join_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
BEGIN
  LOOP
    new_code := public.generate_join_code();

    -- Check if code already exists
    IF NOT EXISTS (SELECT 1 FROM public.sessions WHERE join_code = new_code) THEN
      RETURN new_code;
    END IF;

    attempt := attempt + 1;
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique join code after % attempts', max_attempts;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate join code
CREATE OR REPLACE FUNCTION public.handle_new_session()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.join_code IS NULL OR NEW.join_code = '' THEN
    NEW.join_code := public.generate_unique_join_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_generate_join_code
  BEFORE INSERT ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_session();

-- Create indexes
CREATE INDEX IF NOT EXISTS sessions_host_user_id_idx ON public.sessions(host_user_id);
CREATE INDEX IF NOT EXISTS sessions_join_code_idx ON public.sessions(join_code);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON public.sessions(status);
