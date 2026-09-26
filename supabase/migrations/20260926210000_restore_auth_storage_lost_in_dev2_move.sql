-- Restore the trigger on auth.users that the 2026-09-25 move to the
-- self-hosted Supabase stack on dev2 left behind.
--
-- The move dumped DDL for the app schemas only, and pg_dump files a trigger
-- under its table's schema, so on_auth_user_created was dropped while
-- public.handle_new_user() survived. From the cutover on, no signup got a
-- row in public.profiles.
--
-- The migrations define no policies on storage.objects or storage.buckets
-- (the room-banners, recordings and call-analysis buckets are written by the
-- service role), so there is nothing to restore there.
--
-- Idempotent: safe to re-run.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill what handle_new_user would have written for the users created
-- while the trigger was missing. handle_new_user sets only id and
-- display_name (username is claimed later through set_username), so there is
-- no unique column to collide on.
INSERT INTO public.profiles (id, display_name)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
