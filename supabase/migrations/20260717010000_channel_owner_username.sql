-- Expose the channel owner's username from get_channel so the channel page
-- (/@handle) can offer a "Message" button that DMs the owner. DMs are keyed by
-- username (see 20260717000000_direct_messages), so a channel whose owner has
-- no username simply won't show the button.

-- Adding a return column changes the OUT params, so the function must be
-- dropped and recreated (CREATE OR REPLACE can't change the return type).
DROP FUNCTION IF EXISTS public.get_channel(text);

CREATE OR REPLACE FUNCTION public.get_channel(p_handle text)
RETURNS TABLE(
  id uuid, handle text, name text, description text, avatar_url text, banner_url text,
  subscriber_count bigint, is_subscribed boolean, is_owner boolean, is_live boolean,
  live_viewers bigint, owner_username text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE live_ttl CONSTANT interval := interval '90 seconds';
BEGIN
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id AND cs.subscriber_id = auth.uid())),
    (auth.uid() IS NOT NULL AND c.owner_id = auth.uid()),
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.channel_id = c.id AND s.is_public
       AND s.current_host_id IS NOT NULL AND s.host_last_seen_at > NOW() - live_ttl),
    (SELECT COUNT(*) FROM public.session_participants sp
       JOIN public.sessions s2 ON s2.id = sp.session_id
       WHERE s2.channel_id = c.id AND s2.is_public
         AND s2.current_host_id IS NOT NULL AND s2.host_last_seen_at > NOW() - live_ttl
         AND sp.left_at IS NULL),
    (SELECT p.username FROM public.profiles p WHERE p.id = c.owner_id)
  FROM public.channels c
  WHERE lower(c.handle) = lower(btrim(COALESCE(p_handle, ''))) LIMIT 1;
END; $function$;
GRANT EXECUTE ON FUNCTION public.get_channel(text) TO anon, authenticated;
