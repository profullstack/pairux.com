-- Go-live notifications target the channel's subscribers (channel_subscriptions)
-- now that lives belong to channels. mark_room_went_live returns the channel so
-- the app can fan out push + email to subscribers. Legacy channel-less lives
-- fall back to the creator's followers (handled in app code).
DROP FUNCTION IF EXISTS public.mark_room_went_live(uuid);
CREATE OR REPLACE FUNCTION public.mark_room_went_live(p_session_id uuid)
RETURNS TABLE(creator_id uuid, subject text, join_code text, channel_id uuid, channel_handle text, channel_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  WITH upd AS (
    UPDATE public.sessions s SET live_notified_at = NOW()
    WHERE s.id = p_session_id AND s.is_public = TRUE AND s.current_host_id IS NOT NULL
      AND (s.current_host_id = auth.uid() OR s.creator_id = auth.uid() OR s.host_user_id = auth.uid())
      AND (s.live_notified_at IS NULL OR s.live_notified_at < NOW() - interval '1 hour')
    RETURNING s.creator_id, s.subject, s.join_code, s.channel_id
  )
  SELECT u.creator_id, u.subject, u.join_code, u.channel_id, c.handle, c.name
  FROM upd u LEFT JOIN public.channels c ON c.id = u.channel_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.mark_room_went_live(uuid) TO authenticated;
