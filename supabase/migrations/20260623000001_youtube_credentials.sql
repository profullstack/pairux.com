-- YouTube OAuth credentials (per user)
-- Stores the user's YouTube refresh token so the server can auto-transition a
-- "Preparing" broadcast to live via the YouTube Live API.
--
-- The refresh_token is sensitive and SERVER-ONLY. RLS is enabled with NO
-- policies, so PostgREST/anon/authenticated clients cannot read it — only the
-- service-role key (which bypasses RLS) can, from server routes. Connected
-- status is surfaced to the client via a server route, never the token itself.

CREATE TABLE IF NOT EXISTS public.youtube_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  channel_title TEXT,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS with no policies => deny all client access; service role bypasses.
ALTER TABLE public.youtube_credentials ENABLE ROW LEVEL SECURITY;
