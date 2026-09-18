-- #507: Groups (ADR-0009 Wave 1): groups and group_members as read-only shadow tables with
-- ancestor paths, Group Roles and the settings ADR-0009 names. Legacy tables stay the
-- write master; #508 backfills, #509 mirrors. Clients read, never write.

create table public.groups (
  id                       bigint generated always as identity primary key,
  name                     text not null,
  category                 text not null,
  parent_id                bigint references public.groups (id),
  path                     bigint[] not null,
  competes_in_cup          boolean not null default false,
  counts_toward_parent_cup boolean not null default true,
  min_level                integer not null default 0,
  accepts_applications     boolean not null default false,
  application_level        integer,
  shared_work_visibility   boolean not null default false,
  automatic_membership     boolean not null default false,
  manager_title            text,
  status                   text not null default 'active',
  short                    text,
  color                    text,
  legacy_dept_id           text unique,
  legacy_team_id           text unique,
  legacy_project_id        bigint unique,
  created_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint groups_name_ck
    check (name ~ '[^[:space:]]'),
  constraint groups_category_ck
    check (category in ('department', 'project', 'team', 'organization')),
  constraint groups_competes_top_level_ck
    check (not competes_in_cup or parent_id is null),
  constraint groups_min_level_ck
    check (min_level in (0, 1, 2, 3, 5, 6, 9)),
  constraint groups_application_level_ck
    check (application_level is null
           or (application_level in (0, 1, 2, 3, 5, 6, 9) and application_level >= min_level)),
  constraint groups_applications_shape_ck
    check (not accepts_applications or application_level is not null),
  constraint groups_automatic_no_applications_ck
    check (not automatic_membership or not accepts_applications),
  constraint groups_manager_title_ck
    check (manager_title is null or manager_title ~ '[^[:space:]]'),
  constraint groups_status_ck
    check (status in ('active', 'archived')),
  constraint groups_legacy_one_ck
    check (num_nonnulls(legacy_dept_id, legacy_team_id, legacy_project_id) <= 1),
  constraint groups_path_ck
    check (cardinality(path) >= 1 and path[cardinality(path)] = id),
  constraint groups_timestamps_ck
    check (updated_at >= created_at)
);

comment on table public.groups is
  'One body of OSUBB people and work (ADR-0009). Wave 1: mirrored from departments/teams/projects by private.sync_* and never written directly; legacy_* names the row that masters it.';
comment on column public.groups.path is
  'Root-first ancestor chain ending in this row''s own id, maintained by groups_validate_hierarchy; authority helpers read it instead of recursing.';
comment on column public.groups.category is
  'Presentation label only (Department, Project, Team, or the one Organization root). No rule may branch on it.';

-- Native Groups only until Wave 3 dedupes the legacy names this table will
-- shadow: `departments`, `teams` and `projects` were never unique against each
-- other, so a total index could not be created over the #508 backfill.
create unique index groups_parent_name_uidx
  on public.groups (coalesce(parent_id, 0), lower(name))
  where legacy_dept_id is null and legacy_team_id is null and legacy_project_id is null;
create index groups_parent_idx on public.groups (parent_id);
create index groups_path_idx on public.groups using gin (path);

create table public.group_members (
  group_id       bigint not null references public.groups (id) on delete cascade,
  member_id      uuid   not null references public.profiles (id) on delete cascade,
  group_role     text   not null default 'member',
  position_title text,
  created_at     timestamptz not null default now(),

  primary key (group_id, member_id),
  constraint group_members_role_ck
    check (group_role in ('manager', 'responsible', 'member')),
  constraint group_members_position_title_ck
    check (position_title is null or position_title ~ '[^[:space:]]')
);
create index group_members_member_idx on public.group_members (member_id, group_id);

comment on table public.group_members is
  'Explicit roster of a Group with its Group Role. Automatic-membership Groups hold only manager/responsible rows.';

-- ==================== Invariants ====================

create function private.validate_group_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.groups%rowtype;
begin
  if new.parent_id is null then
    new.path := array[new.id];
  else
    -- The parent is locked for no key update, never for update (conventions section 2):
    -- this row's path is derived from the parent's, so a concurrent re-parent of the
    -- parent must serialize behind it, while FK key-share readers keep flowing.
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = new.parent_id
       for no key update;
    if not found then
      raise exception using errcode = '23514', message = 'group_parent_not_found';
    end if;
    if new.id = any (v_parent.path) then
      raise exception using errcode = '23514', message = 'group_cycle';
    end if;
    if new.min_level < v_parent.min_level then
      raise exception using errcode = '23514', message = 'group_min_level_below_parent';
    end if;
    new.path := v_parent.path || new.id;
  end if;

  if tg_op = 'UPDATE'
     and new.min_level > old.min_level
     and exists (select 1 from public.groups as child
                  where child.parent_id = new.id and child.min_level < new.min_level) then
    raise exception using errcode = '23514', message = 'group_min_level_above_children';
  end if;

  if new.automatic_membership
     and (tg_op = 'INSERT' or not old.automatic_membership)
     and exists (select 1 from public.group_members as membership
                  where membership.group_id = new.id and membership.group_role = 'member') then
    raise exception using errcode = '23514', message = 'automatic_group_has_no_roster_members';
  end if;

  return new;
