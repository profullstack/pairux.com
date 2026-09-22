-- /channels shows each channel's subscriber count and a pulsing dot when it is
-- live, but nothing about how much is actually on the channel. Add two counts
-- to the directory RPC so the card can say "2 live · 14 recordings":
--
--   live_count      public sessions with a host seen in the last 90 s — the
--                   same rows /c/<handle> lists as streams.
--   recording_count finished, playable recordings of public sessions — the
--                   same rows list_channel_recordings returns.
--
-- The return type changes, so the old signature has to go first.

DROP FUNCTION IF EXISTS public.list_all_channels(integer);

CREATE OR REPLACE FUNCTION public.list_all_channels(p_limit integer DEFAULT 48)
RETURNS TABLE(
  handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_live boolean, live_count bigint, recording_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.recordings r
      JOIN public.sessions s ON s.id = r.session_id
      WHERE r.channel_id = c.id AND r.status = 'ready' AND r.playback_url IS NOT NULL
        AND s.is_public = TRUE)
  FROM public.channels c
  ORDER BY EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
      AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl) DESC,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id) DESC, c.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 48), 100));
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_all_channels(integer) TO anon, authenticated;
