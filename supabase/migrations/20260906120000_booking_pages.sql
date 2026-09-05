-- Booking pages: a public, Calendly-style link a host hands out.
--
-- A booking page is the host's availability plus a duration, published at
-- /book/<username>/<slug>. A stranger picks a free slot, leaves a name and an
-- email, and what lands is an ordinary scheduled meeting — a row in
-- scheduled_sessions with the guest as its one invitee — so the invite email,
-- reminders, the Start button and the room itself all come for free. The only
-- new thing in the world is the page; the meeting it produces is a meeting the
-- host could have scheduled by hand.

CREATE TABLE public.booking_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The URL segment after the username: /book/<username>/<slug>.
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  -- IANA zone the availability windows are written in ("America/Los_Angeles").
  timezone TEXT NOT NULL,
  -- Weekly windows, keyed by day: {"mon":[{"start":"09:00","end":"17:00"}], ...}.
  -- A day that is missing or empty has no availability.
  availability JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Kept free on either side of a booking, so back-to-back calls do not collide.
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 240),
  -- How far ahead of now a slot must start to be offered.
  min_notice_minutes INTEGER NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 20160),
  -- How far into the future the page offers slots at all.
  max_days_ahead INTEGER NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 365),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (host_user_id, slug)
);

CREATE INDEX idx_booking_pages_host ON public.booking_pages (host_user_id);

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;

-- Hosts manage their own pages. Guests never touch this table from the
-- browser: the public read goes through /api/book/<username>, served by the
-- service role, which is also what keeps a host's inactive pages private.
CREATE POLICY "Hosts manage own booking pages"
  ON public.booking_pages FOR ALL
  TO authenticated
  USING (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

REVOKE ALL ON public.booking_pages FROM anon;

-- A meeting that came in through a page remembers which one, so the dashboard
-- can say "booked via Intro call" and a page's bookings can be listed. ON DELETE
-- SET NULL: removing a page must not cancel the meetings already booked on it.
ALTER TABLE public.scheduled_sessions
  ADD COLUMN IF NOT EXISTS booking_page_id UUID REFERENCES public.booking_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_booking_page
  ON public.scheduled_sessions (booking_page_id)
  WHERE booking_page_id IS NOT NULL;

-- Slot computation reads a host's pending meetings inside a date range.
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_host_pending_at
  ON public.scheduled_sessions (host_user_id, scheduled_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.booking_pages IS
  'Public booking links (/book/<username>/<slug>). A booking creates a scheduled_sessions row with the guest as invitee; nothing else is special about it.';
COMMENT ON COLUMN public.booking_pages.availability IS
  'Weekly windows in the page''s timezone: {"mon":[{"start":"09:00","end":"17:00"}],...}. Missing day = unavailable.';
