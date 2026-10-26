-- The shared @profullstack/profile fields on public.profiles.
--
-- public.profiles is readable only by its owner (RLS "Users can view own
-- profile", auth.uid() = id), so the six fields can live here.
--
-- Apply by hand against the dev2 self-hosted database
-- (`docker exec -i pairux-com-supabase-db psql -U postgres -d postgres -1 < this file`,
-- then `notify pgrst, 'reload schema'`). Additive only; nothing is renamed
-- or dropped. updated_at already exists.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists company_domain text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists linkedin_url text;

create index if not exists profiles_email_lower on public.profiles (lower(email));

-- One-time backfill, idempotent: the signup form has always asked for first
-- and last name and stored them in auth user metadata, so copy those (and the
-- account email) into empty columns. Never overwrites a value already present.
update public.profiles p
   set email      = coalesce(p.email, lower(u.email)),
       first_name = coalesce(p.first_name, nullif(btrim(u.raw_user_meta_data->>'first_name'), '')),
       last_name  = coalesce(p.last_name, nullif(btrim(u.raw_user_meta_data->>'last_name'), ''))
  from auth.users u
 where u.id = p.id
   and (p.email is null or p.first_name is null or p.last_name is null);
