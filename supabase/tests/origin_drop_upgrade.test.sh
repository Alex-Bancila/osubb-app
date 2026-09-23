#!/usr/bin/env bash
# #579: the origin-bridge drop replayed over a database that still carries BOTH identities
# on every work row -- group_id and the legacy Origin (tasks / completed_work_requests
# dept_id/team_id/project_id, events scope + dept_id/team_id/project_id, campaigns
# department_id) -- which is the staging shape on deploy day. A db reset runs the migration
# against reference data only (migrations precede seed.sql), so this harness is the only
# place its guards meet real rows:
#
#   run 0      a clean pre-drop database: every guard passes, the migration completes, the
#              legacy surface is gone and every row keeps exactly the group_id it had;
#   runs 1-6   one planted fault each, and the migration refuses under exactly that fault's
#              snake_case reason: work_row_group_id_null, work_row_on_native_group, and the
#              four *_group_origin_disagreement guards.
#
# Each run is one rollback-only transaction: teardown (restore the pre-#579 schema shape
# and backfill the legacy columns from each row's own Group, exactly as the bridge kept
# them), the optional fault, then the real migration file. The retired
# tasks_origin_upgrade.test.sh and tasks_group_id_backfill_upgrade.test.sh replayed
# migrations that recreate the columns this one deletes; this harness replaces them.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260922134557_drop_origin_bridge.sql"

psql_run() {
  docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
}

# The pre-#579 shape the migration expects to find. Objects the migration only DROPS
# unexecuted get stand-in bodies; the resolver the guards call is restored verbatim, and
# the legacy columns carry their real constraints, foreign keys and indexes.
teardown() {
  cat <<'SQL'
-- The new arities are created with plain `create function` by the migration.
drop function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint);
drop function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint);
drop function public.create_completed_work_request(text, bigint);
drop function private.create_completed_work_request_impl(text, bigint);

-- Stand-ins for what the migration drops without ever running.
create function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint)
returns public.tasks language sql as 'select null::public.tasks';
create function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint)
returns public.tasks language sql as 'select null::public.tasks';
create function private.create_completed_work_request_impl(text, text, text, bigint, bigint)
returns public.completed_work_requests language sql as 'select null::public.completed_work_requests';
create function public.create_completed_work_request(text, text, text, bigint, bigint)
returns public.completed_work_requests language sql as 'select null::public.completed_work_requests';
create function public.create_campaign(p_department_id text, p_name text)
returns public.campaigns language sql as 'select null::public.campaigns';
create function private.can_manage_origin(text, text, bigint) returns boolean language sql as 'select false';
create function private.require_origin_manager(text, text, bigint) returns uuid language sql as 'select null::uuid';
create function private.sync_task_group_origin() returns trigger language plpgsql as 'begin return new; end';
create function private.sync_request_group_origin() returns trigger language plpgsql as 'begin return new; end';
create function private.sync_campaign_group_origin() returns trigger language plpgsql as 'begin return new; end';
create function private.sync_event_group_origin() returns trigger language plpgsql as 'begin return new; end';

