-- Add plan column to profiles table
-- Drives the paid multistream plugin: free = YouTube only,
-- pro/team unlock streaming to every other platform simultaneously.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'plus', 'pro', 'team'));

COMMENT ON COLUMN public.profiles.plan IS
  'Billing plan: free (YouTube-only streaming), pro/team (all streaming platforms). Source of truth for the paid multistream plugin.';
