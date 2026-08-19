-- Recurring scheduled meetings
--
-- A recurring meeting stays ONE row: it keeps a single join code, invitee list
-- and set of invite emails for the whole series. `scheduled_at` always points at
-- the next occurrence and is rolled forward by the app once an occurrence has
-- finished, so there is no cron job and no row-per-occurrence fan-out.

ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS recurrence_freq TEXT
    CHECK (recurrence_freq IN ('daily', 'weekly', 'monthly')),
  -- Repeat every N days/weeks/months.
  ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 30),
  -- Total occurrences in the series. 0 means it repeats forever.
  ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 0
    CHECK (recurrence_count BETWEEN 0 AND 365),
  -- Occurrences that have already finished.
  ADD COLUMN IF NOT EXISTS occurrences_elapsed INTEGER NOT NULL DEFAULT 0
    CHECK (occurrences_elapsed >= 0),
  -- The first occurrence. Fixes the day of the month for monthly series so one
  -- booked on the 31st does not permanently slide to the 28th after February.
  ADD COLUMN IF NOT EXISTS recurrence_anchor_at TIMESTAMPTZ;

COMMENT ON COLUMN public.scheduled_sessions.recurrence_freq IS
  'daily | weekly | monthly. NULL means the meeting happens once.';
COMMENT ON COLUMN public.scheduled_sessions.recurrence_count IS
  'Total occurrences in the series; 0 = repeats forever.';
COMMENT ON COLUMN public.scheduled_sessions.occurrences_elapsed IS
  'Occurrences that have already finished; the app advances scheduled_at lazily.';
COMMENT ON COLUMN public.scheduled_sessions.recurrence_anchor_at IS
  'First occurrence of the series — anchors the day of the month for monthly rules.';

-- Existing rows are one-offs; give them an anchor so the app can treat every row
-- uniformly if one is later turned into a series.
UPDATE public.scheduled_sessions
SET recurrence_anchor_at = scheduled_at
WHERE recurrence_anchor_at IS NULL;

-- Roll-forward looks up the host's unfinished recurring meetings.
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_recurring
  ON public.scheduled_sessions (host_user_id, scheduled_at)
  WHERE recurrence_freq IS NOT NULL AND status = 'pending';
