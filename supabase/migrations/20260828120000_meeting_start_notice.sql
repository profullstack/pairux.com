-- Starting a scheduled meeting: record it, and let the ledger hold the notice.
--
-- Until now "starting a meeting" was a client-side move: the dashboard created a
-- session that happened to reuse the scheduled join code and navigated to it.
-- Nothing on the scheduled row changed, so the meeting could be started twice
-- (the second attempt failing on the join code), the invitees who were told a
-- time were never told it had actually begun, and the desktop app -- the only
-- host that can hand a guest control -- had no way to start one at all.

-- =============================================================================
-- The started stamp
-- =============================================================================

-- `session_id` has existed since 20260604100000 and was never written. It is the
-- live room this occurrence is being held in; `started_at` is when that happened.
-- Both are cleared when a recurring series rolls forward to its next occurrence,
-- which is what stops occurrence two adopting occurrence one's dead room.
ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.scheduled_sessions.started_at IS
  'When the host started this occurrence. NULL until then; cleared on roll-forward.';

COMMENT ON COLUMN public.scheduled_sessions.session_id IS
  'The live session this occurrence is being held in. Set on start, cleared on roll-forward.';

-- "Which of my meetings is running right now" is the desktop picker's first read.
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_started
  ON public.scheduled_sessions (host_user_id, started_at)
  WHERE started_at IS NOT NULL;

-- =============================================================================
-- lead_minutes = 0 means "it has started"
-- =============================================================================

-- The reminder ledger from 20260819140000 already answers exactly the question
-- the start notice needs answering -- has this person been told this thing about
-- this occurrence -- and answers it with a unique constraint claimed before the
-- send. A start notice is the same message with a lead of nothing, so it gets a
-- lead time of 0 rather than a second table with the same shape and the same
-- bugs. Keying on `occurrence_at` still applies: each occurrence of a recurring
-- meeting opens a fresh slot, so week two is announced even though week one was.
ALTER TABLE public.meeting_reminders
  DROP CONSTRAINT IF EXISTS meeting_reminders_lead_minutes_check;

ALTER TABLE public.meeting_reminders
  ADD CONSTRAINT meeting_reminders_lead_minutes_check
  CHECK (lead_minutes IN (1440, 60, 15, 1, 0));

COMMENT ON COLUMN public.meeting_reminders.lead_minutes IS
  '1440, 60, 15 or 1 minutes before the meeting; 0 is the notice sent when it actually starts.';
