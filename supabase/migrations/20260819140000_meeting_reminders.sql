-- Meeting reminders: the ledger that makes a reminder send at most once.
--
-- Reminders go out 1 day, 1 hour, 15 minutes and 1 minute before a meeting, by
-- email and by web push. A cron ticks every minute and asks "what is due now",
-- which means the same reminder is a candidate on several consecutive ticks if
-- anything is slow, retried, or running twice. This table is what stops it
-- being sent twice: a row is claimed *before* the message goes out, and the
-- unique constraint below is the claim.
--
-- At-most-once rather than at-least-once, deliberately. A crash between the
-- claim and the send loses that one reminder; the alternative loses nothing but
-- can mail somebody the same reminder repeatedly, and for an unsolicited
-- notification about a meeting that is already in the recipient's calendar,
-- silence is the better failure.

-- =============================================================================
-- The ledger
-- =============================================================================

CREATE TABLE public.meeting_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scheduled_session_id UUID NOT NULL
    REFERENCES public.scheduled_sessions(id) ON DELETE CASCADE,

  -- Which occurrence this reminder was for, as the exact start instant.
  --
  -- This column is the reason the table works for recurring meetings, and it is
  -- easy to leave out. 20260819120000 made a recurring meeting *one row* whose
  -- `scheduled_at` is the next occurrence, rolled forward by the app once an
  -- occurrence has finished. So a key of (session, lead) would fire a weekly
  -- meeting's "1 day before" exactly once, in its first week, and stay silent
  -- for ever after -- with nothing to show for it, because the ledger would
  -- look correctly filled in. Keying on the instant means every roll-forward
  -- opens a fresh set of slots.
  occurrence_at TIMESTAMPTZ NOT NULL,

  -- 1440, 60, 15 or 1. Stored as minutes rather than an enum so the set can be
  -- widened without a type migration; the check keeps today's four honest.
  lead_minutes INTEGER NOT NULL CHECK (lead_minutes IN (1440, 60, 15, 1)),

  -- Who it went to. A host is an account; an invitee is an email address on
  -- `scheduled_session_invitees` that may belong to nobody at all, so the two
  -- cannot share a key space and are not both foreign keys.
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('host', 'invitee')),
  recipient_key TEXT NOT NULL,

  -- Email and push are claimed separately: a host who has push disabled should
  -- still get the mail, and a push that fails should not consume the mail's
  -- slot.
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),

  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The claim. Everything above the timestamp identifies one message to one
  -- person about one occurrence, and there is only ever one of those.
  UNIQUE (scheduled_session_id, occurrence_at, lead_minutes, recipient_kind, recipient_key, channel)
);

-- Answering "has this already gone out" for a whole occurrence in one indexed
-- read, which is what the runner asks once per due meeting.
CREATE INDEX idx_meeting_reminders_occurrence
  ON public.meeting_reminders (scheduled_session_id, occurrence_at);

-- For pruning. The ledger is append-only and grows with every meeting, so old
-- rows are deleted once the meeting they describe is long past -- see the
-- cleanup at the bottom.
CREATE INDEX idx_meeting_reminders_sent_at
  ON public.meeting_reminders (sent_at);

-- =============================================================================
-- Access
-- =============================================================================

ALTER TABLE public.meeting_reminders ENABLE ROW LEVEL SECURITY;

-- No policy for anon or authenticated, and that is the intent rather than an
-- omission: this table is written only by the reminder runner, which uses the
-- service role and bypasses RLS. Nothing in the app reads it, so leaving it
-- with RLS on and no policies means a leaked anon key cannot enumerate who was
-- invited to what and when they were told.

-- Hosts may read their own meetings' reminder history, so a "we emailed you at
-- 09:00" line on the meeting page has something true to say.
CREATE POLICY "Host reads own meeting reminders"
  ON public.meeting_reminders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.scheduled_sessions ss
      WHERE ss.id = meeting_reminders.scheduled_session_id
        AND ss.host_user_id = auth.uid()
    )
  );

-- =============================================================================
-- Pruning
-- =============================================================================

-- A ledger row is only useful while its occurrence could still be re-sent by a
-- late tick. A fortnight is far beyond any grace window and keeps the table
-- small without anybody having to think about it again.
CREATE OR REPLACE FUNCTION public.prune_meeting_reminders()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.meeting_reminders
  WHERE sent_at < NOW() - INTERVAL '14 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.meeting_reminders IS
  'One row per reminder actually sent. The unique constraint is a claim taken before sending, which is what makes a per-minute cron safe to run twice.';
