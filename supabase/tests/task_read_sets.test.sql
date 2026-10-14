-- The Task read rule, decided once per request (spec 2026-10-14 "Fast reads
-- everywhere", part 1).
--
-- tasks_read and the four Task child-table read policies stop calling
-- private.can_read_task(id) for every row. They read four caller-scoped sets
-- that Postgres computes once per statement: private.own_task_ids() (R2: the
-- caller's Assignments and Candidatures, ever) and
-- private.task_read_groups('whole' | 'open' | 'org') (R1/R3/R4; R6-own;
-- R6-org). private.can_read_task stays: commands ask it about one Task, and it
-- is the reference this suite holds the new rule to.
--
-- Parity: for every caller -- each Member in the database with live claims, a
-- deactivated Member with stale claims, and a caller without organization
-- claims -- the rows each policy returns are exactly the rows the old policy
-- expression accepts, computed as postgres (no RLS) with the same claims.
-- The named cases below pin each branch, so the parity cannot hold by
-- everything being hidden.
--
-- Mutation record (2026-10-14; each branch broken alone, the suite run):
--   own_task_ids without Candidatures -> "own_task_ids: and the Tasks the
--     caller is a Candidate on", "R2: a Candidature reads its Task", parity;
--   own_task_ids for a deactivated Member, or task_read_groups without the
--     activ check -> "a deactivated Member ... four empty sets", "a
--     deactivated Member reads no Task", parity;
--   whole without R3 / R4 / R1 -> the R3, R4 (roster, automatic) and R1
--     cases, parity; open without the Minimum Level -> the R6-own cases;
--     org through a Private Group -> the R6-org Private Group cases;
--   tasks_read without the Umbrella (R7) -> "R2/R7 ..."; without the queue
--     or the Audience test -> "R6-org: an open org Opportunity ...";
--   each child policy without its Task -> that table's parity (through the
--     Candidature, Evaluation and history rows in the Private Group);
--   tasks_read back on private.can_read_task per row -> the timing guard.
--   Equivalent: tasks_read without "status not in (finished)" -- a finished
--   public Task always has a closed queue (tasks_queue_timestamp_state_ck),
--   so the queue test already excludes it; the clause stays to mirror
--   private.can_read_task.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(32);

\ir _group_task_fixtures.psql
reset role;

-- ------------------------------------------------------------- the fixture
create function pg_temp.tr_uid(n integer) returns uuid language sql immutable as $$
  select ('53000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- The claims a Member signs in with today: role, level and roster Groups.
create function pg_temp.tr_meta(p_uid uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
           'member_role', profile.role,
           'member_level', role.level,
           'group_ids', coalesce((
             select jsonb_agg(membership.group_id order by membership.group_id)
               from public.group_members as membership
              where membership.member_id = profile.id), '[]'::jsonb))
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = p_uid
$$;

-- Ids a statement returns to the caller, through RLS.
create function pg_temp.tr_ids_as(p_uid uuid, p_sql text, p_meta jsonb default null)
returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  perform pg_temp.test_login(p_uid, coalesce(p_meta, pg_temp.tr_meta(p_uid)));
  execute format('select coalesce(array_agg(x order by x), ''{}'') from (%s) as q(x)', p_sql) into v_ids;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

-- Ids a statement returns with the caller's claims but no RLS: the reference.
create function pg_temp.tr_ids_ref(p_uid uuid, p_sql text, p_meta jsonb default null)
returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated',
                       'app_metadata', coalesce(p_meta, pg_temp.tr_meta(p_uid)))::text, true);
  execute format('select coalesce(array_agg(x order by x), ''{}'') from (%s) as q(x)', p_sql) into v_ids;
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

-- A set function's answer to the caller.
create function pg_temp.tr_set_as(p_uid uuid, p_sql text, p_meta jsonb default null)
returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  perform pg_temp.test_login(p_uid, coalesce(p_meta, pg_temp.tr_meta(p_uid)));
  execute format('select coalesce((select array_agg(x order by x) from unnest((%s)) as x), ''{}'')', p_sql) into v_ids;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

-- Milliseconds a statement takes as the caller, through RLS.
create function pg_temp.tr_ms_as(p_uid uuid, p_sql text) returns numeric language plpgsql as $$
declare
  v_started timestamptz;
  v_count bigint;
begin
  perform pg_temp.test_login(p_uid, pg_temp.tr_meta(p_uid));
  v_started := clock_timestamp();
  execute p_sql into v_count;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return extract(epoch from clock_timestamp() - v_started) * 1000;
