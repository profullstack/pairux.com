-- A scheduled meeting can name the channel it broadcasts on. Starting the
-- meeting attaches that channel to the room it opens, so publishing the room
-- (web or desktop) goes out on it rather than on whatever the host picks then.
-- NULL means a private meeting with no channel, which is the default.
--
-- The host must be able to use the channel (their own, or a team/org channel
-- per can_use_resource); the API checks that against list_my_channels before
-- writing, since the row is written with the service client.
ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS scheduled_sessions_channel_idx
  ON public.scheduled_sessions(channel_id) WHERE channel_id IS NOT NULL;
