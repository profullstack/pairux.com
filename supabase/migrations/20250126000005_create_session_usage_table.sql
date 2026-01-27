-- Create session_usage table for tracking bandwidth and connection metrics
-- Used for usage-based billing and analytics

CREATE TABLE IF NOT EXISTS public.session_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Role at time of report
  role TEXT NOT NULL CHECK (role IN ('host', 'viewer')),

  -- Bandwidth metrics (cumulative since last report)
  bytes_sent BIGINT NOT NULL DEFAULT 0,
  bytes_received BIGINT NOT NULL DEFAULT 0,

  -- Packet metrics
  packets_sent BIGINT NOT NULL DEFAULT 0,
  packets_received BIGINT NOT NULL DEFAULT 0,
  packets_lost BIGINT NOT NULL DEFAULT 0,

  -- Quality metrics (point-in-time)
  round_trip_time REAL, -- milliseconds
  jitter REAL, -- milliseconds
  frame_rate REAL,
  frame_width INTEGER,
  frame_height INTEGER,

  -- Connection state at time of report
  connection_state TEXT NOT NULL CHECK (connection_state IN ('connecting', 'connected', 'disconnected', 'failed', 'closed')),

  -- Time between reports (for calculating rates)
  report_interval_ms INTEGER NOT NULL DEFAULT 30000,

  -- Timestamps
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_session_usage_session_id ON public.session_usage(session_id);
CREATE INDEX idx_session_usage_user_id ON public.session_usage(user_id);
CREATE INDEX idx_session_usage_participant_id ON public.session_usage(participant_id);
CREATE INDEX idx_session_usage_reported_at ON public.session_usage(reported_at);
CREATE INDEX idx_session_usage_session_reported ON public.session_usage(session_id, reported_at);

-- Index for billing queries (by user and time period)
CREATE INDEX idx_session_usage_user_time ON public.session_usage(user_id, reported_at) WHERE user_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.session_usage ENABLE ROW LEVEL SECURITY;

-- Policies

-- Hosts can view usage for their sessions
CREATE POLICY "Hosts can view session usage"
  ON public.session_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_usage.session_id
      AND s.host_user_id = auth.uid()
    )
  );

-- Users can view their own usage across all sessions
CREATE POLICY "Users can view own usage"
  ON public.session_usage FOR SELECT
  USING (user_id = auth.uid());

-- Anyone can insert usage (validated at API level)
-- This allows guests without auth to report stats
CREATE POLICY "Anyone can insert usage"
  ON public.session_usage FOR INSERT
  WITH CHECK (true);

-- Create a view for aggregated user usage (for billing)
CREATE OR REPLACE VIEW public.user_usage_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', reported_at) AS month,
  COUNT(DISTINCT session_id) AS session_count,
  SUM(bytes_sent) AS total_bytes_sent,
  SUM(bytes_received) AS total_bytes_received,
  SUM(bytes_sent + bytes_received) AS total_bytes_transferred,
  COUNT(*) AS report_count,
  AVG(round_trip_time) AS avg_round_trip_time
FROM public.session_usage
WHERE user_id IS NOT NULL
GROUP BY user_id, DATE_TRUNC('month', reported_at);

-- Create a view for session usage summary
CREATE OR REPLACE VIEW public.session_usage_summary AS
SELECT
  session_id,
  COUNT(DISTINCT participant_id) AS participant_count,
  SUM(bytes_sent) AS total_bytes_sent,
  SUM(bytes_received) AS total_bytes_received,
  SUM(bytes_sent + bytes_received) AS total_bytes_transferred,
  MIN(reported_at) AS first_report,
  MAX(reported_at) AS last_report,
  EXTRACT(EPOCH FROM (MAX(reported_at) - MIN(reported_at))) AS duration_seconds,
  COUNT(*) AS report_count
FROM public.session_usage
GROUP BY session_id;

-- Function to get user's monthly usage (for billing API)
CREATE OR REPLACE FUNCTION public.get_user_monthly_usage(
  p_user_id UUID,
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
  user_id UUID,
  month_start DATE,
  month_end DATE,
  session_count BIGINT,
  total_bytes_sent BIGINT,
  total_bytes_received BIGINT,
  total_bytes_transferred BIGINT,
  total_gb_transferred NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    su.user_id,
    DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1))::DATE AS month_start,
    (DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1)) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS month_end,
    COUNT(DISTINCT su.session_id) AS session_count,
    COALESCE(SUM(su.bytes_sent), 0)::BIGINT AS total_bytes_sent,
    COALESCE(SUM(su.bytes_received), 0)::BIGINT AS total_bytes_received,
    COALESCE(SUM(su.bytes_sent + su.bytes_received), 0)::BIGINT AS total_bytes_transferred,
    ROUND(COALESCE(SUM(su.bytes_sent + su.bytes_received), 0) / 1073741824.0, 3) AS total_gb_transferred
  FROM public.session_usage su
  WHERE su.user_id = p_user_id
    AND su.reported_at >= MAKE_DATE(p_year, p_month, 1)
    AND su.reported_at < MAKE_DATE(p_year, p_month, 1) + INTERVAL '1 month'
  GROUP BY su.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_monthly_usage TO authenticated;

COMMENT ON TABLE public.session_usage IS 'Tracks bandwidth and connection metrics for usage-based billing';
COMMENT ON VIEW public.user_usage_summary IS 'Monthly aggregated usage per user for billing';
COMMENT ON VIEW public.session_usage_summary IS 'Aggregated usage per session for analytics';
