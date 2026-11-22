-- c0mpute Live: a channel's lives restreamed over RTMP into the c0mpute p2p
-- network (Settings -> c0mpute Live).
--
-- The c0mpute OAuth token / pasted API key is NEVER stored. It is used once,
-- at connect time, to create a c0mpute stream per channel; the stream key
-- lands in the existing channel_restream_destinations table (platform
-- 'c0mpute', service-role only) and the public watch link lands here.
--
-- Idempotent (IF NOT EXISTS throughout): safe to apply by hand more than once.

CREATE TABLE IF NOT EXISTS public.c0mpute_live_links (
  channel_id uuid PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_id text NOT NULL,
  watch_url text,
  playback_url text,
  account_label text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS c0mpute_live_links_user_idx
  ON public.c0mpute_live_links (user_id);
ALTER TABLE public.c0mpute_live_links ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
REVOKE ALL ON public.c0mpute_live_links FROM anon, authenticated;

-- One-row cache of PairUX's dynamically registered c0mpute OAuth client (a
-- public client: there is no secret, only the id and the redirect it is for).
CREATE TABLE IF NOT EXISTS public.c0mpute_oauth_client (
  id boolean PRIMARY KEY DEFAULT TRUE CHECK (id),
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE public.c0mpute_oauth_client ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
REVOKE ALL ON public.c0mpute_oauth_client FROM anon, authenticated;
