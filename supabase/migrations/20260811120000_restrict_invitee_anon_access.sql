-- Close off anonymous access to scheduled_session_invitees
--
-- 20260604100000_scheduled_sessions.sql created two policies for the public RSVP
-- page, written before it was settled that the page would be served by API routes:
--
--   "Public read invitee by token"  FOR SELECT TO anon, authenticated USING (true)
--   "Public update rsvp status"     FOR UPDATE TO anon, authenticated USING (true)
--                                                              WITH CHECK (true)
--
-- Neither is scoped to a token, and the UPDATE one is not scoped to rsvp_status
-- either — its name describes an intent the policy does not express. RLS policies
-- cannot restrict which columns an UPDATE touches; that needs column-level GRANTs
-- or a trigger. As written, anyone holding the anon key — which ships to every
-- browser — can read every invitee row (including invite_token, the credential the
-- RSVP links are built on) and rewrite any column of any row.
--
-- Nothing needs these policies. Every code path that touches this table goes
-- through the service-role client, which bypasses RLS entirely:
--
--   GET/POST /api/invite/[token]        — RSVP fetch + submit
--   GET/POST/PATCH/DELETE /api/scheduled-sessions[/id]
--   GET /api/sessions/join/[joinCode]
--
-- So drop them. Hosts keep full access to their own meetings' invitees through
-- "Host manages invitees", which is scoped by the parent session's host_user_id.
-- With RLS still enabled and no permissive policy left for anon, anonymous
-- requests against this table now return nothing.

DROP POLICY IF EXISTS "Public read invitee by token" ON public.scheduled_session_invitees;
DROP POLICY IF EXISTS "Public update rsvp status" ON public.scheduled_session_invitees;

-- Belt and braces: the table-level grants Supabase hands the anon/authenticated
-- roles by default are what RLS gates. Revoking the write privileges outright means
-- a future permissive policy added by mistake still cannot mutate this table from
-- the browser. Reads stay revoked for anon too; the API serves them.
REVOKE INSERT, UPDATE, DELETE ON public.scheduled_session_invitees FROM anon;
REVOKE SELECT ON public.scheduled_session_invitees FROM anon;

COMMENT ON TABLE public.scheduled_session_invitees IS
  'Meeting invitees. Not reachable with the anon key: all public access is server-side via the service role (see /api/invite/[token]), and hosts reach the invitees of their own meetings through RLS. invite_token is a bearer credential — never expose it to a client that is not the invitee it belongs to.';
