-- #933: every provisioned Member gets a join date, so tenure (Recrut ->
-- Voluntar through the daily osubb-apply-promotions job, and the Promotion
-- Candidate cohort of run_role_evaluation) counts for people invited through
-- the app. Until now public.provision_profile never wrote profiles.joined_at,
-- and a null joined_at holds no tenure (private.detect_promotions,
-- private.role_evaluation_rows), so an invited Recrut stayed a Recrut forever.
--
-- Alex, 2026-09-29: set it automatically at provisioning; existing Members
-- without one get their account's creation date; BC edits historical dates
-- (#932).
--
-- 1. public.provision_profile gains a trailing p_joined_at date default null.
--    A new parameter changes the signature, so the six-argument function is
--    dropped and the seven-argument one created, with the same grants. The
--    body is rebuilt from main's latest definition
--    (20260929190000_bc_provision_status.sql); only the profiles insert and
--    the comment change. joined_at = p_joined_at when given (the production
--    bootstrap's members.csv carries historical join dates), otherwise the
--    provisioning day on the Europe/Bucharest calendar -- the calendar every
--    tenure check measures on. Every caller passes arguments by name
--    (invite-member and csv-import through supabase-js rpc, the bootstrap
--    script through PostgREST), so the new trailing default breaks none.
-- 2. Backfill: every profile whose joined_at is null gets the
--    Europe/Bucharest calendar date of public.profiles.created_at -- the
--    moment the Member's Profile was provisioned, i.e. when they joined the
--    organization in the app. Not auth.users.created_at: an Auth user can
--    exist before its Profile (a bootstrap run resumed later, an invitation
--    whose provisioning was retried), and the Profile is the one row every
--    path creates at exactly the moment of joining, the same moment step 1
--    now stamps. Rows that already carry a date (the #160 backfill from
--    joined_year, or a BC edit) are untouched.
--
-- Written to replay: supabase/tests/provision_joined_at_upgrade.test.sh runs
-- this file again inside a rolled-back transaction to prove the backfill.

-- ---------------------------------------------------------------------------
-- 1. Provisioning stamps the join date
-- ---------------------------------------------------------------------------
drop function if exists public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid);

create or replace function public.provision_profile(
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_role         public.member_role default 'recrut'::public.member_role,
  p_group_ids    bigint[] default '{}'::bigint[],
  p_appointed_by uuid default null::uuid,
  p_joined_at    date default null::date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_group_id  bigint;
  v_reason    text;
begin
  -- The rank ceiling (H1, widened by #917). A leadership account is created
  -- by leadership -- a live active BC or Moderator, the actor set_member_role
  -- accepts -- and answered before anything is written.
  if p_role in ('bc', 'moderator') then
    if p_appointed_by is null then
      -- The bootstrap path: the first Moderator, appointed by nobody. Once an
      -- `activ` Moderator exists, a null appointer creates no leadership.
      -- Two concurrent bootstrap calls would both see "no Moderator yet", so
      -- the `moderator` Role row is locked first: the second call waits, and
      -- its check below (a new snapshot under read committed) sees the
      -- first's committed row. `for no key update`, the house mode for a row
      -- other tables reference, so a key-share lock on it is never blocked.
      if p_role = 'moderator' then
        perform 1
           from public.roles as role
          where role.id = 'moderator'
            for no key update;
      end if;
      if p_role <> 'moderator'
         or exists (select 1
                      from public.profiles as holder
                     where holder.role = 'moderator'
                       and holder.status = 'activ') then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    else
      -- #917: the appointer is a live active BC or Moderator, read under a
      -- share lock so a concurrent demotion or deactivation of them waits.
      perform 1
         from public.profiles as appointer
         join public.roles as role on role.id = appointer.role
        where appointer.id = p_appointed_by
          and appointer.status = 'activ'
          and role.level >= 6
          for share of appointer;
      if not found then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    end if;
  end if;

  -- #933: the join date tenure counts from -- the given one, or the
  -- provisioning day on the Europe/Bucharest calendar.
  insert into public.profiles (id, full_name, email, role, joined_at)
  values (p_user_id, p_full_name, lower(trim(p_email)), p_role,
          coalesce(p_joined_at, (now() at time zone 'Europe/Bucharest')::date));

  -- Shape 4: ascending id, duplicates collapsed.
  begin
    for v_group_id in
      select distinct g
        from unnest(coalesce(p_group_ids, '{}'::bigint[])) as g
       order by 1
    loop
      -- Shape 1 and 2: the one insert path, with the inviting BC as the actor.
      perform private.appoint_group_member(v_group_id, p_user_id, p_appointed_by);
    end loop;
  exception
    -- Shape 3: keep the core's reason, normalise the class. Anything else --
    -- a 23505 on the profiles row, say, which invite-member reads to tell a
    -- race from a typo -- passes through untouched, because it is raised
    -- outside this block.
    when insufficient_privilege or sqlstate 'PT400' or sqlstate 'PT409' then
      get stacked diagnostics v_reason = message_text;
      raise sqlstate 'PT400' using message = v_reason;
  end;

  return p_user_id;
end;
$function$;

revoke execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid, date)
  to service_role;

comment on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid, date) is 'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. The profile''s joined_at (#933) is p_joined_at when given, otherwise the provisioning day on the Europe/Bucharest calendar, so tenure (Recrut -> Voluntar, the Promotion Candidate cohort) counts from the day the Member joined. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Rank ceiling (security pass 2026-09-27, H1; widened by ruling R31, #917): a bc or moderator profile is provisioned only when p_appointed_by is a live activ BC or Moderator (level 6 and up, read FOR SHARE) -- the actor set_member_role accepts -- or, for the bootstrap, when p_appointed_by is null, the role is moderator and no activ Moderator exists yet; anything else is 42501 member_manage_forbidden before anything is written. Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows and the production bootstrap.';

-- ---------------------------------------------------------------------------
-- 2. Backfill: a missing join date is the Profile's creation day
-- ---------------------------------------------------------------------------
update public.profiles as profile
   set joined_at = (profile.created_at at time zone 'Europe/Bucharest')::date
 where profile.joined_at is null;

comment on column public.profiles.joined_at is
  'Exact join date; tenure (Recrut -> Voluntar, the Promotion Candidate cohort) counts from it. provision_profile stamps it (#933): the given date, otherwise the provisioning day on the Europe/Bucharest calendar. #160 backfilled known members as January 1 of joined_year; #933 backfilled the rest from the Europe/Bucharest date of profiles.created_at. BC edits historical dates (#932). Null only for a profile inserted outside provision_profile without one.';
