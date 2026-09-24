-- AI call analysis: feedback on an interview, team sync or presentation held
-- over PairUX.
--
-- The host decides BEFORE the call starts: the choice is stored in
-- sessions.settings.analysis when the session is created
-- ({ enabled, kind, keepRecording }) and nothing changes it afterwards.
-- While the call runs, the host's app uploads the call audio in chunks, plus a
-- still of the shared screen every 20 seconds, into the private
-- `call-analysis` bucket. When the call ends a server job transcribes the
-- audio (with speakers), measures delivery, and asks Claude for the report.
--
-- Everything here is written by the service role only; hosts read their own
-- analyses through RLS.

INSERT INTO storage.buckets (id, name, public)
VALUES ('call-analysis', 'call-analysis', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.call_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'general'
    CHECK (kind IN ('general', 'interview', 'team-sync', 'presentation')),
  keep_recording BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL CHECK (source IN ('web', 'desktop', 'mobile')),
  -- 'stream': chunks of one MediaRecorder stream, concatenated byte-for-byte.
  -- 'segments': self-contained audio files (mobile), joined by ffmpeg.
  chunk_format TEXT NOT NULL DEFAULT 'stream' CHECK (chunk_format IN ('stream', 'segments')),
  mime_type TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'queued', 'processing', 'ready', 'failed')),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  frame_count INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  recording_path TEXT,
  duration_seconds INTEGER,
  transcript JSONB,
  metrics JSONB,
  report JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_upload_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One capture per session at a time (a reconnecting host reuses it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_analyses_one_recording
  ON public.call_analyses (session_id) WHERE status = 'recording';
CREATE INDEX IF NOT EXISTS idx_call_analyses_host ON public.call_analyses (host_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_analyses_work ON public.call_analyses (status, queued_at)
  WHERE status IN ('recording', 'queued', 'processing');

ALTER TABLE public.call_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts read their own call analyses" ON public.call_analyses;
CREATE POLICY "Hosts read their own call analyses"
  ON public.call_analyses FOR SELECT
  TO authenticated
  USING (host_user_id = auth.uid());

-- Claim the next analysis to process, exactly once across concurrent workers.
-- A capture whose uploads stopped 10+ minutes ago (tab closed, app crashed)
-- is treated as finished. A job stuck in 'processing' for 30+ minutes (worker
-- died) is retried, up to 3 attempts.
CREATE OR REPLACE FUNCTION public.claim_call_analysis()
RETURNS public.call_analyses
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.call_analyses;
BEGIN
  UPDATE public.call_analyses
  SET status = 'queued', queued_at = NOW()
  WHERE status = 'recording' AND last_upload_at < NOW() - INTERVAL '10 minutes';

  UPDATE public.call_analyses
  SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
      error = CASE WHEN attempts >= 3 THEN 'Analysis did not finish after 3 attempts' ELSE error END
  WHERE status = 'processing' AND queued_at < NOW() - INTERVAL '30 minutes';

  SELECT * INTO v_row
  FROM public.call_analyses
  WHERE status = 'queued'
  ORDER BY queued_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.call_analyses
  SET status = 'processing', attempts = attempts + 1, queued_at = NOW()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_call_analysis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_call_analysis() TO service_role;