end;
$$;

-- 1 a Volunteer in no Group; 2 a Volunteer who executes in a Private Group
-- they are not in; 3 a Volunteer of that Private Group; 4 the Manager of a
-- Group whose Minimum Level is above them; 5 a plain member there; 6 a roster
-- member of a Group with Shared Work Visibility; 7 a deactivated BC member.
insert into auth.users(id, email)
select pg_temp.tr_uid(n), 'member.' || n || '.tr@test.local' from generate_series(1, 7) as n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.tr_uid(n), 'Member #TR ' || n, 'member.' || n || '.tr@test.local',
       case when n = 7 then 'bc' else 'voluntar' end::public.member_role,
       (case when n = 7 then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 7) as n;

insert into public.groups(name, category, application_level) values ('Open #TR', 'team', 0);
insert into public.groups(name, category, application_level, is_private) values ('Private #TR', 'team', 0, true);
insert into public.groups(name, category) values ('MinLevel #TR', 'team');
insert into public.groups(name, category, application_level, shared_work_visibility) values ('Shared #TR', 'team', 0, true);
insert into public.groups(name, category, automatic_membership, shared_work_visibility) values ('Auto #TR', 'team', true, true);

create function pg_temp.tr_gid(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;

insert into public.group_members(group_id, member_id, group_role) values
  (pg_temp.tr_gid('Private #TR'), pg_temp.tr_uid(3), 'member'),
  (pg_temp.tr_gid('MinLevel #TR'), pg_temp.tr_uid(4), 'manager'),
  (pg_temp.tr_gid('MinLevel #TR'), pg_temp.tr_uid(5), 'member'),
  (pg_temp.tr_gid('Shared #TR'), pg_temp.tr_uid(6), 'member');
-- The roster refuses a member below the level, so it rises afterwards.
update public.groups set min_level = 5 where name = 'MinLevel #TR';

create temp table tr_tasks(name text primary key, id bigint);
grant select on tr_tasks to authenticated;

create function pg_temp.tr_task(p_name text, p_group text, p_mode text, p_audience text,
                                p_kind text default 'task', p_parent text default null,
                                p_queue_closed boolean default false)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind,
                           parent_task_id, created_at, queue_opened_at, queue_closed_at)
  values ('Task #TR ' || p_name, pg_temp.tr_gid(p_group), pg_temp.g521_uid(1), 'todo',
          case when p_kind = 'task' then p_audience end,
          case when p_kind = 'task' then p_mode end,
          p_kind,
          (select id from tr_tasks where name = p_parent),
          now() - interval '3 days',
          case when p_mode = 'public' and p_kind = 'task' then now() - interval '2 days' end,
          case when p_queue_closed then now() - interval '1 day' end)
  returning id into v_id;
  insert into tr_tasks values (p_name, v_id);
  return v_id;
end;
$$;

select pg_temp.tr_task('open_direct', 'Open #TR', 'direct', 'local');
select pg_temp.tr_task('open_local', 'Open #TR', 'public', 'local');
select pg_temp.tr_task('open_org', 'Open #TR', 'public', 'org');
select pg_temp.tr_task('open_closed', 'Open #TR', 'public', 'org', p_queue_closed => true);
select pg_temp.tr_task('pv_org', 'Private #TR', 'public', 'org');
select pg_temp.tr_task('pv_umbrella', 'Private #TR', null, null, 'umbrella');
select pg_temp.tr_task('pv_sub', 'Private #TR', 'direct', 'local', p_parent => 'pv_umbrella');
select pg_temp.tr_task('pv_own', 'Private #TR', 'direct', 'local');
select pg_temp.tr_task('ml_direct', 'MinLevel #TR', 'direct', 'local');
select pg_temp.tr_task('ml_local', 'MinLevel #TR', 'public', 'local');
select pg_temp.tr_task('sh_direct', 'Shared #TR', 'direct', 'local');
select pg_temp.tr_task('auto_direct', 'Auto #TR', 'direct', 'local');
-- A finished org Opportunity, and one taken by a Member (its Evaluation,
-- Assignment and history are the child rows the parity reads).
select pg_temp.g521_task('tr_done', 'dept', 5, 'completed', 'public');

