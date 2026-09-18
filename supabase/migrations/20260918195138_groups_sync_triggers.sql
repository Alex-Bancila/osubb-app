-- #509: mirror departments, teams, projects and their rosters into groups/group_members one
-- way (legacy -> groups) and re-derive Department Group Managers when a profile's role
-- changes (ADR-0009 Wave 1).
--
-- The legacy tables stay the write master; nothing here ever writes back to them, and
-- `public` gains no object at all. Each trigger calls the key-scoped `private.sync_*`
-- helper #508 shipped for exactly this purpose, so a per-row mirror costs one row's work
-- and produces, by construction, the same rows a full `private.sync_groups_from_legacy()`
-- would — `supabase/tests/groups_sync.test.sql` pins that fixpoint.
--
-- All seven functions are `security definer` on purpose. `member_departments_manage`,
-- `teams_create` and `profiles_self_update` let ordinary `authenticated` sessions write
-- the legacy rows, and #507 left `groups`/`group_members` read-only for every client
-- role. An invoker-rights mirror would answer those writes with `42501` instead of
-- mirroring them (on the `private.sync_*` helper it calls first, which is revoked from the
-- same four roles, and on `public.groups` behind it); granting the client a write on the
-- mirror instead would hand it a way round the whole model.
--
-- Why a DELETE is safe whichever order the triggers fire in: `delete from teams` runs the
-- referential-integrity cascade first (`RI_ConstraintTrigger_*` sorts before any name we
-- can choose), removing `team_members` row by row and firing
-- `team_members_mirror_membership` for each — the Team row is already gone, so the scoped
-- sync only deletes stale roster rows. Then `teams_mirror_group` deletes the Group and
-- `group_members.group_id ... on delete cascade` sweeps whatever is left. The seed's
-- delete-then-insert of `t-app`/`t-recruti`/`t-logistica` and of both demo Projects
-- therefore yields exactly one Group per legacy row after every run; ids move, names do
-- not, and `scripts/seed-fingerprint.sql` reads names.

-- ==================== First: never write-lock a Group you did not have to create ====================
-- #508's syncs are self-healing: each one ensures its own Group (and, for a Team, the
-- parent Department Group) before touching a roster, because five pgTAP suites
-- `truncate public.profiles cascade` and leave the mirror empty. It ensured by calling
-- the Group sync unconditionally -- which was free when the only caller was a one-shot
-- backfill, and is not free now that every legacy write goes through it.
--
-- `insert … on conflict do update` locks the conflicting row FOR NO KEY UPDATE **even
-- when its `is distinct from` guard writes nothing**. So, unguarded, adding one member to
-- a Department would hold a write lock on that Department's Group row for the rest of the
-- transaction, and any second session touching the same Department would queue behind it.
-- That is not hypothetical: it hangs `supabase/tests/select_task_candidate.test.sql`
-- outright, whose main transaction adds members to `edu` and whose dblink fixture
-- connection then adds more -- a wait no deadlock detector can break, because the waiter
-- is the session the waited-on transaction is itself blocked on.
--
-- The repair is to make the ensure conditional on the Group actually being missing. The
-- self-heal is unchanged where it matters (after a truncate the Group really is gone);
-- what goes away is the write lock on the common path, leaving the roster sync to reach
-- its Group through a foreign key only -- FOR KEY SHARE, the traffic
-- private.validate_group_hierarchy's `for no key update` is chosen to let through
-- (conventions section 2). A concurrent check-then-insert is safe: both sessions simply
-- fall into the same `on conflict`.
--
-- Only the four scoped prologues change. Every mapping, guard and delete below them is
-- #508's, byte for byte, and `supabase/tests/groups_backfill.test.sql` still pins it.