end;
$$;

comment on function private.validate_group_hierarchy() is
  'Derives groups.path from the parent, refuses cycles, keeps a Child Group at or above its parent''s Minimum Level, and keeps an Automatic-Membership Group free of hand-written ordinary members (#507).';

create function private.cascade_group_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.path is distinct from old.path then
    update public.groups as descendant
       set path = new.path || descendant.path[cardinality(old.path) + 1 :]
     where descendant.path[1 : cardinality(old.path)] = old.path
       and descendant.id <> new.id;
  end if;
  return null;
end;
$$;

comment on function private.cascade_group_path() is
  'Rewrites every descendant''s ancestor prefix when a Group is re-parented. Touches only `path`, so the column-scoped hierarchy trigger does not re-fire and there is no recursion (#507).';

create function private.validate_group_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.group_id is distinct from old.group_id
       or new.member_id is distinct from old.member_id) then
    raise exception using errcode = '23514', message = 'group_membership_identity_immutable';
  end if;
  if new.group_role = 'member'
     and exists (select 1 from public.groups as target
                  where target.id = new.group_id and target.automatic_membership) then
    raise exception using errcode = '23514', message = 'automatic_group_has_no_roster_members';
  end if;
  return new;
end;
$$;

comment on function private.validate_group_member() is
  'Membership identity is immutable, and an Automatic-Membership Group holds only Group Managers and Responsibles (#507).';

create trigger groups_validate_hierarchy
before insert or update of parent_id, min_level, automatic_membership on public.groups
for each row execute function private.validate_group_hierarchy();

create trigger groups_cascade_path
after update of parent_id on public.groups
for each row execute function private.cascade_group_path();

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create trigger group_members_validate
before insert or update on public.group_members
for each row execute function private.validate_group_member();

-- ==================== Read predicate, RLS and grants ====================

create function private.can_read_group_roster(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.groups as target
         join public.group_members as held
           on held.group_id = any (target.path)
        where target.id = p_group_id
          and held.member_id = (select auth.uid())
          and held.group_role in ('manager', 'responsible')
     );
$$;
comment on function private.can_read_group_roster(bigint) is
  'Whether the live active caller is a Group Manager or Group Responsible of the Group or of any ancestor on its path. Runs outside RLS so group_members_read does not recurse.';

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy groups_read on public.groups
  for select to authenticated
  using (
    public.auth_is_member()
    and (
      (status = 'active' and (select private.caller_level()) >= min_level)
      or (select private.caller_level()) >= 5
      -- Authority flows down the chain (ADR-0009 Group Roles), so it overrides
      -- the Minimum Level gate for the Group row itself. Without this branch
      -- the two policies would disagree about one authority: a level-1 Group
      -- Manager of a Department could read its level-3 Child Group's roster
      -- through group_members_read while the Group row naming it stayed hidden,
      -- and every roster join would drop the rows it had just been allowed.
      or private.can_read_group_roster(id)
    )
  );

create policy group_members_read on public.group_members
  for select to authenticated
  using (
    public.auth_is_member()
    and (
      (member_id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or (select private.caller_level()) >= 5
      or private.can_read_group_roster(group_id)
    )
  );

comment on policy groups_read on public.groups is
  'An active Member reads an active Group at or above their live level; a Group Manager or Responsible of the Group or of any ancestor reads it whatever their rank; rank BCE and above read every Group, archived ones included.';
comment on policy group_members_read on public.group_members is
  'A Member reads their own roster rows; rank BCE and above read every roster; a Group Manager or Responsible reads the roster of their Group and of every Group below it.';

-- Read-only for everyone but the mirror (which runs as the table owner).
revoke all on table public.groups        from public, anon, authenticated, service_role;
revoke all on table public.group_members from public, anon, authenticated, service_role;
revoke all on sequence public.groups_id_seq from public, anon, authenticated, service_role;
grant select on table public.groups        to authenticated, service_role;
grant select on table public.group_members to authenticated, service_role;

revoke execute on function private.validate_group_hierarchy()    from public, anon, authenticated, service_role;
revoke execute on function private.cascade_group_path()          from public, anon, authenticated, service_role;
revoke execute on function private.validate_group_member()       from public, anon, authenticated, service_role;
revoke execute on function private.can_read_group_roster(bigint) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.can_read_group_roster(bigint) to authenticated;
