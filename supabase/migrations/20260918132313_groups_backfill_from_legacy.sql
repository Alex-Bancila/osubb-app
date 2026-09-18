-- #508: backfill groups/group_members from departments, teams, projects and their rosters
-- (ADR-0009 Wave 1). The private.sync_* helpers are set-based and key-scoped so #509's
-- mirror triggers call the very same code per row; create or replace keeps the file
-- replayable by groups_backfill_upgrade.test.sh.
--
-- Three properties every function below holds, because #509 depends on all three:
--   * key-scoped — a null argument means the whole table, a non-null one scopes both
--     the upsert and the stale-row delete to that key, so a per-row trigger costs one
--     row's work rather than a full resync;
--   * fixpoint — every `do update` carries an `is distinct from` guard, so a resync
--     that changes nothing writes nothing and `groups_set_updated_at` never fires;
--   * self-healing — a roster sync ensures its own Group first, and a Team sync ensures
--     the parent Department Group before that, because five pgTAP suites truncate
--     `profiles` or `projects` cascade and would otherwise leave a trigger firing into
--     a wiped mirror.
--
-- The path column is never written here: `groups_validate_hierarchy` derives it from the
-- parent, and `groups_cascade_path` rewrites the descendants when a re-parent lands.

-- ==================== Groups ====================

create or replace function private.sync_department_groups(p_dept_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.groups as grp
    (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
     accepts_applications, application_level, shared_work_visibility, automatic_membership,
     manager_title, status, short, color, legacy_dept_id)
  select case when dept.kind = 'org' then 'OSUBB' else dept.name end,
         case when dept.kind = 'org' then 'organization' else 'department' end,
         null,
         -- Diverse and Secretariat are Departments whose Cup setting is off
         -- (ADR-0009 Other rulings); `departments.kind` gets no successor column.
         dept.kind = 'department',
         true,
         0,
         false,
         -- Applications stay off everywhere: no Application flow exists before Wave 3.
         -- The level is pre-filled to the ADR's value so switching it on is one column.
         case when dept.kind = 'org' then null else 1 end,
         false,
         dept.kind = 'org',
         case when dept.kind = 'org' then null else 'BCE' end,
         'active',
         dept.short, dept.color, dept.id
    from public.departments as dept
   where p_dept_id is null or dept.id = p_dept_id
  on conflict (legacy_dept_id) do update
     set name = excluded.name, category = excluded.category,
         competes_in_cup = excluded.competes_in_cup,
         application_level = excluded.application_level,
         automatic_membership = excluded.automatic_membership,
         manager_title = excluded.manager_title,
         short = excluded.short, color = excluded.color
   where (grp.name, grp.category, grp.competes_in_cup, grp.application_level,
          grp.automatic_membership, grp.manager_title, grp.short, grp.color)
         is distinct from
         (excluded.name, excluded.category, excluded.competes_in_cup, excluded.application_level,
          excluded.automatic_membership, excluded.manager_title, excluded.short, excluded.color);
end;
$$;

comment on function private.sync_department_groups(text) is
  'Mirrors public.departments into public.groups: a delivery Department competes in the Cup, a coordination structure does not, and the org pseudo-department becomes the Organization Group (#508, ADR-0009 Wave 1).';

create or replace function private.sync_team_groups(p_team_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_team_id is not null then
    -- Self-healing: the parent Department Group must exist before the child row
    -- (a suite that truncates profiles cascade has just wiped groups).
    perform private.sync_department_groups(team.dept_id)
       from public.teams as team
      where team.id = p_team_id and team.dept_id is not null;
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

comment on function private.sync_team_groups(text) is
  'Mirrors public.teams into public.groups: a Department Team becomes a Child Group under its Department, an Independent Team a top-level Group with no Group Manager. `is_interne` is retired by ADR-0009 and is not mirrored (#508).';

create or replace function private.sync_project_groups(p_project_id bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.groups as grp
    (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
     accepts_applications, application_level, shared_work_visibility, automatic_membership,
     manager_title, status, legacy_project_id, created_by, created_at)
  select project.name, 'project', null, false, true, 0, false, 0, false, false,
         'Coordonator Principal', project.status, project.id, project.created_by, project.created_at
    from public.projects as project
   where p_project_id is null or project.id = p_project_id
  on conflict (legacy_project_id) do update
     set name = excluded.name, status = excluded.status
   where (grp.name, grp.status) is distinct from (excluded.name, excluded.status);
end;
$$;

comment on function private.sync_project_groups(bigint) is
  'Mirrors public.projects into public.groups, carrying the lifecycle and the Project''s own provenance rather than the migration''s clock (#508).';

-- ==================== Rosters ====================
-- Each sync ensures its Group first, upserts the scoped roster, then deletes the
-- scoped rows the legacy tables no longer justify.

create or replace function private.sync_department_memberships(
  p_member_id uuid default null, p_dept_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_dept_id is not null then
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

comment on function private.sync_department_memberships(uuid, text) is
  'Mirrors public.member_departments into a Department Group''s roster, promoting a member of rank BCE to Group Manager. The Organization Group is excluded in both directions: Automatic Membership derives its roster (#508).';

create or replace function private.sync_team_memberships(
  p_team_id text default null, p_member_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_team_id is not null then
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

comment on function private.sync_team_memberships(text, uuid) is
  'Mirrors public.team_members into a Team Group''s roster: ordinary membership under a Department Team, Group Responsible in an Independent Team (#508).';

create or replace function private.sync_project_memberships(
  p_project_id bigint default null, p_member_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_id is not null then
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

comment on function private.sync_project_memberships(bigint, uuid) is
  'Mirrors public.project_members into a Project Group''s roster, with the Project leader as its Group Manager whatever their project_members row says — and even when they have none (#508).';

-- ==================== The full resync ====================

create or replace function private.sync_groups_from_legacy()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Orphans: a legacy row deleted while no mirror existed.
  delete from public.groups as grp
   where (grp.legacy_dept_id is not null
          and not exists (select 1 from public.departments as dept where dept.id = grp.legacy_dept_id))
      or (grp.legacy_team_id is not null
          and not exists (select 1 from public.teams as team where team.id = grp.legacy_team_id))
      or (grp.legacy_project_id is not null
          and not exists (select 1 from public.projects as project where project.id = grp.legacy_project_id));
  -- 2. Groups, parents before children.
  perform private.sync_department_groups();
  perform private.sync_team_groups();
  perform private.sync_project_groups();
  -- 3. Rosters.
  perform private.sync_department_memberships();
  perform private.sync_team_memberships();
  perform private.sync_project_memberships();
end;
$$;

comment on function private.sync_groups_from_legacy() is
  'One full conversion of departments/teams/projects and their rosters into the Group model: drop orphans, mirror Groups parents-before-children, then the rosters. Run once by #508''s migration and re-runnable at any time (#508).';

revoke execute on function
  private.sync_department_groups(text), private.sync_team_groups(text),
  private.sync_project_groups(bigint), private.sync_department_memberships(uuid, text),
  private.sync_team_memberships(text, uuid), private.sync_project_memberships(bigint, uuid),
  private.sync_groups_from_legacy()
  from public, anon, authenticated, service_role;

-- The backfill itself. On a fresh reset this sees reference data only (the seed runs
-- afterwards and #509's triggers mirror it); on staging it converts the live database.
select private.sync_groups_from_legacy();