create or replace function private.sync_team_groups(p_team_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_team_id is not null then
    -- Self-healing: the parent Department Group must exist before the child row
    -- (a suite that truncates profiles cascade has just wiped groups). #509: only
    -- when it is actually missing, so mirroring a Team does not write-lock the
    -- Department Group every other write in that Department has to read.
    perform private.sync_department_groups(team.dept_id)
       from public.teams as team
      where team.id = p_team_id and team.dept_id is not null
        and not exists (select 1 from public.groups as grp
                         where grp.legacy_dept_id = team.dept_id);
  else
    -- The whole-table path needs the same guarantee, and needs it more: the
    -- `left join` below yields null rather than raising, so against a wiped or
    -- partial mirror a missing parent would quietly make every Department Team
    -- a *top-level* Group carrying a Coordonator and no ancestor path -- a
    -- wrong row, with no error anywhere. It is not a concurrent path (the full
    -- resync is a maintenance call), so it stays unconditional.
    perform private.sync_department_groups();
  end if;

  insert into public.groups as grp
    (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
     accepts_applications, application_level, shared_work_visibility, automatic_membership,
     manager_title, status, legacy_team_id)
  select team.name, 'team', parent.id, false, true, 0, false, 0, true, false,
         -- An Independent Team has no Group Manager at all: every member is a Group
         -- Responsible instead (ADR-0009 Group Roles), so it carries no manager title.
         case when team.dept_id is null then null else 'Coordonator' end,
         'active', team.id
    from public.teams as team
    left join public.groups as parent on parent.legacy_dept_id = team.dept_id
   where p_team_id is null or team.id = p_team_id
  on conflict (legacy_team_id) do update
     set name = excluded.name, parent_id = excluded.parent_id,
         manager_title = excluded.manager_title
   where (grp.name, grp.parent_id, grp.manager_title)
         is distinct from (excluded.name, excluded.parent_id, excluded.manager_title);
end;
$$;

create or replace function private.sync_department_memberships(
  p_member_id uuid default null, p_dept_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_dept_id is not null
     and not exists (select 1 from public.groups as grp
                      where grp.legacy_dept_id = p_dept_id) then
    perform private.sync_department_groups(p_dept_id);
  end if;

  insert into public.group_members as membership (group_id, member_id, group_role)
  select grp.id, md.member_id,
         -- BCE is the display name of a Department's Group Manager (ADR-0009 Group
         -- Roles); the rank and the position are linked here so Wave 2 can drop
         -- can_manage_origin's local-BCE branch without losing the authority.
         case when member.role = 'bce' then 'manager' else 'member' end
    from public.member_departments as md
    join public.departments as dept on dept.id = md.dept_id and dept.kind <> 'org'
    join public.groups as grp on grp.legacy_dept_id = md.dept_id
    join public.profiles as member on member.id = md.member_id
   where (p_member_id is null or md.member_id = p_member_id)
     and (p_dept_id is null or md.dept_id = p_dept_id)
  on conflict (group_id, member_id) do update
     set group_role = excluded.group_role
   where membership.group_role is distinct from excluded.group_role;

  -- The Organization Group's roster is never the mirror's to touch.
  delete from public.group_members as membership
   using public.groups as grp
   join public.departments as dept on dept.id = grp.legacy_dept_id and dept.kind <> 'org'
   where grp.id = membership.group_id
     and (p_member_id is null or membership.member_id = p_member_id)
     and (p_dept_id is null or grp.legacy_dept_id = p_dept_id)
     and not exists (
       select 1 from public.member_departments as md
        where md.member_id = membership.member_id
          and md.dept_id = grp.legacy_dept_id);
end;
$$;

create or replace function private.sync_team_memberships(
  p_team_id text default null, p_member_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_team_id is not null
     and not exists (select 1 from public.groups as grp
                      where grp.legacy_team_id = p_team_id) then
    perform private.sync_team_groups(p_team_id);
  end if;

  insert into public.group_members as membership (group_id, member_id, group_role)
  select grp.id, tm.member_id,
         -- An Independent Team is jointly managed by its members (ADR-0007, restated
         -- by ADR-0009 without a special case): every member is a Group Responsible.
         case when team.dept_id is null then 'responsible' else 'member' end
    from public.team_members as tm
    join public.teams as team on team.id = tm.team_id
    join public.groups as grp on grp.legacy_team_id = tm.team_id
   where (p_team_id is null or tm.team_id = p_team_id)
     and (p_member_id is null or tm.member_id = p_member_id)
  on conflict (group_id, member_id) do update
     set group_role = excluded.group_role
   where membership.group_role is distinct from excluded.group_role;

  delete from public.group_members as membership
   using public.groups as grp
   where grp.id = membership.group_id
     and grp.legacy_team_id is not null
     and (p_team_id is null or grp.legacy_team_id = p_team_id)
     and (p_member_id is null or membership.member_id = p_member_id)
     and not exists (
       select 1 from public.team_members as tm
        where tm.team_id = grp.legacy_team_id and tm.member_id = membership.member_id);
end;
$$;

create or replace function private.sync_project_memberships(
  p_project_id bigint default null, p_member_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_id is not null
     and not exists (select 1 from public.groups as grp
                      where grp.legacy_project_id = p_project_id) then
    perform private.sync_project_groups(p_project_id);
  end if;

  -- The leader is unioned in so the result never depends on whether
  -- projects_sync_leader_membership has already written the leader's row.
  insert into public.group_members as membership (group_id, member_id, group_role)
  select grp.id, roster.member_id, roster.group_role
    from (
      select pm.project_id, pm.member_id,
             case when project.leader_id = pm.member_id then 'manager'
                  when pm.project_role = 'responsible' then 'responsible'
                  else 'member' end as group_role
        from public.project_members as pm
        join public.projects as project on project.id = pm.project_id
      union
      select project.id, project.leader_id, 'manager'
        from public.projects as project
    ) as roster
    join public.groups as grp on grp.legacy_project_id = roster.project_id
   where (p_project_id is null or roster.project_id = p_project_id)
     and (p_member_id is null or roster.member_id = p_member_id)
  on conflict (group_id, member_id) do update
     set group_role = excluded.group_role
   where membership.group_role is distinct from excluded.group_role;

  delete from public.group_members as membership
   using public.groups as grp
   where grp.id = membership.group_id
     and grp.legacy_project_id is not null
     and (p_project_id is null or grp.legacy_project_id = p_project_id)
     and (p_member_id is null or membership.member_id = p_member_id)
     and not exists (
       select 1 from public.project_members as pm
        where pm.project_id = grp.legacy_project_id and pm.member_id = membership.member_id)
     and not exists (
       select 1 from public.projects as project
        where project.id = grp.legacy_project_id and project.leader_id = membership.member_id);
end;
$$;

-- ==================== Groups ====================

create function private.mirror_department_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.groups where legacy_dept_id = old.id;
    return null;
  end if;
  -- `departments.id` is a natural key a migration could still rewrite. The Group is
  -- keyed by the *old* value, so drop it before mirroring the row under its new one.
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.groups where legacy_dept_id = old.id;
  end if;
  perform private.sync_department_groups(new.id);
  return null;
end;
$$;

comment on function private.mirror_department_group() is
  'Mirrors every write to public.departments into its Group, and deletes the Group when the Department goes (#509).';

create function private.mirror_team_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.groups where legacy_team_id = old.id;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.groups where legacy_team_id = old.id;
  end if;
  perform private.sync_team_groups(new.id);
  if tg_op = 'UPDATE' and new.dept_id is distinct from old.dept_id then
    -- Department Team <-> Independent Team flips every roster role: ordinary membership
    -- under a Department, Group Responsible when the Team stands alone (ADR-0009 Group
    -- Roles). The roster is re-derived rather than patched, so the two directions cost
    -- the same one call.
    perform private.sync_team_memberships(new.id);
  end if;
  return null;
end;
$$;

comment on function private.mirror_team_group() is
  'Mirrors every write to public.teams into its Group, re-parenting it and re-deriving its roster whenever the Team changes Department (#509).';

create function private.mirror_project_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.groups where legacy_project_id = old.id;
    return null;
  end if;
  perform private.sync_project_groups(new.id);
  if tg_op = 'INSERT' or new.leader_id is distinct from old.leader_id then
    -- The Project lead is the Group Manager. private.sync_project_memberships unions the
    -- leader in, so this does not depend on projects_sync_leader_membership -- which
    -- sorts *after* this trigger on the same event -- having written their
    -- `project_members` row yet.
    perform private.sync_project_memberships(new.id);
  end if;
  return null;
end;
$$;

comment on function private.mirror_project_group() is
  'Mirrors every write to public.projects into its Group, moving the Group Manager role with the Project lead (#509).';

-- ==================== Rosters ====================
-- Each roster trigger syncs the scope the row left and the scope it landed in, so an
-- UPDATE that moves a membership cleans up behind itself. Both calls are scoped to one
-- key pair; the syncs are idempotent, so INSERT and DELETE simply use the one side they
-- have.

create function private.mirror_department_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_department_memberships(old.member_id, old.dept_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_department_memberships(new.member_id, new.dept_id);
  end if;
  return null;
end;
$$;

comment on function private.mirror_department_membership() is
  'Mirrors public.member_departments into the Department Group''s roster, syncing both the old and the new scope so a moved membership leaves no stale row (#509).';

create function private.mirror_team_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_team_memberships(old.team_id, old.member_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_team_memberships(new.team_id, new.member_id);
  end if;
  return null;
end;
$$;

comment on function private.mirror_team_membership() is
  'Mirrors public.team_members into the Team Group''s roster, syncing both the old and the new scope (#509).';

create function private.mirror_project_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_project_memberships(old.project_id, old.member_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_project_memberships(new.project_id, new.member_id);
  end if;
  return null;
end;
$$;

comment on function private.mirror_project_membership() is
  'Mirrors public.project_members into the Project Group''s roster, syncing both the old and the new scope (#509).';

-- ==================== Rank BCE is a Group Role ====================
-- A Department Group's Group Manager is its BCE (ADR-0009 Group Roles), so the rank and
-- the position are the same fact seen twice. Promoting or demoting a profile therefore
-- has to re-derive every Department Group they belong to -- Wave 2 drops
-- private.can_manage_origin's local-BCE branch and reads the Group Role instead, and it
-- may only do that if this stays true row by row.

create function private.rederive_department_group_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role = 'bce') is distinct from (old.role = 'bce') then
    -- Ensure each Department Group exists before its roster is re-derived: a suite that
    -- truncated `profiles` cascade has taken the mirror with it. The `not exists` guard
    -- is a lock decision, not an optimisation: private.sync_department_groups upserts,
    -- and `on conflict do update` locks the conflicting row FOR NO KEY UPDATE even when
    -- its `is distinct from` guard writes nothing. Without this test, promoting one
    -- member would take a write lock on every Department Group they belong to and
    -- serialize against every concurrent structural change in those Departments. With
    -- it, the roster sync below reaches the Group through a foreign key only -- FOR KEY
    -- SHARE, which is exactly the traffic private.validate_group_hierarchy's
    -- `for no key update` is chosen to let through (conventions section 2).
    perform private.sync_department_groups(md.dept_id)
       from public.member_departments as md
      where md.member_id = new.id
        and not exists (select 1 from public.groups as grp
                         where grp.legacy_dept_id = md.dept_id);
    perform private.sync_department_memberships(new.id);
  end if;
  return null;
end;
$$;

comment on function private.rederive_department_group_roles() is
  'Re-derives a member''s Department Group Roles when they cross the rank-BCE line in either direction; every other role change is a no-op (#509).';

-- ==================== Triggers ====================
-- All seven are AFTER ... FOR EACH ROW and return null: the mirror never influences the
-- legacy write it observes. Same-event AFTER triggers fire in name order, which puts
-- `projects_mirror_group` before `projects_sync_leader_membership` -- harmless, because
-- the Project roster sync unions the leader in itself.

create trigger departments_mirror_group
after insert or update or delete on public.departments
for each row execute function private.mirror_department_group();

create trigger teams_mirror_group
after insert or update of id, name, dept_id or delete on public.teams
for each row execute function private.mirror_team_group();

create trigger projects_mirror_group
after insert or update of name, status, leader_id or delete on public.projects
for each row execute function private.mirror_project_group();

create trigger member_departments_mirror_membership
after insert or update or delete on public.member_departments
for each row execute function private.mirror_department_membership();

create trigger team_members_mirror_membership
after insert or update or delete on public.team_members
for each row execute function private.mirror_team_membership();

create trigger project_members_mirror_membership
after insert or update or delete on public.project_members
for each row execute function private.mirror_project_membership();

create trigger profiles_rederive_group_roles
after update of role on public.profiles
for each row execute function private.rederive_department_group_roles();

-- ==================== Grants ====================
-- Trigger functions get no grant back at all (conventions section 4): nothing should ever
-- call one directly, and a grant here would be a client write path into the mirror.

revoke execute on function private.mirror_department_group()
  from public, anon, authenticated, service_role;
revoke execute on function private.mirror_team_group()
  from public, anon, authenticated, service_role;
revoke execute on function private.mirror_project_group()
  from public, anon, authenticated, service_role;
revoke execute on function private.mirror_department_membership()
  from public, anon, authenticated, service_role;
revoke execute on function private.mirror_team_membership()
  from public, anon, authenticated, service_role;
revoke execute on function private.mirror_project_membership()
  from public, anon, authenticated, service_role;
revoke execute on function private.rederive_department_group_roles()
  from public, anon, authenticated, service_role;
