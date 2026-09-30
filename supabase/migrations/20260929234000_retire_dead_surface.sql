-- #936: retire the backend surface nothing calls, and freeze an Announcement's Group and Audience.
--
-- Found by the backend-without-frontend audit of 2026-09-29. Every object below
-- was checked against app/src, supabase/functions, scripts, supabase/tests and
-- seed.sql before it was dropped. The callers left were test suites, two test
-- scripts (the Tracker smoke and the seed fingerprint), the seed-staging log,
-- the seed, and -- for the three columns in 4 -- the app, all updated in the same PR.
--
-- 1. update_task_content and convert_task_mode: superseded by the full-state
--    update_task / preview_task_update (ADR-0007 amended 2026-09-21). Their
--    helpers (log_task_activity, require_task_manager, task_field_labels, ...)
--    all have other callers and stay.
-- 2. The views leaderboard, member_points, dept_cup and tasks_with_overdue. The
--    app reads leadership_leaderboard, department_cup and tasks. leaderboard
--    still ranked BCE and BC, against the R11 amendment (#907). member_points
--    was one of the two owner-rights views; profiles_contact is now the only one.
-- 3. event_attendance: the direct write policies and the insert/update grants.
--    set_event_rsvp becomes the only write path, so it takes the command shape
--    (conventions section 2): an invoker wrapper over a security-definer _impl
--    that asks the Event visibility rule (private.can_read_event) itself instead
--    of reading through the caller's RLS. Same arguments, same return row, same
--    three refusals. The read policy is untouched (the RSVP read issue owns it).
-- 4. Columns (Alex, 2026-09-29):
--    * profiles.tier: never read, not a glossary term.
--    * profiles.joined_year: superseded by joined_at (#160), which every Member
--      now has (#933: set at provisioning, backfilled). Profil reads joined_at only.
--    profiles_directory is recreated without both, and the privileged-column
--    guard stops naming them.
--    * announcements.category and announcements.author: free text the compose
--      sheet never set. The author is created_by, shown as a Member Card (R15);
--      the authorship trigger stops keeping the byline.
-- 5. An Announcement never moves between Groups and never changes Audience
--    (CodeRabbit on PR #938): the edit form never sends either, and now a
--    signed-in update that tries is refused 23514. Writes without auth.uid()
--    (migrations, seed, jobs) pass, as for the other announcement guards.

-- ==================== 1. retired Task commands ====================
drop function public.update_task_content(bigint, text, text, timestamptz, bigint);
drop function private.update_task_content_impl(bigint, text, text, timestamptz, bigint);
drop function public.convert_task_mode(bigint, text, text);
drop function private.convert_task_mode_impl(bigint, text, text);

-- ==================== 2. unread views ====================
-- leaderboard reads member_points, so it goes first.
drop view public.leaderboard;
drop view public.member_points;
drop view public.dept_cup;
drop view public.tasks_with_overdue;

-- ==================== 3. RSVP writes only through set_event_rsvp ====================
drop policy event_attendance_create_self on public.event_attendance;
drop policy event_attendance_update_self on public.event_attendance;
-- A table-level revoke also removes the column grants of 20260829140318.
revoke insert, update, delete on table public.event_attendance from anon, authenticated;

create function private.set_event_rsvp_impl(p_event_id bigint, p_status text)
returns public.event_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_rsvp public.event_attendance%rowtype;
begin
  -- 1. Gate. The order of the three refusals is the one the invoker version had:
  --    a caller who is not a live Member hears 42501 before any input verdict.
  v_actor := private.require_active_member();
  -- Hold the live Profile, so a concurrent deactivation serializes behind the answer.
  perform 1 from public.profiles as profile
    where profile.id = v_actor and profile.status = 'activ'
    for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'not_active_member';
  end if;

  if p_status is null or p_status not in ('going', 'declined') then
    raise sqlstate 'PT400' using message = 'invalid_rsvp_status';
  end if;

  -- 2. Visibility: the one Event rule (events_read asks the same question), so a
  --    hidden Event and a missing one share one error.
  perform 1 from public.events as event
    where event.id = p_event_id
      and private.can_read_event(event.group_id, event.min_level, v_actor)
    for key share of event;
  if not found then
    raise sqlstate 'PT404' using message = 'event_not_visible';
  end if;

  -- 3. One atomic insert-or-update on (event_id, member_id). Only status changes;
  --    checked_in stays server-owned.
  insert into public.event_attendance as attendance (event_id, member_id, status)
  values (p_event_id, v_actor, p_status)
  on conflict (event_id, member_id)
  do update set status = excluded.status
  returning attendance.* into v_rsvp;

  return v_rsvp;
end;
$$;

comment on function private.set_event_rsvp_impl(bigint, text) is
  '#936: body behind public.set_event_rsvp -- the only write path into public.event_attendance for a client. 42501 not_active_member, then PT400 invalid_rsvp_status, then PT404 event_not_visible (private.can_read_event, hidden = missing); upserts auth.uid()''s answer and never touches checked_in.';

create or replace function public.set_event_rsvp(p_event_id bigint, p_status text)
returns public.event_attendance
language sql
security invoker
set search_path = ''
as $$
  select private.set_event_rsvp_impl(p_event_id, p_status);
$$;

comment on function public.set_event_rsvp(bigint, text) is
  'Atomically creates or changes auth.uid()''s RSVP for one visible event. Invoker wrapper over private.set_event_rsvp_impl (#936).';

revoke execute on function private.set_event_rsvp_impl(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function private.set_event_rsvp_impl(bigint, text) to authenticated;
revoke execute on function public.set_event_rsvp(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_event_rsvp(bigint, text) to authenticated;

-- ==================== 4. retired columns ====================
-- profiles_directory enumerates tier and joined_year, so it is dropped and
-- recreated around the column drops (the same columns, minus those two).
drop view public.profiles_directory;

-- Rebuilt from 20260927180000_live_level_gates.sql, the latest body, minus tier and joined_year.
create or replace function public.guard_profile_privileged_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.full_name       is not distinct from old.full_name
     and new.role        is not distinct from old.role
     and new.status      is not distinct from old.status
     and new.email       is not distinct from old.email
     and new.joined_at   is not distinct from old.joined_at then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon')
     or (select private.caller_level()) >= 6 then
    return new;
  end if;
  raise exception
    'Only BC (level >= 6) may change full_name, role, status, email or joined_at on a profile'
    using errcode = '42501';
end;
$$;

alter table public.profiles drop column tier, drop column joined_year;

create view public.profiles_directory with (security_invoker = on) as
  select profiles.id,
         profiles.full_name,
         profiles.role,
         profiles.status,
         profiles.avatar_color,
         profiles.created_at,
         profiles.joined_at,
         profiles.nickname
    from public.profiles;
revoke all on public.profiles_directory from public, anon, authenticated, service_role;
grant select on public.profiles_directory to authenticated, service_role;

-- Rebuilt from 20260927160000_announcement_authorship.sql, the latest body,
-- minus the author byline it used to clear and keep.
create or replace function private.stamp_announcement_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := v_actor;
    new.published_at := now();
  else
    new.created_by := old.created_by;
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;
comment on function private.stamp_announcement_authorship() is
  'Security pass 2026-09-27 (M1): announcements_stamp_authorship -- for a signed-in caller an insert stores created_by = auth.uid() and published_at = now(), and an update keeps both unchanged. Writes without auth.uid() (migrations, seed, jobs) pass through. #936 dropped the free-text author byline.';

alter table public.announcements drop column author, drop column category;

-- ==================== 5. an Announcement keeps its Group and Audience ====================
create function private.guard_announcement_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.group_id is distinct from old.group_id then
    raise exception using errcode = '23514', message = 'announcement_group_immutable';
  end if;
  if new.audience is distinct from old.audience then
    raise exception using errcode = '23514', message = 'announcement_audience_immutable';
  end if;
  return new;
end;
$$;

comment on function private.guard_announcement_origin() is
  '#936: announcements_guard_origin -- a signed-in update may not move an Announcement to another Group (23514 announcement_group_immutable) or change its Audience (23514 announcement_audience_immutable). Writes without auth.uid() (migrations, seed, jobs) pass.';

revoke execute on function private.guard_announcement_origin()
  from public, anon, authenticated, service_role;

-- No column list (`update of group_id, audience`): a column list would pin both
-- columns, and the #581 replay harness drops and re-adds them.
create trigger announcements_guard_origin
  before update on public.announcements
  for each row execute function private.guard_announcement_origin();
