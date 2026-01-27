-- Add settings column to profiles table
-- Stores user preferences as JSONB

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.settings IS 'User preferences and settings stored as JSON';
