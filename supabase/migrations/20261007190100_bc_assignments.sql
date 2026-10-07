-- Ruling R44 (2026-10-07): Atribuții BC and Administrare BC. Alex: "i want to start
-- to give to each BC member some new features, but i don't want to give these
-- features by specific role ... a new page in administrare, called Administrare BC,
-- in which i add the new features to each individual person".
--
-- An Atribuție is a named responsibility the Moderator gives to exactly one BC
-- member, independent of Roles and Group positions. The first is Responsabil OSUBB
-- Deals (assignment 'osubb_deals'); its holder picks a Coordonator (a BCE member)
-- and a Responsabil (any active Member). The Coordonator can do everything the
-- holder can except pick the Coordonator; the Responsabil publishes Deals and
-- manages their own (the Deal rules live in the next migration). Taking the
-- Atribuție away dissolves the team and leaves the Deals in place.
--
-- Authority reads live rows, never the token: the holder acts while their live
-- rank is bc (level 6), the Coordonator while bce (level 5), the Responsabil while
-- activ -- private.assignment_team_role is the one definition.
--
-- Writes: public.set_bc_assignment (the Moderator) and
-- public.set_assignment_team_member (the holder; the Coordonator for the
-- Responsabil). Reads: both tables for every live Member, and
-- public.bc_assignments_directory() for the Moderator's Administrare BC page.
-- public.my_capabilities() gains administer_bc, manage_deals, manage_deals_team
-- and pick_deals_coordinator; administer is also true for the Deals team.

-- ==================== Tables ====================

