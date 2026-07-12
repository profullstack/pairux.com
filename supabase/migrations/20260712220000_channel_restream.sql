-- Per-channel external RTMP restream destinations (YouTube/Twitch/…).
-- Restreaming is configured ONCE per channel (persistent) instead of re-entered
-- each live; when a channel with restream_enabled + ≥1 enabled destination goes
-- public, the app auto-starts a LiveKit egress fanning out to those RTMP URLs.
--
-- Stream keys are secrets stored service-only (RLS on, NO policies — like
-- youtube_credentials); the client never sends or receives a key. The full
-- ingest URL (rtmp_url + '/' + stream_key) is assembled server-side at go-live.

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS restream_enabled boolean NOT NULL DEFAULT false;

-- Track the active restream egress so it can be stopped when the host leaves.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS restream_egress_id text;

CREATE TABLE IF NOT EXISTS public.channel_restream_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'custom',
  label text,
  rtmp_url text NOT NULL,
  stream_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS channel_restream_dest_channel_idx
  ON public.channel_restream_destinations (channel_id);
ALTER TABLE public.channel_restream_destinations ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (secrets). Owners manage via the RPCs below.

-- List a channel's destinations WITHOUT the secret key (owner-only).
CREATE OR REPLACE FUNCTION public.list_channel_restream_destinations(p_channel_id uuid)
RETURNS TABLE(
  id uuid, platform text, label text, rtmp_url text,
  enabled boolean, has_key boolean, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND c.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  RETURN QUERY
  SELECT d.id, d.platform, d.label, d.rtmp_url, d.enabled,
    (d.stream_key IS NOT NULL AND d.stream_key <> '') AS has_key, d.created_at
  FROM public.channel_restream_destinations d
  WHERE d.channel_id = p_channel_id
  ORDER BY d.created_at;
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_channel_restream_destinations(uuid) TO authenticated;

-- Add (p_id NULL) or update a destination (owner-only). On update a NULL/empty
-- key keeps the existing one (so keys are never round-tripped to the client).
CREATE OR REPLACE FUNCTION public.upsert_channel_restream_destination(
  p_channel_id uuid, p_id uuid, p_platform text, p_label text,
  p_rtmp_url text, p_stream_key text, p_enabled boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND c.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  IF p_rtmp_url IS NULL OR p_rtmp_url !~ '^rtmps?://.+' THEN
    RAISE EXCEPTION 'RTMP URL must start with rtmp:// or rtmps://';
  END IF;

  IF p_id IS NULL THEN
    IF p_stream_key IS NULL OR p_stream_key = '' THEN
      RAISE EXCEPTION 'Stream key required';
    END IF;
    INSERT INTO public.channel_restream_destinations
      (channel_id, platform, label, rtmp_url, stream_key, enabled)
    VALUES (p_channel_id, COALESCE(p_platform, 'custom'), p_label, p_rtmp_url,
      p_stream_key, COALESCE(p_enabled, TRUE))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.channel_restream_destinations SET
      platform = COALESCE(p_platform, platform),
      label = p_label,
      rtmp_url = p_rtmp_url,
      enabled = COALESCE(p_enabled, enabled),
      stream_key = COALESCE(NULLIF(p_stream_key, ''), stream_key)
    WHERE id = p_id AND channel_id = p_channel_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Destination not found'; END IF;
  END IF;
  RETURN v_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.upsert_channel_restream_destination(uuid, uuid, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_channel_restream_destination(p_channel_id uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.channels c WHERE c.id = p_channel_id AND c.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your channel';
  END IF;
  DELETE FROM public.channel_restream_destinations WHERE id = p_id AND channel_id = p_channel_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_channel_restream_destination(uuid, uuid) TO authenticated;

-- Master on/off for a channel's restreaming (owner-only).
CREATE OR REPLACE FUNCTION public.set_channel_restream_enabled(p_channel_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.channels SET restream_enabled = COALESCE(p_enabled, FALSE), updated_at = NOW()
  WHERE id = p_channel_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not your channel'; END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.set_channel_restream_enabled(uuid, boolean) TO authenticated;

-- Surface restream_enabled on the owner's channel list (for the dashboard).
DROP FUNCTION IF EXISTS public.list_my_channels();
CREATE OR REPLACE FUNCTION public.list_my_channels()
RETURNS TABLE(
  id uuid, handle text, name text, description text, avatar_url text, banner_url text,
  stream_key text, subscriber_count bigint, restream_enabled boolean, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT c.id, c.handle, c.name, c.description, c.avatar_url, c.banner_url, c.stream_key,
    (SELECT COUNT(*) FROM public.channel_subscriptions cs WHERE cs.channel_id = c.id),
    c.restream_enabled, c.created_at
  FROM public.channels c WHERE c.owner_id = auth.uid() ORDER BY c.created_at ASC;
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_my_channels() TO authenticated;
