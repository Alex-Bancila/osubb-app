#!/usr/bin/env bash
# #519: the group_id backfill (tasks, events, campaigns, completed_work_requests) replayed
# over a database that already holds legacy rows but no group_id column at all -- the
# staging shape on deploy day. A db reset runs the migration against reference data plus
# whatever seed.sql adds, so this harness is the only place the conversion of pre-existing
# legacy rows -- and the failure path for an Origin with no mirrored Group -- is proven.
#
# Modelled on tasks_origin_upgrade.test.sh (the teardown-then-replay shape and the failure
# path) and groups_backfill_upgrade.test.sh (the live-row post-transaction proof). Both
# scratch transactions roll back; nothing they write outlives this script.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260919135332_group_id_on_work_and_events.sql"

teardown() {
  cat <<'SQL'
drop view public.tasks_with_overdue;
drop trigger tasks_sync_group_origin on public.tasks;
drop trigger completed_work_requests_sync_group_origin on public.completed_work_requests;
drop trigger campaigns_sync_group_origin on public.campaigns;
drop trigger events_sync_group_origin on public.events;

-- The forward migration uses plain `create function` (a brand-new deploy sees these names
-- for the first time), so replaying it against an already-migrated database needs these
-- dropped first, unlike create_campaign_impl/update_campaign_impl below, which it re-issues
-- with `create or replace` and this harness therefore leaves alone.
drop function private.sync_task_group_origin();
drop function private.sync_request_group_origin();
drop function private.sync_campaign_group_origin();
drop function private.sync_event_group_origin();
drop function private.group_id_for_legacy_origin(text, text, bigint);

alter table public.tasks drop constraint tasks_group_id_fkey;
alter table public.events drop constraint events_group_id_fkey;
alter table public.campaigns drop constraint campaigns_group_id_fkey;
alter table public.completed_work_requests drop constraint completed_work_requests_group_id_fkey;

drop index public.tasks_group_idx;
drop index public.events_group_idx;
drop index public.completed_work_requests_group_idx;
drop index public.campaigns_group_name_uidx;

alter table public.tasks drop column group_id;
alter table public.events drop column group_id;
alter table public.campaigns drop column group_id;
alter table public.completed_work_requests drop column group_id;

-- The forward migration's own first act (section 2) is `drop view
-- public.tasks_with_overdue;`, exactly as a real first-time deploy would find it -- so
-- teardown must leave the PRE-migration view behind (verbatim from #341's
-- 20260915151447_duplicate_task.sql, without group_id), not just delete it outright.
create view public.tasks_with_overdue
with (security_invoker = on)
as
select
  task.*,
  (
    coalesce(task.deadline < statement_timestamp(), false)
    and task.status in ('todo', 'in_progress', 'in_review')
  ) as is_overdue
from public.tasks as task;
revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;

alter table public.campaigns alter column department_id set not null;
create unique index campaigns_department_name_uidx on public.campaigns (department_id, lower(name));

alter table public.events drop constraint events_scope_fields_ck;
alter table public.events add constraint events_scope_fields_ck check (
     (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
  or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
  or (scope = 'team'    and dept_id is not null and team_id is not null and project_id is null)
  or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
);

alter table public.events drop constraint events_min_level_ck;
alter table public.events add constraint events_min_level_ck check (min_level in (0, 3, 4, 5, 6));
SQL
}

live_before=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select count(*) from public.tasks where group_id is not null")

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;
SQL

  teardown

  cat <<'SQL'
-- Legacy fixtures as a live database would hold them (prefix 51900000-0000-0000-0000-0000000001xx).
insert into auth.users (id, email)
values ('51900000-0000-0000-0000-000000000101', 'upgrade-lead-519@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('51900000-0000-0000-0000-000000000101', 'Upgrade Lead 519', 'upgrade-lead-519@test.local', 'bce', 'activ');

insert into public.teams (id, name, dept_id) values
  ('upgrade-dept-team-519',  'Upgrade Department Team 519', 'edu'),
  ('upgrade-indep-team-519', 'Upgrade Independent Team 519', null);

insert into public.projects (name, status, leader_id, created_by) values
  ('Upgrade Project 519', 'active',
   '51900000-0000-0000-0000-000000000101', '51900000-0000-0000-0000-000000000101');

insert into public.tasks (title, difficulty, dept_id) values
  ('Upgrade Task Dept 519', 1, 'edu');
insert into public.tasks (title, difficulty, team_id) values
  ('Upgrade Task DeptTeam 519', 1, 'upgrade-dept-team-519');
insert into public.tasks (title, difficulty, team_id) values
  ('Upgrade Task IndepTeam 519', 1, 'upgrade-indep-team-519');
insert into public.tasks (title, difficulty, project_id)
  select 'Upgrade Task Project 519', 1, project.id
    from public.projects as project where project.name = 'Upgrade Project 519';

insert into public.events (title, type, scope, starts_at) values
  ('Upgrade Event Org 519', 'sedinta', 'org', now());
insert into public.events (title, type, scope, dept_id, team_id, starts_at) values
  ('Upgrade Event DeptTeam 519', 'sedinta', 'team', 'edu', 'upgrade-dept-team-519', now());
insert into public.events (title, type, scope, starts_at, min_level) values
  ('Upgrade Event Level4 519', 'sedinta', 'org', now(), 4);

insert into public.campaigns (department_id, name, created_by) values
  ('edu', 'Upgrade Campaign 519', '51900000-0000-0000-0000-000000000101');

insert into public.completed_work_requests (requester_id, dept_id, description) values
  ('51900000-0000-0000-0000-000000000101', 'edu', 'Upgrade Request 519');
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  -- Every fixture row's group_id equals the Group whose legacy_* names its Origin. Each
  -- check is `if not exists (… where … group_id = grp.id)`, not `if exists (… is distinct
  -- from …)`: a missing fixture row or a mirror that never fired must fail loudly, not
  -- pass silently because the join produced no rows at all (review note 6).
  if not exists (
    select 1 from public.tasks as task
      join public.groups as grp on grp.legacy_dept_id = 'edu'
     where task.title = 'Upgrade Task Dept 519' and task.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Department Task did not map to the edu Group';
  end if;

  if not exists (
    select 1 from public.tasks as task
      join public.groups as grp on grp.legacy_team_id = 'upgrade-dept-team-519'
     where task.title = 'Upgrade Task DeptTeam 519' and task.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Department-Team Task did not map to its Team Group';
  end if;

  if not exists (
    select 1 from public.tasks as task
      join public.groups as grp on grp.legacy_team_id = 'upgrade-indep-team-519'
     where task.title = 'Upgrade Task IndepTeam 519' and task.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Independent-Team Task did not map to its Team Group';
  end if;

  if not exists (
    select 1 from public.tasks as task
      join public.projects as project on project.name = 'Upgrade Project 519'
      join public.groups as grp on grp.legacy_project_id = project.id
     where task.title = 'Upgrade Task Project 519' and task.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Project Task did not map to its Project Group';
  end if;

  if not exists (
    select 1 from public.events as event
      join public.groups as grp on grp.legacy_dept_id = 'org'
     where event.title = 'Upgrade Event Org 519' and event.group_id = grp.id
  ) then
    raise exception 'group_id backfill: org Event did not map to the Organization Group';
  end if;

  if not exists (
    select 1 from public.events as event
      join public.groups as grp on grp.legacy_team_id = 'upgrade-dept-team-519'
     where event.title = 'Upgrade Event DeptTeam 519' and event.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Department-Team Event did not map to its Team Group';
  end if;

  if not exists (
    select 1 from public.campaigns as campaign
      join public.groups as grp on grp.legacy_dept_id = 'edu'
     where campaign.name = 'Upgrade Campaign 519' and campaign.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Campaign did not map to the edu Group';
  end if;

  if not exists (
    select 1 from public.completed_work_requests as request
      join public.groups as grp on grp.legacy_dept_id = 'edu'
     where request.description = 'Upgrade Request 519' and request.group_id = grp.id
  ) then
    raise exception 'group_id backfill: Request did not map to the edu Group';
  end if;

  -- min_level 4 moved up to 5.
  if (select min_level from public.events where title = 'Upgrade Event Level4 519') <> 5 then
    raise exception 'group_id backfill: a min_level 4 Event did not move up to 5';
  end if;

  -- campaigns.department_id is still filled after the Group-side is added.
  if (select department_id from public.campaigns where name = 'Upgrade Campaign 519')
       is distinct from 'edu' then
    raise exception 'group_id backfill: Campaign department_id was lost';
  end if;

  -- The old campaign index is gone, the new one is present.
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'campaigns_department_name_uidx') then
    raise exception 'group_id backfill: campaigns_department_name_uidx survived the migration';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'campaigns_group_name_uidx') then
    raise exception 'group_id backfill: campaigns_group_name_uidx was not created';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

baseline_fingerprint=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atq -c \
  "select md5(string_agg(format('%s|%s|%s|%s|%s', id, title, coalesce(dept_id, ''), coalesce(team_id, ''), coalesce(project_id::text, '')), E'\\n' order by id)) from public.tasks")

set +e
failure_output=$({
  cat <<'SQL'
begin;
set local client_min_messages = warning;
SQL

  teardown

  cat <<'SQL'
-- A Team with no Group at all: disable the Wave 1 mirror trigger just long enough to
-- create the orphan, exactly as #519's own report on this failure path requires.
alter table public.teams disable trigger teams_mirror_group;
insert into public.teams (id, name, dept_id) values ('upgrade-orphan-519', 'Orphan 519', null);
alter table public.teams enable trigger teams_mirror_group;
insert into public.tasks (title, difficulty, team_id) values ('Orphan 519', 1, 'upgrade-orphan-519');
SQL

  cat "$migration"
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q 2>&1)
failure_status=$?
set -e

if [ "$failure_status" -eq 0 ]; then
  echo "group_id backfill unexpectedly accepted a Task whose Team has no mirrored Group." >&2
  exit 1
fi

if [[ "$failure_output" != *"unmapped row IDs:"* ]] || [[ "$failure_output" != *"tasks:"* ]]; then
  echo "group_id backfill failed without naming the unmapped tasks row." >&2
  echo "$failure_output" >&2
  exit 1
fi

after_fingerprint=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atq -c \
  "select md5(string_agg(format('%s|%s|%s|%s|%s', id, title, coalesce(dept_id, ''), coalesce(team_id, ''), coalesce(project_id::text, '')), E'\\n' order by id)) from public.tasks")

if [ "$after_fingerprint" != "$baseline_fingerprint" ]; then
  echo "Failed group_id backfill did not roll back the existing Task rows." >&2
  exit 1
fi

live_after=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select count(*) from public.tasks where group_id is not null")
if [ "$live_before" != "$live_after" ]; then
  echo "public.tasks group_id population changed from $live_before to $live_after rows; a scratch transaction did not roll back." >&2
  exit 1
fi

# bool_and(group_id is not null) would be self-fulfilling: the column is NOT NULL, so it
# can never observe a failure. Instead recompute the resolver against every live row's own
# legacy triple and require zero mismatches (review note 5).
mismapped=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select count(*) from public.tasks as t
    where t.group_id <> private.group_id_for_legacy_origin(t.dept_id, t.team_id, t.project_id)")
if [ "$mismapped" != "0" ]; then
  echo "live public.tasks has $mismapped row(s) whose group_id disagrees with its own legacy Origin." >&2
  exit 1
fi

echo "group_id backfill upgrade checks passed (live tasks unchanged, $live_after/$live_after rows mapped)."
