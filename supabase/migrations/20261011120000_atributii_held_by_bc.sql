-- R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's
-- powers by default (Alex, after the BC meeting: "All of BC members should be
-- able to do all the specific actions ... this button should disappear and by
-- default they will be able to do anything"). Nobody holds an Atribuție: the
-- holder table, its commands and the Moderator's Administrare BC directory go.
-- The OSUBB Deals team stays -- a Coordonator (live BCE) and a Responsabil
-- (live activ) -- set by any BC member or the Moderator; the Coordonator still
-- sets the Responsabil. Existing team rows survive: only their foreign key to
-- the holder row is dropped.
-- Spec: docs/superpowers/specs/2026-10-11-bc-powers-task-copies-bars-design.md

-- ==================== 1. The holder commands go ====================

drop function public.set_bc_assignment(text, uuid, boolean, boolean);
drop function private.set_bc_assignment_impl(text, uuid, boolean, boolean);
drop function public.bc_assignments_directory();
drop function private.bc_assignments_directory_impl();

-- ==================== 2. The one authority definition ====================

create or replace function private.assignment_team_role(p_assignment text, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Live rows only: a Coordonator no longer bce, or anyone no longer activ,
  -- keeps the row but loses the power until someone changes the place.
  select case
    -- R47: every live BC member (level 6) and the Moderator (level 9) hold
    -- every Atribuție's powers. "holder" is the word the callers know;
    -- nobody holds anything any more. The one place that says so.
    when private.actor_level(p_member) >= 6
      then 'holder'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'coordinator')
         and private.actor_level(p_member) = 5
      then 'coordinator'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'responsible')
         and private.actor_level(p_member) is not null
      then 'responsible'
  end;
$$;

comment on function private.assignment_team_role(text, uuid) is
  'R44/R47: the Member''s live powers in an Atribuție -- holder (any live BC member, level 6, or the live Moderator, level 9: since R47 each of them holds every Atribuție''s powers by default, and nobody is a holder in R44''s sense), coordinator (the team''s Coordonator and live bce, level 5), responsible (the team''s Responsabil and live activ) -- or null. The one definition every capability, policy and command reads. Granted to nobody: definer code calls it; policies call private.deals_team_role().';

comment on function private.deals_team_role() is
  'R44/R45/R47: the caller''s live powers in the OSUBB Deals team (holder -- any BC member or the Moderator --, coordinator, responsible) or null; null without organization claims. Policy predicate: authenticated may execute it.';

-- ==================== 3. set_assignment_team_member ====================

create or replace function private.set_assignment_team_member_impl(p_assignment text, p_team_role text, p_member_id uuid)
returns public.assignment_team
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_actor_role   text;
  v_old          uuid;
  v_other        uuid;
  v_target_level integer;
  v_row          public.assignment_team%rowtype;
  v_place        text;
