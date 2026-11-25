-- Room Q&A: anyone in a call can ask a question in the Q&A panel, others can
-- upvote it, a moderator (the room's host, or a user the partner named when
-- it opened the room) can pick one to go next, and agents in the room (the AI
-- board on board.saas, a moderator bot) read the queue through their poll and
-- mark a question "answering" (shown as "now answering") and then "answered".
--
-- RLS is deny-by-default with no policies: /api/v1/sessions/<id>/questions and
-- /api/v1/agents/<id>/questions/<qid> check membership and use the service
-- role. user_ids_by_email is SECURITY DEFINER and granted only to the service
-- role (partner sessions resolve their moderators' emails with it).

CREATE TABLE IF NOT EXISTS public.session_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.session_participants(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answering', 'answered', 'dismissed')),
  bumped_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS session_questions_session_idx ON public.session_questions (session_id, created_at);

CREATE TABLE IF NOT EXISTS public.session_question_votes (
  question_id uuid NOT NULL REFERENCES public.session_questions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.session_participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (question_id, participant_id)
);

ALTER TABLE public.session_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_question_votes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_ids_by_email(p_emails text[])
RETURNS TABLE (id uuid, email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
  SELECT u.id, lower(u.email::text) FROM auth.users u WHERE lower(u.email::text) = ANY (SELECT lower(e) FROM unnest(p_emails) e);
$$;

REVOKE ALL ON FUNCTION public.user_ids_by_email(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_ids_by_email(text[]) TO service_role;
GRANT ALL ON public.session_questions, public.session_question_votes TO service_role;
