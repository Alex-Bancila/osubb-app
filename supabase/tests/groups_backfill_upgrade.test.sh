#!/usr/bin/env bash
# #508: the Wave 1 backfill replayed over a database that already holds legacy rows but no
# mirror -- the staging shape on deploy day. A db reset runs the migration against reference
# data only (migrations precede seed.sql, and #509's mirror triggers do not exist yet), so
# this harness is the only place the conversion of live rows is proven.
#
# Everything happens inside one rollback-only transaction: the legacy fixtures, the
# `truncate public.groups cascade` that reproduces "no mirror at all", the replay of the
# real migration file, and the assertions. Nothing it writes outlives the run, which the
# post-check below verifies against the live database.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260918132313_groups_backfill_from_legacy.sql"

# Captured before the scratch transaction so the post-check can prove the rollback
# happened, without assuming anything about how many Groups the live database holds.
live_before=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select count(*) from public.groups")

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- Legacy fixtures as a live database would hold them (prefix 50800000-0000-0000-0000-0000000000 1x).
insert into auth.users (id, email) values
  ('50800000-0000-0000-0000-000000000011', 'bce.upgrade.508@test.local'),
  ('50800000-0000-0000-0000-000000000012', 'voluntar.upgrade.508@test.local'),
  ('50800000-0000-0000-0000-000000000013', 'bc.upgrade.508@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('50800000-0000-0000-0000-000000000011', 'BCE Upgrade 508',      'bce.upgrade.508@test.local',      'bce',      'activ'),
  ('50800000-0000-0000-0000-000000000012', 'Voluntar Upgrade 508', 'voluntar.upgrade.508@test.local', 'voluntar', 'activ'),
  ('50800000-0000-0000-0000-000000000013', 'BC Upgrade 508',       'bc.upgrade.508@test.local',       'bc',       'activ');

insert into public.teams (id, name, dept_id, is_interne) values
  ('upgrade-dept-team-B',   'Echipa de Departament Upgrade B', 'edu', false),
  ('upgrade-independent-B', 'Echipa Independenta Upgrade B',   null,  false);

insert into public.member_departments (member_id, dept_id) values
  ('50800000-0000-0000-0000-000000000011', 'edu'),
  ('50800000-0000-0000-0000-000000000012', 'edu'),
  ('50800000-0000-0000-0000-000000000012', 'org');

insert into public.team_members (team_id, member_id) values
  ('upgrade-dept-team-B',   '50800000-0000-0000-0000-000000000012'),
  ('upgrade-independent-B', '50800000-0000-0000-0000-000000000011');

insert into public.projects (name, status, leader_id, created_by) values
  ('Upgrade Project B',  'active',
   '50800000-0000-0000-0000-000000000011', '50800000-0000-0000-0000-000000000013'),
  ('Upgrade Archived B', 'archived',
   '50800000-0000-0000-0000-000000000013', '50800000-0000-0000-0000-000000000013');

insert into public.project_members (project_id, member_id, project_role)
select project.id, '50800000-0000-0000-0000-000000000012', 'responsible'
  from public.projects as project
 where project.name = 'Upgrade Project B';

-- Pre-#508 shape: no mirror at all. Once #509 lands, the fixtures above are mirrored on
-- insert; wiping first makes the replay honest in both worlds.
truncate public.groups cascade;

create temp table before_b as
  select (select count(*) from public.departments)
       + (select count(*) from public.teams)
       + (select count(*) from public.projects) as expected_groups,
         exists (select 1 from public.profiles where email = 'bce@demo.osubb') as seeded;
-- The migration ends with `select private.sync_groups_from_legacy();`; its empty result
-- row is noise here, not evidence. Errors still reach stderr and still stop the run.
\o /dev/null
SQL

  cat "$migration"

  cat <<'SQL'
\o
do $assert$
declare
  v_edu_group  bigint;
  v_team_group bigint;
begin
  -- One Group per legacy row, none extra, none missing.
  if (select count(*) from public.groups) <> (select expected_groups from before_b) then
    raise exception 'groups backfill count: % Groups for % legacy rows',
      (select count(*) from public.groups), (select expected_groups from before_b);
  end if;
  if exists (select 1 from public.departments as dept
              where not exists (select 1 from public.groups as grp
                                 where grp.legacy_dept_id = dept.id))
     or exists (select 1 from public.teams as team
                 where not exists (select 1 from public.groups as grp
                                    where grp.legacy_team_id = team.id))
     or exists (select 1 from public.projects as project
                 where not exists (select 1 from public.groups as grp
                                    where grp.legacy_project_id = project.id)) then
    raise exception 'groups backfill coverage: a Department, Team or Project was left unmirrored';
  end if;

  -- Department rosters: a BCE is the Group Manager, everyone else an ordinary member.
  if (select membership.group_role
        from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_dept_id = 'edu'
         and membership.member_id = '50800000-0000-0000-0000-000000000011')
     is distinct from 'manager' then
    raise exception 'groups backfill BCE rule: the BCE of edu is not its Group Manager';
  end if;
  if (select membership.group_role
        from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_dept_id = 'edu'
         and membership.member_id = '50800000-0000-0000-0000-000000000012')
     is distinct from 'member' then
    raise exception 'groups backfill Department roster: an ordinary member of edu is not a Group member';
  end if;

  -- The Organization Group derives its roster from Automatic Membership.
  if exists (select 1 from public.group_members as membership
               join public.groups as grp on grp.id = membership.group_id
              where grp.legacy_dept_id = 'org') then
    raise exception 'groups backfill org exclusion: the Organization Group was given roster rows';
  end if;

  -- Team rosters: Independent Team members are Group Responsibles, Department Team
  -- members ordinary members.
  if (select membership.group_role
        from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_team_id = 'upgrade-independent-B'
         and membership.member_id = '50800000-0000-0000-0000-000000000011')
     is distinct from 'responsible' then
    raise exception 'groups backfill Independent Team rule: its member is not a Group Responsible';
  end if;
  if (select membership.group_role
        from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_team_id = 'upgrade-dept-team-B'
         and membership.member_id = '50800000-0000-0000-0000-000000000012')
     is distinct from 'member' then
    raise exception 'groups backfill Department Team rule: its member is not an ordinary Group member';
  end if;

  -- Project rosters: every leader is the Group Manager, Responsibles carry over.
  if exists (
    select 1
      from public.projects as project
      join public.groups as grp on grp.legacy_project_id = project.id
      left join public.group_members as membership
        on membership.group_id = grp.id and membership.member_id = project.leader_id
     where coalesce(membership.group_role, '-') <> 'manager') then
    raise exception 'groups backfill Project leader rule: a Project leader is not its Group Manager';
  end if;
  if (select membership.group_role
        from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
        join public.projects as project on project.id = grp.legacy_project_id
       where project.name = 'Upgrade Project B'
         and membership.member_id = '50800000-0000-0000-0000-000000000012')
     is distinct from 'responsible' then
    raise exception 'groups backfill Project roster: a Project Responsible did not carry over';
  end if;

  -- Lifecycle carries over rather than being reset to active.
  if (select grp.status from public.groups as grp
        join public.projects as project on project.id = grp.legacy_project_id
       where project.name = 'Upgrade Archived B')
     is distinct from 'archived' then
    raise exception 'groups backfill lifecycle: an archived Project became an active Group';
  end if;

  -- The Department Team hangs under its Department, path and all.
  select grp.id into v_edu_group  from public.groups as grp where grp.legacy_dept_id = 'edu';
  select grp.id into v_team_group from public.groups as grp where grp.legacy_team_id = 'upgrade-dept-team-B';
  if (select grp.path from public.groups as grp where grp.id = v_team_group)
     is distinct from array[v_edu_group, v_team_group] then
    raise exception 'groups backfill hierarchy: the Department Team Group has the wrong ancestor path';
  end if;

  -- With the demo seed present (CI and a local reset), the same three rules are
  -- re-proven over data nobody wrote for this harness.
  if (select seeded from before_b) then
    if (select membership.group_role
          from public.group_members as membership
          join public.groups as grp on grp.id = membership.group_id
          join public.profiles as member on member.id = membership.member_id
         where grp.legacy_dept_id = 'diverse' and member.email = 'bce@demo.osubb')
       is distinct from 'manager' then
      raise exception 'groups backfill seed BCE rule: the demo BCE is not Group Manager of Diverse';
    end if;
    if exists (
      select 1 from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_team_id = 't-logistica' and membership.group_role <> 'responsible')
       or not exists (
      select 1 from public.group_members as membership
        join public.groups as grp on grp.id = membership.group_id
       where grp.legacy_team_id = 't-logistica') then
      raise exception 'groups backfill seed Independent Team rule: t-logistica members are not all Group Responsibles';
    end if;
    if (select membership.group_role
          from public.group_members as membership
          join public.groups as grp on grp.id = membership.group_id
          join public.projects as project on project.id = grp.legacy_project_id
         where project.name = 'Festivalul Studențesc 2026'
           and membership.member_id = project.leader_id)
       is distinct from 'manager' then
      raise exception 'groups backfill seed Project leader rule: the Festivalul leader is not its Group Manager';
    end if;
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

# The truncate must not have survived. Deviation from the plan sketch, recorded here
# rather than silently: comparing live `groups` against departments + teams + projects
# is only true once #509's triggers exist, because a fresh `db reset` applies this
# migration *before* seed.sql and nothing mirrors the demo Teams and Projects it then
# inserts. What is true in both worlds is that the rollback changed nothing and that
# the reference Departments -- all of them created by migrations, before the backfill
# statement runs -- still have their Groups.
live_after=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select count(*) from public.groups")
if [ "$live_before" != "$live_after" ]; then
  echo "public.groups changed from $live_before to $live_after rows; the scratch transaction did not roll back." >&2
  exit 1
fi

departments_mirrored=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select (select count(*) from public.groups where legacy_dept_id is not null) = (select count(*) from public.departments) and (select count(*) from public.departments) > 0")
if [ "$departments_mirrored" != "t" ]; then
  echo "live groups no longer hold one Group per Department; the backfill did not survive the harness." >&2
  exit 1
fi

echo "Groups backfill upgrade checks passed (live groups unchanged at $live_after rows)."