begin
  -- 1. Malformed for every caller.
  if p_assignment is null or p_assignment not in ('osubb_deals') then
    raise sqlstate 'PT400' using message = 'invalid_assignment';
  end if;
  if p_team_role is null or p_team_role not in ('coordinator', 'responsible') then
    raise sqlstate 'PT400' using message = 'invalid_team_role';
  end if;
  v_place := case p_team_role when 'coordinator' then 'Coordonator' else 'Responsabil' end;

  -- 2. The actor, live, held for the transaction.
  v_actor := (select auth.uid());
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;
  perform 1 from public.profiles as actor
   where actor.id = v_actor and actor.status = 'activ'
   for share of actor;

  -- 3. R47: BC or the Moderator (role holder) set either place; the
  --    Coordonator the Responsabil only. One Atribuție's team changes one
  --    place at a time: a transaction advisory lock per Atribuție stands in
  --    for the parent row the team no longer has.
  perform pg_advisory_xact_lock(hashtext('osubb.assignment_team:' || p_assignment));
  v_actor_role := private.assignment_team_role(p_assignment, v_actor);
  if not coalesce(v_actor_role = 'holder'
                  or (v_actor_role = 'coordinator' and p_team_role = 'responsible'), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;

  -- 4. The place, locked.
  select team.member_id into v_old
    from public.assignment_team as team
   where team.assignment = p_assignment and team.team_role = p_team_role
   for no key update;
  select team.member_id into v_other
    from public.assignment_team as team
   where team.assignment = p_assignment and team.team_role <> p_team_role;

  if p_member_id is null then
    if v_old is null then
      return null;
    end if;
    delete from public.assignment_team
     where assignment = p_assignment and team_role = p_team_role;
    perform private.notify(array[v_old], 'system'::public.noti_kind,
      'Nu mai ești ' || v_place || ' OSUBB Deals', null, null, null, v_actor);
    return null;
  end if;

  -- 5. The person: a Coordonator is live bce, a Responsabil any live Member;
  --    never the other place's member.
  select role.level into v_target_level
    from public.profiles as target
    join public.roles as role on role.id = target.role
   where target.id = p_member_id
     and target.status = 'activ'
   for share of target;
  if p_team_role = 'coordinator' and coalesce(v_target_level, -1) <> 5 then
    raise sqlstate 'PT400' using message = 'coordinator_not_bce';
  end if;
  if p_team_role = 'responsible' and v_target_level is null then
    raise sqlstate 'PT400' using message = 'invalid_team_member';
  end if;
  if p_member_id is not distinct from v_other then
    raise sqlstate 'PT400' using message = 'assignment_team_duplicate';
  end if;
  if p_member_id is not distinct from v_old then
    select * into v_row from public.assignment_team
     where assignment = p_assignment and team_role = p_team_role;
    return v_row;
  end if;

  insert into public.assignment_team (assignment, team_role, member_id, set_by)
  values (p_assignment, p_team_role, p_member_id, v_actor)
  on conflict (assignment, team_role) do update
     set member_id = excluded.member_id, set_by = excluded.set_by, set_at = now()
  returning * into v_row;

  perform private.notify(array[p_member_id], 'system'::public.noti_kind,
    'Ești acum ' || v_place || ' OSUBB Deals', null, null, null, v_actor, '/administrare/deals');
  if v_old is not null then
    perform private.notify(array[v_old], 'system'::public.noti_kind,
      'Nu mai ești ' || v_place || ' OSUBB Deals', null, null, null, v_actor);
  end if;
  return v_row;
end;
$$;

comment on function private.set_assignment_team_member_impl(text, text, uuid) is
  'R47: body of public.set_assignment_team_member. Step 1: PT400 invalid_assignment, invalid_team_role. Then 42501 assignment_team_forbidden unless the live caller is BC or the Moderator (either place) or the Coordonator (the responsible place only), judged by private.assignment_team_role under a transaction advisory lock per Atribuție. The place is locked FOR NO KEY UPDATE (conventions: never FOR UPDATE). A null member clears it. Otherwise PT400 coordinator_not_bce (a Coordonator is live bce, level 5), invalid_team_member (a Responsabil is a live activ Member), assignment_team_duplicate (the member of the other place); the same member again changes nothing. Notifies the member set ("Ești acum Coordonator/Responsabil OSUBB Deals", link /administrare/deals) and the one replaced or cleared ("Nu mai ești ..."), kind system. Returns the row, or null when cleared.';

comment on function public.set_assignment_team_member(text, text, uuid) is
  'R47: BC, the Moderator or (the Responsabil only) the Coordonator fill or clear a place in an Atribuție''s team. Reasons: PT400 invalid_assignment / invalid_team_role / coordinator_not_bce / invalid_team_member / assignment_team_duplicate, 42501 assignment_team_forbidden.';

-- ==================== 4. The team table stands on its own ====================

alter table public.assignment_team
  drop constraint assignment_team_assignment_fkey;
alter table public.assignment_team
  add constraint assignment_team_assignment_ck check (assignment in ('osubb_deals'));

comment on table public.assignment_team is
  'R44/R47: an Atribuție''s team -- at most one Coordonator (a BCE member) and one Responsabil (any active Member), never one person twice. Set by BC or the Moderator (either place) or the Coordonator (the Responsabil) through public.set_assignment_team_member; nothing dissolves it. The known Atribuții are assignment_team_assignment_ck. Readable by every live Member: the OSUBB Deals page shows the team.';

drop table public.bc_assignments;

-- ==================== 5. my_capabilities without administer_bc ====================

drop function public.my_capabilities();
drop function private.my_capabilities_impl();

create function private.my_capabilities_impl()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean,
               manage_deals boolean, manage_deals_team boolean, pick_deals_coordinator boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- A FROM-less select: exactly one row whatever the caller. Without organization claims, or
  -- with a stale claim over an inactive Profile, the live level is null and every comparison
  -- below collapses to false.
  with actor as (
    select case when coalesce(public.auth_is_member(), false) then private.actor_level() end
             as level
  ),
  facts as (
    select actor.level,
           actor.level is not null and coalesce(private.holds_any_group_role(), false)
             as holds_role,
           actor.level is not null and coalesce(public.can_manage_tasks(), false)
             as manage_tasks,
           -- R44/R47: the caller's live powers in the OSUBB Deals team.
           case when actor.level is not null
                then private.assignment_team_role('osubb_deals', (select auth.uid())) end
             as deals_role
      from actor
  )
  select coalesce(facts.holds_role or facts.level >= 6, false),
         facts.manage_tasks,
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.holds_role or facts.level >= 6 or facts.deals_role is not null, false),
         facts.deals_role is not null,
         coalesce(facts.deals_role in ('holder', 'coordinator'), false),
         coalesce(facts.deals_role = 'holder', false)
    from facts;
$$;

comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6 or manage_deals (R44: the Deals team reaches Administrare); manage_deals = any Deals power (BC, the Moderator, the Coordonator or the Responsabil, private.assignment_team_role); manage_deals_team = BC, the Moderator or the Coordonator; pick_deals_coordinator = BC or the Moderator. R47 dropped administer_bc: there is no Administrare BC.';

create function public.my_capabilities()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean,
               manage_deals boolean, manage_deals_team boolean, pick_deals_coordinator boolean)
language sql
stable
set search_path = ''
as $$
  select * from private.my_capabilities_impl();
$$;

comment on function public.my_capabilities() is
  'Read-only: the live caller''s capability row for the frontend (ADR-0009 Decision 6, #576; R44 added manage_deals, manage_deals_team, pick_deals_coordinator; R47 dropped administer_bc). Cosmetic for the client -- every command and policy still decides on its own. Exactly one row, all false without organization claims or an activ Profile.';

revoke execute on function private.my_capabilities_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.my_capabilities()
  from public, anon, authenticated, service_role;
grant execute on function private.my_capabilities_impl() to authenticated;
grant execute on function public.my_capabilities() to authenticated;
