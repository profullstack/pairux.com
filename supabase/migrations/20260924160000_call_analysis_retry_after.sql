-- Call analysis: let a queued analysis wait. When every report provider is
-- out of budget the job sets queued_at in the future; claim_call_analysis now
-- only takes analyses whose queued_at has arrived.
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
  WHERE status = 'queued' AND (queued_at IS NULL OR queued_at <= NOW())
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