-- The resolver, verbatim from 20260919135332_group_id_on_work_and_events.sql: the guards call it.
create function private.group_id_for_legacy_origin(p_dept_id text, p_team_id text, p_project_id bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select grp.id
    from public.groups as grp
   where case
           when p_project_id is not null then grp.legacy_project_id = p_project_id
           when p_team_id    is not null then grp.legacy_team_id    = p_team_id
           when p_dept_id    is not null then grp.legacy_dept_id    = p_dept_id
           else false
         end;
$$;

-- The legacy columns, backfilled from each row's own Group as the bridge kept them.
create type public.event_scope as enum ('team', 'dept', 'project', 'org');

-- #586's current demo seed creates its three Team and two Project Groups with
-- commands after the bridge was dropped. For this rollback-only replay of the
-- older, pre-#579 shape, attach their corresponding surviving legacy keys.
-- The transaction rolls these synthetic keys back after each run.
update public.groups as grp
   set legacy_team_id = team.id
  from public.teams as team
 where grp.created_by = 'd0000000-0000-0000-0000-000000000007'
   and (grp.name, team.id) in (('Echipa Aplicație', 't-app'),
                              ('Echipa Recruți', 't-recruti'),
                              ('Echipa Logistică', 't-logistica'));
update public.groups as grp
   set legacy_project_id = project.id
  from public.projects as project
 where grp.created_by = 'd0000000-0000-0000-0000-000000000007'
   and project.created_by = grp.created_by
   and project.name = grp.name
   and project.name in ('Festivalul Studențesc 2026', 'Gala Voluntarilor 2025');

alter table public.tasks add column dept_id text, add column team_id text, add column project_id bigint;
update public.tasks as task
   set dept_id = grp.legacy_dept_id, team_id = grp.legacy_team_id, project_id = grp.legacy_project_id
  from public.groups as grp where grp.id = task.group_id;
alter table public.tasks
  add constraint tasks_exactly_one_origin_ck check (num_nonnulls(dept_id, team_id, project_id) = 1),
  add constraint tasks_dept_id_fkey foreign key (dept_id) references public.departments (id),
  add constraint tasks_team_id_fkey foreign key (team_id) references public.teams (id),
  add constraint tasks_project_id_fkey foreign key (project_id) references public.projects (id);
create index tasks_dept_idx on public.tasks (dept_id);
create index tasks_team_idx on public.tasks (team_id);
create index tasks_project_idx on public.tasks (project_id);

alter table public.completed_work_requests add column dept_id text, add column team_id text, add column project_id bigint;
update public.completed_work_requests as request
   set dept_id = grp.legacy_dept_id, team_id = grp.legacy_team_id, project_id = grp.legacy_project_id
  from public.groups as grp where grp.id = request.group_id;
alter table public.completed_work_requests
  add constraint completed_work_requests_origin_ck check (num_nonnulls(dept_id, team_id, project_id) = 1),
  add constraint completed_work_requests_dept_id_fkey foreign key (dept_id) references public.departments (id),
  add constraint completed_work_requests_team_id_fkey foreign key (team_id) references public.teams (id),
  add constraint completed_work_requests_project_id_fkey foreign key (project_id) references public.projects (id);
create index completed_work_requests_dept_idx on public.completed_work_requests (dept_id);
create index completed_work_requests_team_idx on public.completed_work_requests (team_id);
create index completed_work_requests_project_idx on public.completed_work_requests (project_id);

alter table public.campaigns add column department_id text;
update public.campaigns as campaign set department_id = grp.legacy_dept_id
  from public.groups as grp where grp.id = campaign.group_id;
alter table public.campaigns
  add constraint campaigns_department_id_fkey foreign key (department_id) references public.departments (id);

alter table public.events
  add column scope public.event_scope, add column dept_id text,
  add column team_id text, add column project_id bigint;
update public.events as event
   set scope = case when grp.legacy_dept_id = 'org' then 'org'
                    when grp.legacy_dept_id is not null then 'dept'
                    when grp.legacy_team_id is not null then 'team'
                    else 'project' end::public.event_scope,
       dept_id = case when grp.legacy_dept_id = 'org' then null
                      when grp.legacy_dept_id is not null then grp.legacy_dept_id
                      when grp.legacy_team_id is not null
                        then (select team.dept_id from public.teams as team where team.id = grp.legacy_team_id)
                 end,
       team_id = grp.legacy_team_id,
       project_id = grp.legacy_project_id
  from public.groups as grp where grp.id = event.group_id;
alter table public.events alter column scope set not null;
alter table public.events
  add constraint events_scope_fields_ck check (
       (scope = 'org'     and dept_id is null     and team_id is null and project_id is null)
    or (scope = 'dept'    and dept_id is not null and team_id is null and project_id is null)
    or (scope = 'team'    and team_id is not null and project_id is null)
    or (scope = 'project' and dept_id is null     and team_id is null and project_id is not null)),
  add constraint events_dept_id_fkey foreign key (dept_id) references public.departments (id),
  add constraint events_project_id_fkey foreign key (project_id) references public.projects (id),
  add constraint events_team_department_fkey foreign key (team_id, dept_id)
    references public.teams (id, dept_id) deferrable;
create index events_dept_idx on public.events (dept_id);
create index events_team_idx on public.events (team_id);
create index events_project_idx on public.events (project_id);

create trigger tasks_sync_group_origin before insert or update of group_id, dept_id, team_id, project_id
  on public.tasks for each row execute function private.sync_task_group_origin();
create trigger completed_work_requests_sync_group_origin before insert or update of group_id, dept_id, team_id, project_id
  on public.completed_work_requests for each row execute function private.sync_request_group_origin();
create trigger campaigns_sync_group_origin before insert or update of group_id, department_id
  on public.campaigns for each row execute function private.sync_campaign_group_origin();
create trigger events_sync_group_origin before insert or update of group_id, scope, dept_id, team_id, project_id
  on public.events for each row execute function private.sync_event_group_origin();
SQL
}