-- #2 executes pv_own and holds the Umbrella of pv_sub -- the second only by a
-- hand-written row: the commands refuse an Umbrella's Assignment, the rule
-- still reads one.
insert into public.task_assignments(task_id, member_id, assigned_by)
select id, pg_temp.tr_uid(2), pg_temp.g521_uid(1) from tr_tasks where name in ('pv_own', 'pv_umbrella');
-- Child rows in the Private Group, where a global reader (the BCE) is refused:
-- #3's Candidature on its org Opportunity, and a Task #2 executed there,
-- evaluated through the command (its Evaluation and history rows).
insert into public.task_candidates(task_id, member_id)
select id, pg_temp.tr_uid(3) from tr_tasks where name = 'pv_org';
insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind,
                         created_at, started_at, submitted_at)
values ('Task #TR pv_done', pg_temp.tr_gid('Private #TR'), pg_temp.g521_uid(1), 'in_review', 'local',
        'direct', 'task', now() - interval '4 days', now() - interval '3 days', now() - interval '2 days');
insert into tr_tasks select 'pv_done', id from public.tasks where title = 'Task #TR pv_done';
insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at)
select id, pg_temp.tr_uid(2), pg_temp.g521_uid(1), now() - interval '3 days' from tr_tasks where name = 'pv_done';
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.g521_uid(1), 'role', 'authenticated',
  'app_metadata', jsonb_build_object('member_role', 'bc', 'member_level', 6))::text, true);
select public.complete_task_review((select id from tr_tasks where name = 'pv_done'), 3, 3, 'Fixture evaluation #TR');
select pg_temp.test_clear_jwt();

-- #7 held a Task before being deactivated: a former Member's own work is
-- no longer theirs to read.
insert into public.task_assignments(task_id, member_id, assigned_by)
select id, pg_temp.tr_uid(7), pg_temp.g521_uid(1) from tr_tasks where name = 'sh_direct';
-- #1 is a Candidate on a local Opportunity of a Group above their level --
-- a Task they read only through that Candidature.
insert into public.task_candidates(task_id, member_id)
select id, pg_temp.tr_uid(1) from tr_tasks where name = 'ml_local';

create function pg_temp.tr_id(p_name text) returns bigint language sql stable as $$
  select coalesce((select id from tr_tasks where name = p_name),
                  (select id from g521_tasks where name = p_name))
$$;

-- Every caller: each Member with live claims, the deactivated one with the
-- claims he signed in with, and #1 without organization claims.
create temp table tr_callers(label text, uid uuid, meta jsonb);
insert into tr_callers
select 'member ' || profile.email, profile.id, null
  from public.profiles as profile where profile.status = 'activ';
insert into tr_callers values
  ('deactivated BC, stale claims', pg_temp.tr_uid(7),
   '{"member_role": "bc", "member_level": 6, "group_ids": []}'::jsonb),
  ('no organization claims', pg_temp.tr_uid(1), '{}'::jsonb);

create function pg_temp.tr_parity(p_rls text, p_reference text) returns setof text language sql as $$
  select caller.label || ': ' || mismatch.side || ' ' || mismatch.id
    from tr_callers as caller
   cross join lateral (
     select 'only through RLS' as side, rls.id
       from unnest(pg_temp.tr_ids_as(caller.uid, p_rls, caller.meta)) as rls(id)
     except
     select 'only through RLS', ref.id
       from unnest(pg_temp.tr_ids_ref(caller.uid, p_reference, caller.meta)) as ref(id)
     union all
     (select 'only by the reference', ref.id
        from unnest(pg_temp.tr_ids_ref(caller.uid, p_reference, caller.meta)) as ref(id)
      except
      select 'only by the reference', rls.id
        from unnest(pg_temp.tr_ids_as(caller.uid, p_rls, caller.meta)) as rls(id))
   ) as mismatch
$$;

-- -------------------------------------------------------------- the sets
select has_function('private', 'own_task_ids', '{}'::name[], 'private.own_task_ids() exists');
select has_function('private', 'task_read_groups', array['text']::name[], 'private.task_read_groups(text) exists');

select is(pg_temp.tr_set_as(pg_temp.tr_uid(2), 'private.own_task_ids()'),
          array(select id from tr_tasks where name in ('pv_umbrella', 'pv_own', 'pv_done') order by id),
          'own_task_ids: the Tasks the caller holds an Assignment on');
select is(pg_temp.tr_set_as(pg_temp.tr_uid(1), 'private.own_task_ids()'),
          array[pg_temp.tr_id('ml_local')],
          'own_task_ids: and the Tasks the caller is a Candidate on');
