-- Personal rooms: a permanent link per user (pairux.com/m/<slug>) that always
-- leads to that person's call. Every user has one default room, created for
-- existing users here and for new users by a trigger on profiles; users can
-- add more (up to 10), rename them, change slugs and pick the default.
--
-- Opening a room as its owner starts (or resumes) a session bound to it
-- (current_session_id); guests are sent into that session while it is live.
--
-- RLS is deny-by-default with no policies: /api/v1/me/rooms and
-- /api/v1/rooms/<slug> check ownership and use the service role. The helper
-- functions are SECURITY DEFINER and granted to nobody but the service role.

CREATE TABLE IF NOT EXISTS public.personal_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' AND slug NOT LIKE '%--%'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT FALSE,
  settings jsonb NOT NULL DEFAULT '{"mode":"p2p","locked":false}'::jsonb,
  current_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_rooms_slug_key ON public.personal_rooms (slug);
CREATE UNIQUE INDEX IF NOT EXISTS personal_rooms_one_default
  ON public.personal_rooms (owner_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS personal_rooms_owner_idx ON public.personal_rooms (owner_id, created_at);

ALTER TABLE public.personal_rooms ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS personal_rooms_updated_at ON public.personal_rooms;
CREATE TRIGGER personal_rooms_updated_at BEFORE UPDATE ON public.personal_rooms
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Slugs that would read as part of the product, kept in step with
-- apps/web/src/lib/personal-rooms/slug.ts (RESERVED_SLUGS).
CREATE OR REPLACE FUNCTION public.personal_room_slug_reserved(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug = ANY (ARRAY[
    'admin','api','app','auth','billing','blog','book','c','dashboard','docs','download',
    'help','host','join','live','login','logout','m','me','new','pairux','pricing','r',
    'recordings','room','rooms','root','settings','signup','start','support','system','token','u',
    'upgrade','www'
  ]);
$$;

-- The slug a name turns into: lowercase ASCII letters/digits and single dashes.
CREATE OR REPLACE FUNCTION public.personal_room_slug_base(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), 32);
$$;

-- Create the user's default room if they have none. Idempotent.
CREATE OR REPLACE FUNCTION public.ensure_default_personal_room(p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_room uuid;
  v_profile public.profiles%ROWTYPE;
  v_display text;
  v_base text;
  v_slug text;
  v_n int := 1;
BEGIN
  SELECT id INTO v_room FROM public.personal_rooms WHERE owner_id = p_user AND is_default;
  IF v_room IS NOT NULL THEN RETURN v_room; END IF;

  -- A user who already has rooms but no default: promote the oldest.
  SELECT id INTO v_room FROM public.personal_rooms WHERE owner_id = p_user ORDER BY created_at LIMIT 1;
  IF v_room IS NOT NULL THEN
    UPDATE public.personal_rooms SET is_default = TRUE WHERE id = v_room;
    RETURN v_room;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Never put an email address in a public link: an email-looking name keeps
  -- only its local part.
  v_display := nullif(btrim(split_part(coalesce(v_profile.display_name, ''), '@', 1)), '');
  v_base := public.personal_room_slug_base(coalesce(
    nullif(v_profile.username, ''),
    v_display,
    split_part(coalesce(v_profile.email, ''), '@', 1)
  ));
  IF char_length(v_base) < 3 OR public.personal_room_slug_reserved(v_base) THEN
    v_base := btrim(left(coalesce(nullif(v_base, ''), 'room') || '-room', 32), '-');
  END IF;

  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.personal_rooms WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.personal_rooms (owner_id, slug, name, is_default)
  VALUES (p_user, v_slug, left(coalesce(v_display, 'My') || '''s room', 80), TRUE)
  RETURNING id INTO v_room;
  RETURN v_room;
END; $$;

REVOKE ALL ON FUNCTION public.ensure_default_personal_room(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_personal_room(uuid) TO service_role;

-- New users: a default room as soon as their profile exists.
CREATE OR REPLACE FUNCTION public.personal_rooms_on_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.ensure_default_personal_room(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A room is never worth failing a sign-up over; the API creates it lazily.
  RAISE WARNING 'personal room for % not created: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.personal_rooms_on_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS personal_rooms_default ON public.profiles;
CREATE TRIGGER personal_rooms_default AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.personal_rooms_on_profile();

-- Existing users.
SELECT public.ensure_default_personal_room(id) FROM public.profiles ORDER BY created_at;
