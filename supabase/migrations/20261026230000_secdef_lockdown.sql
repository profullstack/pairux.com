-- Lock down SECURITY DEFINER functions and privileged columns (2026-10-26 audit).
--
-- Supabase grants EXECUTE to PUBLIC on every new function, so each SECURITY
-- DEFINER function in public was callable with the anon key. This migration:
--   1. revokes the internal ones (cron, triggers, service-role routes) from
--      PUBLIC/anon/authenticated;
--   2. adds a host check to start_media_session (any signed-in user could make
--      themselves current host of any room);
--   3. stops new functions from being executable by PUBLIC/anon/authenticated
--      by default: a NEW function the browser calls (or an RLS policy uses)
--      now needs an explicit GRANT EXECUTE ... TO anon, authenticated;
--   4. pins privileged columns that "update own row" policies let users write:
--      session_participants (role, kind, agent owner, backup host, un-leave),
--      sessions (channel/org/team, creator, notify/recording stamps), profiles
--      (email, created_at); and drops the direct INSERT policy on
--      session_participants (joins go through join_session, which enforces
--      the plan's seat caps).

-- 1. Internal functions: server (service role), cron or triggers only.
revoke execute on function public.auto_promote_backup_host(uuid) from public, anon, authenticated;
revoke execute on function public.bump_autoblog_integration(uuid) from public, anon, authenticated;
revoke execute on function public.claim_call_analysis() from public, anon, authenticated;
revoke execute on function public.cleanup_expired_rooms() from public, anon, authenticated;
revoke execute on function public.mark_stale_participants() from public, anon, authenticated;
revoke execute on function public.prune_meeting_reminders() from public, anon, authenticated;
revoke execute on function public.get_user_monthly_usage(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.join_session_as_agent(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.send_system_message(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.user_effective_plan(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.auto_promote_backup_host(uuid) to service_role;
grant execute on function public.bump_autoblog_integration(uuid) to service_role;
grant execute on function public.claim_call_analysis() to service_role;
grant execute on function public.cleanup_expired_rooms() to service_role;
grant execute on function public.mark_stale_participants() to service_role;
grant execute on function public.prune_meeting_reminders() to service_role;
grant execute on function public.get_user_monthly_usage(uuid, integer, integer) to service_role;
grant execute on function public.join_session_as_agent(text, text, text, uuid) to service_role;
grant execute on function public.send_system_message(uuid, text, text) to service_role;
grant execute on function public.user_effective_plan(uuid) to service_role;

-- 2. start_media_session: only the room's host may publish and take current host.
create or replace function public.start_media_session(
  p_room_id uuid,
  p_mode session_mode default 'p2p'::session_mode,
  p_capture_source jsonb default null::jsonb,
  p_sfu_endpoint text default null::text,
  p_sfu_room_id text default null::text
)
returns media_sessions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.sessions;
  v_media_session public.media_sessions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_session
  from public.sessions
  where id = p_room_id and status != 'ended';

  if v_session is null then
    raise exception 'Room not found or has ended';
  end if;

  if not (
    auth.uid() in (v_session.creator_id, v_session.host_user_id, v_session.current_host_id)
    or exists (
      select 1 from public.session_participants sp
      where sp.session_id = p_room_id and sp.user_id = auth.uid()
        and sp.role = 'host' and sp.left_at is null
    )
  ) then
    raise exception 'Only the host can start sharing in this room';
  end if;

  update public.media_sessions
  set status = 'ended', ended_at = now()
  where room_id = p_room_id
    and publisher_id = auth.uid()
    and status = 'active';

  insert into public.media_sessions (room_id, publisher_id, mode, capture_source, sfu_endpoint, sfu_room_id)
  values (p_room_id, auth.uid(), p_mode, p_capture_source, p_sfu_endpoint, p_sfu_room_id)
  returning * into v_media_session;

  update public.sessions
  set current_host_id = auth.uid(), host_last_seen_at = now(), status = 'active', mode = p_mode
  where id = p_room_id;

  return v_media_session;
end;
$function$;

-- The 3-argument overload delegates so both carry the same check.
create or replace function public.start_media_session(
  p_room_id uuid,
  p_mode session_mode default 'p2p'::session_mode,
  p_capture_source jsonb default null::jsonb
)
returns media_sessions
language sql
security invoker
set search_path to 'public'
as $function$
  select public.start_media_session(p_room_id, p_mode, p_capture_source, null::text, null::text);
$function$;

-- 3. New functions are not executable by PUBLIC/anon/authenticated by default.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- 4a. session_participants: no direct inserts (join_session enforces seat caps).
drop policy if exists "Users can join sessions" on public.session_participants;

create or replace function public.session_participants_protect()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.session_id := old.session_id;
  new.user_id := old.user_id;
  new.kind := old.kind;
  new.agent_owner_id := old.agent_owner_id;
  new.agent_client := old.agent_client;
  new.joined_at := old.joined_at;
  if old.left_at is not null then
    new.left_at := old.left_at;
  end if;
  if not exists (
    select 1 from public.sessions s
    where s.id = old.session_id
      and auth.uid() in (s.host_user_id, s.current_host_id, s.creator_id)
  ) then
    new.role := old.role;
    new.is_backup_host := old.is_backup_host;
  end if;
  return new;
end;
$function$;

drop trigger if exists session_participants_protect on public.session_participants;
create trigger session_participants_protect
  before update on public.session_participants
  for each row execute function public.session_participants_protect();

-- 4b. sessions: the host may edit their room, not re-home it or reset stamps.
create or replace function public.sessions_protect()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.creator_id := old.creator_id;
  new.created_at := old.created_at;
  new.channel_id := old.channel_id;
  new.org_id := old.org_id;
  new.team_id := old.team_id;
  new.live_notified_at := old.live_notified_at;
  new.recording_started_at := old.recording_started_at;
  new.restream_egress_id := old.restream_egress_id;
  return new;
end;
$function$;

drop trigger if exists sessions_protect on public.sessions;
create trigger sessions_protect
  before update on public.sessions
  for each row execute function public.sessions_protect();

-- 4c. profiles: plan columns are pinned by profiles_protect_plan; also pin
-- email (written by the service-role profile API) and created_at.
create or replace function public.profiles_protect_identity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
  before update on public.profiles
  for each row execute function public.profiles_protect_identity();

-- Trigger functions are never RPCs.
revoke execute on function public.session_participants_protect() from public, anon, authenticated;
revoke execute on function public.sessions_protect() from public, anon, authenticated;
revoke execute on function public.profiles_protect_identity() from public, anon, authenticated;

notify pgrst, 'reload schema';