select ok(pg_temp.tr_gid('MinLevel #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(4), 'private.task_read_groups(''whole'')'))
          and not pg_temp.tr_gid('MinLevel #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(5), 'private.task_read_groups(''whole'')')),
          'whole: a Group Role reads a Group above its holder''s level (R3); a plain member there does not');
select ok(pg_temp.tr_gid('Private #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(3), 'private.task_read_groups(''open'')'))
          and not pg_temp.tr_gid('MinLevel #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(5), 'private.task_read_groups(''open'')')),
          'open: a member''s Group at their level (R6-own); not one above it');
select ok(pg_temp.tr_gid('Private #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(3), 'private.task_read_groups(''org'')'))
          and not pg_temp.tr_gid('Private #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(1), 'private.task_read_groups(''org'')'))
          and pg_temp.tr_gid('Open #TR') = any(pg_temp.tr_set_as(pg_temp.tr_uid(1), 'private.task_read_groups(''org'')')),
          'org: every Group the caller can see (R6-org); a Private Group only from inside');
select is(pg_temp.tr_set_as(pg_temp.tr_uid(7), 'private.own_task_ids() || private.task_read_groups(''whole'') || private.task_read_groups(''open'') || private.task_read_groups(''org'')',
                            '{"member_role": "bc", "member_level": 6, "group_ids": []}'::jsonb),
          '{}'::bigint[], 'a deactivated Member with stale claims gets four empty sets');
select is(pg_temp.tr_set_as(pg_temp.tr_uid(1), 'private.own_task_ids() || private.task_read_groups(''whole'') || private.task_read_groups(''open'') || private.task_read_groups(''org'')',
                            '{}'::jsonb),
          '{}'::bigint[], 'a caller without organization claims gets four empty sets');

-- ------------------------------------------------------- the named branches
create function pg_temp.tr_reads(p_n integer, p_task text, p_meta jsonb default null) returns boolean
language sql as $$
  select pg_temp.tr_id(p_task) = any(pg_temp.tr_ids_as(pg_temp.tr_uid(p_n), 'select id from public.tasks', p_meta))
$$;

select ok(pg_temp.tr_reads(2, 'pv_sub') and pg_temp.tr_reads(2, 'pv_own') and not pg_temp.tr_reads(2, 'pv_org'),
          'R2/R7: own work in a Private Group one cannot see, and the sub-Tasks of an own Umbrella; nothing else there');
select ok(pg_temp.tr_reads(3, 'pv_org') and not pg_temp.tr_reads(1, 'pv_org'),
          'R6-org stops at a Private Group: its org Opportunity is read from inside only');
select ok(pg_temp.tr_reads(1, 'open_org') and not pg_temp.tr_reads(1, 'open_local')
          and not pg_temp.tr_reads(1, 'open_closed') and not pg_temp.tr_reads(1, 'open_direct'),
          'R6-org: an open org Opportunity, not a local one, a closed queue or a direct Task');
select ok(not pg_temp.tr_reads(6, 'tr_done'),
          'a finished org Opportunity is no Opportunity');
select ok(pg_temp.tr_reads(4, 'ml_direct') and pg_temp.tr_reads(4, 'ml_local'),
          'R3: a Group Role reads every Task of a Group above its holder''s level');
select ok(not pg_temp.tr_reads(5, 'ml_local') and not pg_temp.tr_reads(5, 'ml_direct'),
          'R6-own needs the Minimum Level: a member below it reads neither');
select ok(pg_temp.tr_reads(1, 'ml_local') and not pg_temp.tr_reads(1, 'ml_direct'),
          'R2: a Candidature reads its Task, wherever it is, and nothing beside it');
select ok(pg_temp.tr_reads(6, 'sh_direct') and not pg_temp.tr_reads(1, 'sh_direct'),
          'R4: Shared Work Visibility through a roster row, not without one');
select ok(pg_temp.tr_reads(1, 'auto_direct'),
          'R4: Shared Work Visibility through Automatic Membership');
select ok(pg_temp.tr_id('open_direct') = any(pg_temp.tr_ids_as(pg_temp.g521_uid(9), 'select id from public.tasks')),
          'R1: a BCE reads every Task of a Group they can see');
select ok(not pg_temp.tr_id('pv_sub') = any(pg_temp.tr_ids_as(pg_temp.g521_uid(9), 'select id from public.tasks')),
          'R1 stops at a Private Group the BCE cannot see');
select is(pg_temp.tr_ids_as(pg_temp.tr_uid(7), 'select id from public.tasks',
                            '{"member_role": "bc", "member_level": 6, "group_ids": []}'::jsonb),
          '{}'::bigint[], 'a deactivated Member reads no Task, whatever their claims say');
select is(pg_temp.tr_ids_as(pg_temp.tr_uid(2), 'select id from public.tasks', '{}'::jsonb),
          '{}'::bigint[], 'a caller without organization claims reads no Task, not even their own');

-- ------------------------------------------------------------ the parity
select is_empty($$ select * from pg_temp.tr_parity(
  'select id from public.tasks',
  'select id from public.tasks where private.can_read_task(id)') $$,
  'tasks_read returns exactly the Tasks private.can_read_task accepts, for every caller');
select is_empty($$ select * from pg_temp.tr_parity(
  'select id from public.task_assignments',
  'select id from public.task_assignments where public.auth_is_member() and private.can_read_task(task_id)
     and (member_id = auth.uid() or private.is_global_task_reader() or private.can_manage_task(task_id))') $$,
  'task_assignments_read returns exactly what its old expression accepted, for every caller');
select is_empty($$ select * from pg_temp.tr_parity(
  'select id from public.task_candidates',
  'select id from public.task_candidates where public.auth_is_member() and private.can_read_task(task_id)
     and (member_id = auth.uid() or private.is_global_task_reader() or private.can_manage_task(task_id))') $$,
  'task_candidates_read returns exactly what its old expression accepted, for every caller');
select is_empty($$ select * from pg_temp.tr_parity(
  'select id from public.task_evaluations',
  'select id from public.task_evaluations where public.auth_is_member() and private.can_read_task(task_id)
     and (evaluated_by = auth.uid() or private.is_own_assignment(assignment_id)
          or private.is_global_task_reader() or private.can_manage_task(task_id))') $$,
  'task_evaluations_read returns exactly what its old expression accepted, for every caller');
select is_empty($$ select * from pg_temp.tr_parity(
  'select id from public.task_activity',
  'select id from public.task_activity where public.auth_is_member() and private.can_read_task(task_id)
     and (actor_id = auth.uid() or private.is_own_assignment(assignment_id) or private.is_global_task_reader()
          or private.can_manage_task(task_id) or private.is_task_team_member(task_id))') $$,
  'task_activity_read returns exactly what its old expression accepted, for every caller');

-- The parity is not vacuous: the callers between them read most of the Tasks
-- and some of every child table.
select ok((select count(distinct id) from tr_callers as caller
             cross join lateral unnest(pg_temp.tr_ids_as(caller.uid, 'select id from public.tasks', caller.meta)) as id)
          >= (select count(*) from public.tasks) * 0.8,
          'the callers between them read at least 80% of the Tasks');
select ok((select bool_and(seen > 0) from (
             select (select count(*) from tr_callers as caller
                       cross join lateral unnest(pg_temp.tr_ids_as(caller.uid, format('select id from public.%I', child), caller.meta)) as id) as seen
               from unnest(array['task_assignments', 'task_candidates', 'task_evaluations', 'task_activity']) as child) as counted),
          'every child table is read by some caller');

-- ------------------------------------------------- the reason it exists
-- 3 000 Tasks the Volunteer may not read -- each one a full check before.
insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind)
select 'Task #TR bulk ' || n, pg_temp.tr_gid('Open #TR'), pg_temp.g521_uid(1), 'todo', 'local', 'direct', 'task'
  from generate_series(1, 3000) as n;
select cmp_ok(pg_temp.tr_ms_as(pg_temp.tr_uid(1), 'select count(*) from public.tasks'), '<', 300::numeric,
              'a Volunteer reads 3 000 Tasks they may not see in under 300 ms');
select cmp_ok(pg_temp.tr_ms_as(pg_temp.tr_uid(1), 'select count(*) from public.task_assignments'), '<', 300::numeric,
              'and the Assignments beside them in under 300 ms');

-- The rule's precondition: a sub-Task lives in its Umbrella's Group.
select is_empty($$ select child.id from public.tasks as child join public.tasks as umbrella on umbrella.id = child.parent_task_id
                    where child.group_id <> umbrella.group_id or umbrella.kind <> 'umbrella' $$,
                'every sub-Task lives in its Umbrella''s Group, under an Umbrella');

select * from finish();
rollback;
