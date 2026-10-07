-- Ruling R44, amended 2026-10-08. Alex: "I, as a moderator should also be able to
-- select all members of the team". The Moderator (live level 9) may set both the
-- Coordonator and the Responsabil of any held Atribuție's team, from Administrare ›
-- OSUBB Deals, without being part of the team and without publishing Deals.
--
-- Two bodies rebuilt from 20261007190100_bc_assignments.sql, nothing else:
--   * private.set_assignment_team_member_impl -- a live Moderator may set either
--     place; every validation and notification is unchanged, and an Atribuție
--     nobody holds still has no team for anyone to pick.
--   * private.my_capabilities_impl -- manage_deals_team and pick_deals_coordinator
--     are also true for the live Moderator; manage_deals stays the team's alone
--     (the Moderator does not publish).
-- Grants are kept by create or replace.

-- ==================== set_assignment_team_member ====================

create or replace function private.set_assignment_team_member_impl(p_assignment text, p_team_role text, p_member_id uuid)
returns public.assignment_team
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_actor_role   text;
  v_actor_level  integer;
  v_holder       uuid;
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

  -- 2. The actor, live, held for the transaction; their live level decides
  --    whether they are the Moderator (R44 amended 2026-10-08).
  v_actor := (select auth.uid());
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;
  select role.level into v_actor_level
    from public.profiles as actor
    join public.roles as role on role.id = actor.role
   where actor.id = v_actor and actor.status = 'activ'
   for share of actor;

  -- 3. The Atribuție is the parent row: FOR NO KEY UPDATE (conventions section
  --    2), so the team rows' foreign keys never wait on it. Nobody holds it:
  --    nobody may pick its team, the Moderator included. Otherwise the live
  --    Moderator sets either place without being on the team.
  select held.member_id into v_holder
    from public.bc_assignments as held
   where held.assignment = p_assignment
   for no key update;
  v_actor_role := private.assignment_team_role(p_assignment, v_actor);
  if v_holder is null
     or not coalesce(v_actor_level >= 9
                     or v_actor_role = 'holder'
                     or (v_actor_role = 'coordinator' and p_team_role = 'responsible'), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;

  -- 4. The place, locked.
  select team.member_id into v_old
    from public.assignment_team as team
   where team.assignment = p_assignment and team.team_role = p_team_role
   for update;
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
  --    never the holder, never the other place's member.
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
  if p_member_id = v_holder or p_member_id is not distinct from v_other then
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
  'R44: body of public.set_assignment_team_member. Step 1: PT400 invalid_assignment, invalid_team_role. Then 42501 assignment_team_forbidden unless the live caller is the Moderator (live level 9, either place, R44 amended 2026-10-08), the holder (either place) or the Coordonator (the responsible place only), judged by private.assignment_team_role under the Atribuție row FOR NO KEY UPDATE; nobody holds it -- nobody may pick. The place is locked FOR UPDATE. A null member clears it. Otherwise PT400 coordinator_not_bce (a Coordonator is live bce, level 5), invalid_team_member (a Responsabil is a live activ Member), assignment_team_duplicate (the holder, or the member of the other place); the same member again changes nothing. Notifies the member set ("Ești acum Coordonator/Responsabil OSUBB Deals", link /administrare/deals) and the one replaced or cleared ("Nu mai ești ..."), kind system. Returns the row, or null when cleared.';

comment on function public.set_assignment_team_member(text, text, uuid) is
  'R44: the holder of an Atribuție picks its Coordonator (p_team_role coordinator, a BCE member) and its Responsabil (responsible, any active Member); the Coordonator picks only the Responsabil; the Moderator picks either (R44 amended 2026-10-08), without being on the team. p_member_id null clears the place. Reasons: PT400 invalid_assignment / invalid_team_role / coordinator_not_bce / invalid_team_member / assignment_team_duplicate, 42501 assignment_team_forbidden.';

-- ==================== my_capabilities ====================

create or replace function private.my_capabilities_impl()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean, administer_bc boolean,
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
           -- R44: the caller's live place in the OSUBB Deals team.
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
         coalesce(facts.level >= 9, false),
         facts.deals_role is not null,
         -- R44 amended 2026-10-08: the Moderator sets both places too, but
         -- does not publish (manage_deals above stays the team's).
         coalesce(facts.deals_role in ('holder', 'coordinator') or facts.level >= 9, false),
         coalesce(facts.deals_role = 'holder' or facts.level >= 9, false)
    from facts;
$$;

comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6 or manage_deals (R44: the Deals team reaches Administrare); administer_bc = level >= 9 (the Moderator, R44); manage_deals = a place in the OSUBB Deals team (holder, Coordonator or Responsabil, private.assignment_team_role); manage_deals_team = holder, Coordonator or the Moderator (level >= 9, R44 amended 2026-10-08); pick_deals_coordinator = holder or the Moderator. The Moderator does not get manage_deals: they set the team but do not publish.';