create table public.bc_assignments (
  assignment text primary key
    constraint bc_assignments_assignment_ck check (assignment in ('osubb_deals')),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.bc_assignments is
  'R44: one row per held Atribuție -- exactly one holder, a BC member, given by the Moderator through public.set_bc_assignment. Readable by every live Member; no direct writes.';

create index bc_assignments_member_id_idx on public.bc_assignments (member_id);
create index bc_assignments_granted_by_idx on public.bc_assignments (granted_by);

alter table public.bc_assignments enable row level security;

create table public.assignment_team (
  assignment text not null references public.bc_assignments (assignment) on delete cascade,
  team_role  text not null
    constraint assignment_team_team_role_ck check (team_role in ('coordinator', 'responsible')),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  set_by     uuid references public.profiles (id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (assignment, team_role),
  constraint assignment_team_assignment_member_id_key unique (assignment, member_id)
);

comment on table public.assignment_team is
  'R44: the team an Atribuție''s holder picks -- at most one Coordonator (a BCE member) and one Responsabil (any active Member), never the holder and never one person twice. Written only by public.set_assignment_team_member; dissolved (cascade) when the Atribuție is taken away. Readable by every live Member: the OSUBB Deals page shows the team.';

create index assignment_team_member_id_idx on public.assignment_team (member_id);
create index assignment_team_set_by_idx on public.assignment_team (set_by);

alter table public.assignment_team enable row level security;

revoke all on table public.bc_assignments from public, anon, authenticated, service_role;
revoke all on table public.assignment_team from public, anon, authenticated, service_role;
grant select on table public.bc_assignments to authenticated, service_role;
grant select on table public.assignment_team to authenticated, service_role;

create policy bc_assignments_read on public.bc_assignments
  for select to authenticated
  using (public.auth_is_member() and (select private.caller_level()) >= 0);

create policy assignment_team_read on public.assignment_team
  for select to authenticated
  using (public.auth_is_member() and (select private.caller_level()) >= 0);

create trigger broadcast_change
  after insert or update or delete on public.bc_assignments
  for each statement execute function private.broadcast_change();
create trigger broadcast_change
  after insert or update or delete on public.assignment_team
  for each statement execute function private.broadcast_change();

-- ==================== The one authority definition ====================

create function private.assignment_team_role(p_assignment text, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Live rows only: a holder demoted below bc, a Coordonator no longer bce, or
  -- anyone no longer activ keeps the row but loses the power until the
  -- Moderator or the holder changes it.
  select case
    when exists (select 1 from public.bc_assignments as held
                  where held.assignment = p_assignment and held.member_id = p_member)
         and private.actor_level(p_member) = 6
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
  'R44: the Member''s live place in an Atribuție''s team -- holder (holds it and is live bc, level 6), coordinator (the team''s Coordonator and live bce, level 5), responsible (the team''s Responsabil and live activ) -- or null. The one definition every capability, policy and command reads. Granted to nobody: definer code calls it; policies call private.deals_team_role().';

revoke execute on function private.assignment_team_role(text, uuid)
  from public, anon, authenticated, service_role;

create function private.deals_team_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(public.auth_is_member(), false)
              then private.assignment_team_role('osubb_deals', (select auth.uid())) end;
$$;

comment on function private.deals_team_role() is
  'R44/R45: the caller''s live place in the OSUBB Deals team (holder, coordinator, responsible) or null; null without organization claims. Policy predicate: authenticated may execute it.';

revoke execute on function private.deals_team_role()
  from public, anon, authenticated, service_role;
grant execute on function private.deals_team_role() to authenticated;

create function private.assignment_label(p_assignment text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_assignment when 'osubb_deals' then 'Responsabil OSUBB Deals' end;
$$;

comment on function private.assignment_label(text) is
  'R44: the Romanian name of an Atribuție, for Notification titles. Granted to nobody.';

revoke execute on function private.assignment_label(text)
  from public, anon, authenticated, service_role;

-- ==================== set_bc_assignment ====================

create function private.set_bc_assignment_impl(p_assignment text, p_member_id uuid, p_granted boolean, p_move boolean)
returns public.bc_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_actor_level  integer;
  v_target_level integer;
  v_row          public.bc_assignments%rowtype;
  v_old_holder   uuid;
  v_team         uuid[];
  v_label        text;
begin
  -- 1. Malformed for every caller.
  if p_assignment is null or p_assignment not in ('osubb_deals') then
    raise sqlstate 'PT400' using message = 'invalid_assignment';
  end if;
  if p_member_id is null then
    raise sqlstate 'PT400' using message = 'bc_assignment_not_bc';
  end if;
  if p_granted is null then
    raise sqlstate 'PT400' using message = 'granted_required';
  end if;
  v_label := private.assignment_label(p_assignment);

  -- 2. Authority: the Moderator, live, held for the transaction.
  v_actor := (select auth.uid());
  if v_actor is not null and coalesce(public.auth_is_member(), false) then
    select role.level into v_actor_level
      from public.profiles as actor
      join public.roles as role on role.id = actor.role
     where actor.id = v_actor
       and actor.status = 'activ'
     for share of actor;
  end if;
  if coalesce(v_actor_level, -1) < 9 then
    raise exception using errcode = '42501', message = 'bc_assignment_forbidden';
  end if;

  -- 3. One writer per Atribuție: the row may not exist yet, so a row lock alone
  --    cannot serialize two first grants.
  perform pg_advisory_xact_lock(hashtextextended('osubb.bc_assignment:' || p_assignment, 0));
  -- The parent of assignment_team: FOR NO KEY UPDATE (conventions section 2);
  -- a delete below takes the stronger lock itself.
  select * into v_row from public.bc_assignments
   where assignment = p_assignment
   for no key update;

  if p_granted then
    -- 4. Only a live BC member may hold an Atribuție.
    select role.level into v_target_level
      from public.profiles as target
      join public.roles as role on role.id = target.role
     where target.id = p_member_id
       and target.status = 'activ'
     for share of target;
    if coalesce(v_target_level, -1) <> 6 then
      raise sqlstate 'PT400' using message = 'bc_assignment_not_bc';
    end if;
    if v_row.assignment is not null and v_row.member_id = p_member_id then
      return v_row;
    end if;
    if v_row.assignment is not null and not coalesce(p_move, false) then
      raise sqlstate 'PT409' using message = 'bc_assignment_held',
        detail = format('held by %s', v_row.member_id);
    end if;

    if v_row.assignment is not null then
      -- A move keeps the team; the team never holds the holder, so a new holder
      -- who was its Responsabil leaves that place.
      v_old_holder := v_row.member_id;
      delete from public.assignment_team
       where assignment = p_assignment and member_id = p_member_id;
      update public.bc_assignments
         set member_id = p_member_id, granted_by = v_actor, granted_at = now()
       where assignment = p_assignment
      returning * into v_row;
      perform private.notify(array[v_old_holder], 'system'::public.noti_kind,
        'Atribuția ' || v_label || ' a fost retrasă',
        'Atribuția a fost mutată la alt membru BC.',
        null, null, v_actor);
    else
      insert into public.bc_assignments (assignment, member_id, granted_by)
      values (p_assignment, p_member_id, v_actor)
      returning * into v_row;
    end if;
    perform private.notify(array[p_member_id], 'system'::public.noti_kind,
      'Ai primit atribuția ' || v_label,
      'Alege Coordonatorul și Responsabilul echipei în Administrare › OSUBB Deals.',
      null, null, v_actor, '/administrare/deals');
    return v_row;
  end if;

  -- 5. Taking it away: only from its holder; anything else changes nothing.
  if v_row.assignment is null or v_row.member_id <> p_member_id then
    return null;
  end if;
  select coalesce(array_agg(team.member_id order by team.team_role), '{}'::uuid[])
    into v_team
    from public.assignment_team as team
   where team.assignment = p_assignment;
  -- The team rows go with it (on delete cascade); the Deals stay.
  delete from public.bc_assignments where assignment = p_assignment;
  perform private.notify(array[v_row.member_id] || v_team, 'system'::public.noti_kind,
    'Atribuția ' || v_label || ' a fost retrasă',
    'Echipa s-a dizolvat; deal-urile publicate rămân.',
    null, null, v_actor);
  return null;
end;
$$;

comment on function private.set_bc_assignment_impl(text, uuid, boolean, boolean) is
  'R44: body of public.set_bc_assignment. Step 1: PT400 invalid_assignment, bc_assignment_not_bc (no member), granted_required. Then 42501 bc_assignment_forbidden unless the caller is the live Moderator (level 9; profile held FOR SHARE). One writer per Atribuție (transaction advisory lock, then the row FOR NO KEY UPDATE). Granting: the target must be live bc (PT400 bc_assignment_not_bc); granting to the holder changes nothing; while another member holds it, PT409 bc_assignment_held unless p_move -- then the holder is replaced, the team kept (minus the new holder if they were its Responsabil), the old holder told "Atribuția Responsabil OSUBB Deals a fost retrasă". The new holder is told "Ai primit atribuția Responsabil OSUBB Deals" (link /administrare/deals). Taking it away from its holder deletes the row and, by cascade, the team, and tells the holder, the Coordonator and the Responsabil "Atribuția Responsabil OSUBB Deals a fost retrasă" (kind system, no link); from anyone else it changes nothing. Returns the row, or null when nothing is held.';

create function public.set_bc_assignment(p_assignment text, p_member_id uuid, p_granted boolean, p_move boolean default false)
returns public.bc_assignments
language sql
set search_path = ''
as $$
  select private.set_bc_assignment_impl(p_assignment, p_member_id, p_granted, p_move);
$$;

comment on function public.set_bc_assignment(text, uuid, boolean, boolean) is
  'R44: the Moderator gives (p_granted true) or takes away (false) an Atribuție of a BC member -- today only osubb_deals, Responsabil OSUBB Deals. One holder: granting while another BC member holds it is PT409 bc_assignment_held unless p_move, which moves it and keeps the team. Taking it away dissolves the team; the Deals stay. Reasons: PT400 invalid_assignment / bc_assignment_not_bc / granted_required, 42501 bc_assignment_forbidden, PT409 bc_assignment_held.';

-- ==================== set_assignment_team_member ====================

create function private.set_assignment_team_member_impl(p_assignment text, p_team_role text, p_member_id uuid)
returns public.assignment_team
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_actor_role   text;
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

  -- 2. The actor, live, held for the transaction.
  v_actor := (select auth.uid());
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;
  perform 1 from public.profiles as actor
   where actor.id = v_actor and actor.status = 'activ'
   for share of actor;

  -- 3. The Atribuție is the parent row: FOR NO KEY UPDATE (conventions section
  --    2), so the team rows' foreign keys never wait on it. Nobody holds it:
  --    nobody may pick its team.
  select held.member_id into v_holder
    from public.bc_assignments as held
   where held.assignment = p_assignment
   for no key update;
  v_actor_role := private.assignment_team_role(p_assignment, v_actor);
  if v_holder is null
     or not coalesce(v_actor_role = 'holder'
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
  'R44: body of public.set_assignment_team_member. Step 1: PT400 invalid_assignment, invalid_team_role. Then 42501 assignment_team_forbidden unless the live caller is the holder (either place) or the Coordonator (the responsible place only), judged by private.assignment_team_role under the Atribuție row FOR NO KEY UPDATE; nobody holds it -- nobody may pick. The place is locked FOR UPDATE. A null member clears it. Otherwise PT400 coordinator_not_bce (a Coordonator is live bce, level 5), invalid_team_member (a Responsabil is a live activ Member), assignment_team_duplicate (the holder, or the member of the other place); the same member again changes nothing. Notifies the member set ("Ești acum Coordonator/Responsabil OSUBB Deals", link /administrare/deals) and the one replaced or cleared ("Nu mai ești ..."), kind system. Returns the row, or null when cleared.';

create function public.set_assignment_team_member(p_assignment text, p_team_role text, p_member_id uuid)
returns public.assignment_team
language sql
set search_path = ''
as $$
  select private.set_assignment_team_member_impl(p_assignment, p_team_role, p_member_id);
$$;

comment on function public.set_assignment_team_member(text, text, uuid) is
  'R44: the holder of an Atribuție picks its Coordonator (p_team_role coordinator, a BCE member) and its Responsabil (responsible, any active Member); the Coordonator picks only the Responsabil. p_member_id null clears the place. Reasons: PT400 invalid_assignment / invalid_team_role / coordinator_not_bce / invalid_team_member / assignment_team_duplicate, 42501 assignment_team_forbidden.';

-- ==================== bc_assignments_directory ====================

create function private.bc_assignments_directory_impl()
returns table (member_id uuid, full_name text, nickname text, avatar_color text, board_title text,
               is_bc boolean, assignments jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.auth_is_member(), false) or private.caller_level() < 9 then
    raise exception using errcode = '42501', message = 'bc_assignment_forbidden';
  end if;
  return query
    select profile.id,
           profile.full_name,
           profile.nickname,
           profile.avatar_color,
           private.board_title(profile.id),
           private.actor_level(profile.id) is not distinct from 6,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'assignment', held.assignment,
                      'label', private.assignment_label(held.assignment),
                      'granted_at', held.granted_at,
                      'granted_by', held.granted_by,
                      'team', coalesce((
                        select jsonb_agg(jsonb_build_object(
                                 'team_role', team.team_role,
                                 'member_id', team.member_id,
                                 'full_name', mate.full_name,
                                 'nickname', mate.nickname,
                                 'set_at', team.set_at
                               ) order by team.team_role)
                          from public.assignment_team as team
                          join public.profiles as mate on mate.id = team.member_id
                         where team.assignment = held.assignment), '[]'::jsonb)
                    ) order by held.assignment)
               from public.bc_assignments as held
              where held.member_id = profile.id), '[]'::jsonb)
      from public.profiles as profile
     -- Every live BC member, and any holder who is no longer one, so a stale
     -- Atribuție can still be taken away.
     where private.actor_level(profile.id) = 6
        or exists (select 1 from public.bc_assignments as held where held.member_id = profile.id)
     order by profile.full_name, profile.id;
end;
$$;

comment on function private.bc_assignments_directory_impl() is
  'R44: body of public.bc_assignments_directory. 42501 bc_assignment_forbidden unless the caller is the live Moderator.';

create function public.bc_assignments_directory()
returns table (member_id uuid, full_name text, nickname text, avatar_color text, board_title text,
               is_bc boolean, assignments jsonb)
language sql
stable
set search_path = ''
as $$
  select * from private.bc_assignments_directory_impl();
$$;

comment on function public.bc_assignments_directory() is
  'R44: Administrare BC''s list, for the Moderator only (42501 bc_assignment_forbidden otherwise): every live BC member -- and any holder who no longer is one (is_bc false) -- with name, nickname, avatar colour and Board Title, and assignments: [{assignment, label, granted_at, granted_by, team: [{team_role, member_id, full_name, nickname, set_at}]}].';

-- ==================== my_capabilities ====================

drop function public.my_capabilities();
drop function private.my_capabilities_impl();

create function private.my_capabilities_impl()
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
         coalesce(facts.deals_role in ('holder', 'coordinator'), false),
         coalesce(facts.deals_role = 'holder', false)
    from facts;
$$;

comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6 or manage_deals (R44: the Deals team reaches Administrare); administer_bc = level >= 9 (the Moderator, R44); manage_deals = a place in the OSUBB Deals team (holder, Coordonator or Responsabil, private.assignment_team_role); manage_deals_team = holder or Coordonator; pick_deals_coordinator = holder.';

create function public.my_capabilities()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean, administer_bc boolean,
               manage_deals boolean, manage_deals_team boolean, pick_deals_coordinator boolean)