# A clean pre-drop database must have something in every table, or run 0 proves nothing.
nonvacuous=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select (select count(*) from public.tasks) > 0 and (select count(*) from public.events) > 0
      and (select count(*) from public.campaigns) > 0 and (select count(*) from public.completed_work_requests) > 0")
if [ "$nonvacuous" != "t" ]; then
  echo "origin drop upgrade: run it against a seeded database (every work table needs rows)." >&2
  exit 1
fi

tasks_before=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select md5(string_agg(id || ':' || group_id, ',' order by id)) from public.tasks")

# ==================== run 0: a clean database passes every guard ====================
{
  cat <<'SQL'
begin;
set local client_min_messages = warning;
create temp table origin_before as
  select 'task' as kind, id, group_id from public.tasks
  union all select 'request', id, group_id from public.completed_work_requests
  union all select 'campaign', id, group_id from public.campaigns
  union all select 'event', id, group_id from public.events;
SQL
  teardown
  cat <<'SQL'
do $sanity$
begin
  -- The teardown really restored both identities, in agreement, on every row.
  if exists (select 1 from public.tasks
              where group_id is distinct from private.group_id_for_legacy_origin(dept_id, team_id, project_id)) then
    raise exception 'origin drop: the teardown left a Task whose legacy Origin disagrees with its Group';
  end if;
  if not exists (select 1 from public.events where scope = 'team' and dept_id is not null) then
    raise exception 'origin drop: no Department-Team Event carries its parent Department -- the teardown shape is wrong';
  end if;
end
$sanity$;
SQL
  cat "$migration"
  cat <<'SQL'
do $assert$
declare
  v_missing text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_missing
    from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (
       ('tasks', 'dept_id'), ('tasks', 'team_id'), ('tasks', 'project_id'),
       ('completed_work_requests', 'dept_id'), ('completed_work_requests', 'team_id'),
       ('completed_work_requests', 'project_id'), ('campaigns', 'department_id'),
       ('events', 'scope'), ('events', 'dept_id'), ('events', 'team_id'), ('events', 'project_id'));
  if v_missing is not null then
    raise exception 'origin drop: legacy columns survived: %', v_missing;
  end if;
  if to_regtype('public.event_scope') is not null then
    raise exception 'origin drop: public.event_scope survived';
  end if;
  if exists (select 1 from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
              where n.nspname = 'private'
                and p.proname in ('group_id_for_legacy_origin', 'can_manage_origin', 'require_origin_manager',
                                  'sync_task_group_origin', 'sync_request_group_origin',
                                  'sync_campaign_group_origin', 'sync_event_group_origin')) then
    raise exception 'origin drop: a bridge function survived';
  end if;
  if (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('create_task', 'create_completed_work_request')) <> 2
     or to_regprocedure('public.create_task(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint)') is null
     or to_regprocedure('public.create_completed_work_request(text,bigint)') is null
     or to_regprocedure('public.create_campaign(text,text)') is not null then
    raise exception 'origin drop: the command arities are not exactly the Group-only ones';
  end if;
  -- Every row keeps exactly the Group it had: the drop moves nothing.
  if exists (
    select 1 from origin_before as before
     where before.group_id is distinct from case before.kind
             when 'task'     then (select group_id from public.tasks where id = before.id)
             when 'request'  then (select group_id from public.completed_work_requests where id = before.id)
             when 'campaign' then (select group_id from public.campaigns where id = before.id)
             when 'event'    then (select group_id from public.events where id = before.id) end) then
    raise exception 'origin drop: a work row changed Group';
  end if;
end
$assert$;
rollback;
SQL
} | psql_run
echo "run 0: a clean pre-drop database passes every guard and loses nothing"

