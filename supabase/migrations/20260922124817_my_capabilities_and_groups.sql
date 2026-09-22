-- #576 (ADR-0009 Wave 3, Decision 6 and ruling R14): capabilities become one server read
-- computed from live rank and live Group Roles, and the caller's effective Groups become a
-- second one. The frontend level map in app/src/lib/capabilities.ts retires in favour of
-- public.my_capabilities(); client guards stay cosmetic and RLS stays the only authority.
--
-- Three private functions and two public wrappers, nothing else: no policy, no Group command,
-- no Administrare screen (#582-#584, #588, #589).

-- ==================== 1 · holds_any_group_role ====================
create function private.holds_any_group_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- A live active caller with a manager or responsible roster row on any Group. The same
  -- test create_event_impl and update_event_impl run inline for the Organization Group (#370,
  -- #248); T8 (#581) reuses this one for the Organization-Group compose arm.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.group_members as gm
        where gm.member_id = (select auth.uid())
          and gm.group_role in ('manager', 'responsible'));
$$;

-- ==================== 2 · my_capabilities ====================
create function private.my_capabilities_impl()
returns table (
  manages_any_group       boolean,
  manage_tasks            boolean,
  see_directory           boolean,
  see_leadership          boolean,
  manage_roles            boolean,
  provision_members       boolean,
  create_top_level_groups boolean,
  administer              boolean
)
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
             as manage_tasks
      from actor
  )
  select coalesce(facts.holds_role or facts.level >= 6, false),
         facts.manage_tasks,
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.holds_role or facts.level >= 6, false)
    from facts;
$$;

create function public.my_capabilities()
returns table (
  manages_any_group       boolean,
  manage_tasks            boolean,
  see_directory           boolean,
  see_leadership          boolean,
  manage_roles            boolean,
  provision_members       boolean,
  create_top_level_groups boolean,
  administer              boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_capabilities_impl();
$$;

-- ==================== 3 · my_groups ====================
create function private.my_groups_impl()
returns table (group_id bigint, group_role text, explicit boolean, automatic boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- Every Group where the live caller's effective Group Role is non-null: an explicit roster
  -- row, Automatic Membership, or a Manager/Responsible position inherited from any ancestor.
  -- Only the caller's own relationships leave this function, as ids; names and settings are
  -- read by the public wrapper under groups_read.
  select grp.id,
         held.group_role,
         exists (select 1
                   from public.group_members as gm
                  where gm.group_id = grp.id
                    and gm.member_id = (select auth.uid())),
         grp.automatic_membership and private.actor_level() >= grp.min_level
    from public.groups as grp
    cross join lateral (
      select private.group_role_of(grp.id, (select auth.uid())) as group_role
    ) as held
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and held.group_role is not null;
$$;

create function public.my_groups()
returns table (
  id              bigint,
  name            text,
  short           text,
  category        text,
  color           text,
  path            bigint[],
  min_level       integer,
  status          text,
  is_organization boolean,
  group_role      text,
  explicit        boolean,
  automatic       boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- security invoker: the join reads public.groups under the caller's own groups_read policy,
  -- so a Group the caller may not read is never offered, whatever role they hold on it.
  select grp.id, grp.name, grp.short, grp.category, grp.color, grp.path, grp.min_level,
         grp.status, grp.is_organization, mine.group_role, mine.explicit, mine.automatic
    from private.my_groups_impl() as mine
    join public.groups as grp on grp.id = mine.group_id
   order by grp.path, grp.id;
$$;

-- ==================== 4 · comments ====================
comment on function private.holds_any_group_role() is
  'Whether the live active caller (organization claims and an activ Profile) holds a Group Manager or Group Responsible roster row on any Group, archived ones included -- the same inline test create_event_impl applies to the Organization Group. Policy helper, granted to authenticated (#576); T8 (#581) uses it as the Organization-Group arm of the compose gate.';
comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6.';
comment on function public.my_capabilities() is
  'Read-only: the live caller''s capability row for the frontend (ADR-0009 Decision 6, #576). Cosmetic for the client -- every command and policy still decides on its own. Exactly one row, all false without organization claims or an activ Profile.';
comment on function private.my_groups_impl() is
  'The body of public.my_groups() (#576, ruling R14): (group_id, effective Group Role, explicit, automatic) for every Group where private.group_role_of is non-null for the live caller -- explicit roster rows, Automatic Membership, and every descendant of a Group the caller manages or is Responsible of. explicit = the caller has their own roster row on that Group; automatic = the caller is an Automatic Member of that Group itself. Ids only; no Group setting beyond what decides the role.';
comment on function public.my_groups() is
  'Read-only: the live caller''s Groups with their effective Group Role (#576, R14 as amended 2026-09-21), for the Request origin picker, the Task form''s Group picker and Administrare''s Grupurile mele. security invoker, so rows are filtered by the groups_read policy. explicit says the role comes from the caller''s own roster row; automatic says the caller is an Automatic Member of that Group. Membership questions use explicit or automatic (R31); manager-side controls use every row.';

-- ==================== 5 · grants ====================
revoke execute on function private.holds_any_group_role()
  from public, anon, authenticated, service_role;
revoke execute on function private.my_capabilities_impl()
  from public, anon, authenticated, service_role;
revoke execute on function private.my_groups_impl()
  from public, anon, authenticated, service_role;
grant execute on function private.holds_any_group_role() to authenticated;
grant execute on function private.my_capabilities_impl() to authenticated;
grant execute on function private.my_groups_impl() to authenticated;

revoke execute on function public.my_capabilities()
  from public, anon, authenticated, service_role;
revoke execute on function public.my_groups()
  from public, anon, authenticated, service_role;
grant execute on function public.my_capabilities() to authenticated;
grant execute on function public.my_groups() to authenticated;