language sql
stable
set search_path = ''
as $$
  select * from private.my_capabilities_impl();
$$;

comment on function public.my_capabilities() is
  'Read-only: the live caller''s capability row for the frontend (ADR-0009 Decision 6, #576; R44 adds administer_bc, manage_deals, manage_deals_team, pick_deals_coordinator). Cosmetic for the client -- every command and policy still decides on its own. Exactly one row, all false without organization claims or an activ Profile.';

-- ==================== Grants ====================

revoke execute on function private.set_bc_assignment_impl(text, uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_bc_assignment(text, uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.set_assignment_team_member_impl(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_assignment_team_member(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.bc_assignments_directory_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.bc_assignments_directory()
  from public, anon, authenticated, service_role;
revoke execute on function private.my_capabilities_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.my_capabilities()
  from public, anon, authenticated, service_role;

grant execute on function private.set_bc_assignment_impl(text, uuid, boolean, boolean) to authenticated;
grant execute on function public.set_bc_assignment(text, uuid, boolean, boolean) to authenticated;
grant execute on function private.set_assignment_team_member_impl(text, text, uuid) to authenticated;
grant execute on function public.set_assignment_team_member(text, text, uuid) to authenticated;
grant execute on function private.bc_assignments_directory_impl() to authenticated;
grant execute on function public.bc_assignments_directory() to authenticated;
grant execute on function private.my_capabilities_impl() to authenticated;
grant execute on function public.my_capabilities() to authenticated;