# ==================== runs 1-6: each guard's failure path ====================
# expect_refusal <reason> <fault SQL>: the fault is planted with triggers and foreign keys
# off (session_replication_role = replica), so it lands exactly as written -- the shape a
# bypassed bridge would have left -- and the migration must then stop under <reason>.
expect_refusal() {
  local reason="$1" fault="$2" output
  set +e
  output=$({
    cat <<'SQL'
begin;
set local client_min_messages = warning;
SQL
    teardown
    printf 'set local session_replication_role = replica;\n%s\nset local session_replication_role = origin;\n' "$fault"
    cat "$migration"
    printf 'rollback;\n'
  } | psql_run 2>&1)
  local status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "origin drop: the migration completed despite a planted '$reason' fault." >&2
    exit 1
  fi
  if ! grep -q "ERROR:  $reason\$" <<<"$output"; then
    echo "origin drop: expected the migration to refuse with '$reason', got:" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "refused as expected: $reason"
}

expect_refusal work_row_group_id_null "
alter table public.tasks alter column group_id drop not null;
update public.tasks set group_id = null where id = (select min(id) from public.tasks);"

expect_refusal work_row_on_native_group "
set local session_replication_role = origin;  -- the Group itself is an ordinary insert (its path trigger runs)
insert into public.groups (name, category, path) values ('Native origin drop 579', 'team', '{}');
set local session_replication_role = replica;
update public.events set group_id = (select id from public.groups where name = 'Native origin drop 579')
 where id = (select min(id) from public.events);"

expect_refusal tasks_group_origin_disagreement "
update public.tasks set dept_id = case when dept_id = 'pr' then 'hr' else 'pr' end
 where id = (select min(id) from public.tasks where dept_id is not null);"

expect_refusal completed_work_requests_group_origin_disagreement "
update public.completed_work_requests set dept_id = case when dept_id = 'pr' then 'hr' else 'pr' end
 where id = (select min(id) from public.completed_work_requests where dept_id is not null);"

expect_refusal campaigns_group_origin_disagreement "
update public.campaigns set department_id = case when department_id = 'pr' then 'hr' else 'pr' end
 where id = (select min(id) from public.campaigns where department_id is not null);"

expect_refusal events_group_origin_disagreement "
update public.events set dept_id = case when dept_id = 'pr' then 'hr' else 'pr' end
 where id = (select min(id) from public.events where scope = 'dept');"

# Every scratch transaction rolled back: the live Tasks are byte-identical.
tasks_after=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
  "select md5(string_agg(id || ':' || group_id, ',' order by id)) from public.tasks")
if [ "$tasks_before" != "$tasks_after" ]; then
  echo "origin drop: live public.tasks changed; a scratch transaction did not roll back." >&2
  exit 1
fi

echo "Origin drop upgrade checks passed (run 0 clean, six guard failure paths refused)."
