-- The Member's lists in the list reader (spec 2026-10-14 "Fast reads
-- everywhere", part 2).
--
-- public.task_list, public.task_list_summary and private.task_list_scope
-- take two more lists:
--   mine      -- the Tasks whose newest Assignment of the caller did not end
--               in gave_up, replaced, task_updated or group_changed: what
--               Taskurile mele kept from a whole read of task_assignments;
--   available -- the open public Tasks of kind task the caller reads with a
--               queue still open, and every public Task the caller is a
--               pending Candidate on: what Disponibile read in two requests.
-- Each row carries my_candidature, the caller's newest Candidature status.
-- For these two lists the embedded Assignments, Evaluations and Submission
-- are what their read policies give the caller -- for the leadership lists
-- they stay whole, as their callers read them.
--
-- Parity: for every caller, the lists equal the reads the pages made through
-- RLS, and the embeds equal the rows RLS returns for the same Tasks.
--
-- Mutation record (2026-10-14; each piece broken alone, the suite run): mine
-- keeping a Task given up, deciding by the oldest own Assignment, or trusting
-- auth.uid() without the caller's standing; available without pending
-- Candidatures, without the read rule, or ignoring a closed queue; a Member
-- list embedding every row, every Evaluation or every Submission; Evaluations
-- without the own Assignment or the managed Tasks; Assignments without the
-- managed Tasks; Submissions without Shared Work Visibility; open Member lists
-- without the title tiebreak; available accepting a finished part;
-- my_candidature reading the oldest Candidature -- each of the 16 fails at
-- least one named case below, and the embed changes fail the parity too.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(29);

\ir _group_task_fixtures.psql
reset role;

-- ------------------------------------------------------------- the fixture
create function pg_temp.ml_uid(n integer) returns uuid language sql immutable as $$
  select ('54000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.ml_meta(p_uid uuid) returns jsonb language sql stable as $$
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

-- A statement's rows as jsonb, run as the caller through RLS.
create function pg_temp.ml_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v_rows jsonb;
begin
  perform pg_temp.test_login(p_uid, pg_temp.ml_meta(p_uid));
  execute format('select coalesce(jsonb_agg(to_jsonb(q) order by q), ''[]'') from (%s) as q', p_sql) into v_rows;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_rows;
end;
$$;

-- 1 and 2 Volunteers of the Group, 3 its Manager (a Volunteer), 4 a
-- Volunteer in no Group; 5 the Executor of a team's Opportunity; 6 a
-- Volunteer of the Group deactivated at the end.
insert into auth.users(id, email)
select pg_temp.ml_uid(n), 'member.' || n || '.ml@test.local' from generate_series(1, 6) as n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.ml_uid(n), 'Member #ML ' || n, 'member.' || n || '.ml@test.local', 'voluntar', 'activ'
  from generate_series(1, 6) as n;
insert into public.groups(name, category, application_level) values ('Mine #ML', 'team', 0);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.ml_uid(held.n), held.role
  from public.groups as grp
 cross join (values (1, 'member'), (2, 'member'), (3, 'manager'), (6, 'member')) as held(n, role)
 where grp.name = 'Mine #ML';

create temp table ml_tasks(name text primary key, id bigint);
grant select on ml_tasks to authenticated;

create function pg_temp.ml_task(p_name text, p_title text, p_mode text, p_audience text,
                                p_deadline timestamptz default null,
                                p_queue_closed boolean default false)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind,
                           deadline, created_at, queue_opened_at, queue_closed_at)
  values (p_title, (select id from public.groups where name = 'Mine #ML'), pg_temp.ml_uid(3),
          'todo', p_audience, p_mode, 'task', p_deadline, now() - interval '5 days',
          case when p_mode = 'public' then now() - interval '4 days' end,
          case when p_queue_closed then now() - interval '1 day' end)
  returning id into v_id;
  insert into ml_tasks values (p_name, v_id);
  return v_id;
end;
$$;

create function pg_temp.ml_held(p_task text, p_n integer, p_days_ago integer, p_end text default null)
returns void language sql as $$
  insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
  select id, pg_temp.ml_uid(p_n), pg_temp.ml_uid(3), now() - make_interval(days => p_days_ago),
         case when p_end is not null then now() - make_interval(days => p_days_ago - 1) end, p_end
    from ml_tasks where name = p_task;
$$;

-- Taskurile mele: the same deadline twice, so the title orders them.
select pg_temp.ml_task('t_now', 'Beta #ML', 'direct', 'local', now() + interval '3 days');
select pg_temp.ml_task('t_replaced', 'Alfa #ML', 'direct', 'local', now() + interval '3 days');
select pg_temp.ml_task('t_soon', 'Gama #ML', 'direct', 'local', now() + interval '1 day');
select pg_temp.ml_task('t_undated', 'Delta #ML', 'direct', 'local');
select pg_temp.ml_task('t_gaveup', 'Epsilon #ML', 'direct', 'local');
select pg_temp.ml_task('t_reopened', 'Zeta #ML', 'direct', 'local', now() + interval '9 days');
select pg_temp.ml_task('t_rejoined', 'Eta #ML', 'direct', 'local', now() + interval '12 days');
select pg_temp.ml_held('t_now', 1, 3);
select pg_temp.ml_held('t_replaced', 2, 4, 'replaced');
select pg_temp.ml_held('t_replaced', 1, 2);
select pg_temp.ml_held('t_soon', 1, 3);
select pg_temp.ml_held('t_undated', 1, 3);
select pg_temp.ml_held('t_gaveup', 1, 4, 'gave_up');
select pg_temp.ml_held('t_gaveup', 2, 2);
select pg_temp.ml_held('t_reopened', 1, 6, 'completed');
select pg_temp.ml_held('t_reopened', 1, 2);
-- Given up, then taken again: the newest Assignment decides.
select pg_temp.ml_held('t_rejoined', 1, 6, 'gave_up');
select pg_temp.ml_held('t_rejoined', 1, 2);

-- #1 starts t_now and submits it, through the commands: the Submission the
-- embed reads.
select pg_temp.test_login(pg_temp.ml_uid(1), pg_temp.ml_meta(pg_temp.ml_uid(1)));
select public.start_task((select id from ml_tasks where name = 't_now'));
select public.submit_task_for_review(p_task_id => (select id from ml_tasks where name = 't_now'), p_note => 'Gata #ML');
select set_config('role', 'none', true);
select pg_temp.test_clear_jwt();

-- Disponibile.
select pg_temp.ml_task('o_local', 'Oportunitate locală #ML', 'public', 'local', now() + interval '6 days');
select pg_temp.ml_task('o_org', 'Oportunitate org #ML', 'public', 'org', now() + interval '5 days');
select pg_temp.ml_task('o_pending', 'Coadă închisă #ML', 'public', 'org', now() + interval '2 days', true);
select pg_temp.ml_task('o_withdrawn', 'Retrasă #ML', 'public', 'org', now() + interval '2 days', true);
-- #1 left the queue once and joined it again: the newest Candidature counts.
insert into public.task_candidates(task_id, member_id, status, joined_at, decided_at, decided_by)
select id, pg_temp.ml_uid(1), 'withdrawn', now() - interval '2 days', now() - interval '1 day', pg_temp.ml_uid(1)
  from ml_tasks where name = 'o_pending';
insert into public.task_candidates(task_id, member_id, status)
select id, pg_temp.ml_uid(1), 'pending' from ml_tasks where name = 'o_pending';
insert into public.task_candidates(task_id, member_id, status, decided_at, decided_by)
select id, pg_temp.ml_uid(4), 'withdrawn', now(), pg_temp.ml_uid(4) from ml_tasks where name = 'o_withdrawn';
-- #2 executes the local Opportunity: Disponibile still lists it to #1.
select pg_temp.ml_held('o_local', 2, 1);
-- Finished work with an Evaluation and a Submission, from the shared fixture.
select pg_temp.g521_task('ml_done', 'dept', 5, 'completed', 'public');

-- Another Member's work on a Task the caller lists: an org Opportunity of a
-- Group with Shared Work Visibility (#2 a member, #3 its Manager) that #5
-- submitted and was evaluated on, then reopened, its queue open again --
-- through the commands. Disponibile lists it to everyone; who reads #5's
-- Submission and Evaluation is the read policies' answer, never "everyone".
insert into public.groups(name, category, application_level, shared_work_visibility)
values ('Echipa #ML', 'team', 0, true);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.ml_uid(held.n), held.role
  from public.groups as grp
 cross join (values (2, 'member'), (3, 'manager'), (5, 'member')) as held(n, role)
 where grp.name = 'Echipa #ML';
create temp table ml_team(id bigint);
grant select on ml_team to authenticated;
with made as (
  insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind,
                           deadline, created_at, queue_opened_at)
  values ('Echipă #ML', (select id from public.groups where name = 'Echipa #ML'), pg_temp.ml_uid(3),
          'todo', 'org', 'public', 'task', now() + interval '8 days', now() - interval '5 days',
          now() - interval '4 days')
  returning id)
insert into ml_team select id from made;
insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at)
select id, pg_temp.ml_uid(5), pg_temp.ml_uid(3), now() - interval '3 days' from ml_team;
select pg_temp.test_login(pg_temp.ml_uid(5), pg_temp.ml_meta(pg_temp.ml_uid(5)));
select public.start_task((select id from ml_team));
select public.submit_task_for_review(p_task_id => (select id from ml_team), p_note => 'Predat #ML');
select pg_temp.test_login(pg_temp.g521_uid(1), pg_temp.ml_meta(pg_temp.g521_uid(1)));
select public.complete_task_review((select id from ml_team), 3, 3, 'Evaluare #ML');
select public.reopen_task((select id from ml_team), 'Redeschis #ML');
select public.set_task_queue((select id from ml_team), true);
select set_config('role', 'none', true);
select pg_temp.test_clear_jwt();

-- #6's own Task, before they are deactivated.
select pg_temp.ml_task('t_six', 'Theta #ML', 'direct', 'local', now() + interval '4 days');
select pg_temp.ml_held('t_six', 6, 3);

create function pg_temp.ml_id(p_name text) returns bigint language sql stable as $$
  select coalesce((select id from ml_tasks where name = p_name),
                  (select id from g521_tasks where name = p_name))
$$;

-- The ids among them that this suite made (the seed has open Opportunities too).
create function pg_temp.ml_mine_only(p_ids bigint[]) returns bigint[] language sql stable as $$
  select coalesce(array_agg(id order by id), '{}') from unnest(p_ids) as id where id in (select ml_tasks.id from ml_tasks)
$$;

create temp table ml_callers(uid uuid);
insert into ml_callers select id from public.profiles where status = 'activ';

-- A list's rows for the caller.
create function pg_temp.ml_list(p_uid uuid, p_list text, p_finished boolean default null)
returns jsonb language sql as $$
  select pg_temp.ml_as(p_uid, format(
    'select id, title, assignments, evaluations, submission, my_candidature
       from public.task_list(p_list => %L, p_finished => %L)', p_list, p_finished))
$$;
create function pg_temp.ml_ids(p_rows jsonb) returns bigint[] language sql immutable as $$
  select coalesce(array_agg((row ->> 'id')::bigint order by (row ->> 'id')::bigint), '{}')
    from jsonb_array_elements(p_rows) as row
$$;
create function pg_temp.ml_embedded(p_rows jsonb, p_part text) returns bigint[] language sql immutable as $$
  select coalesce(array_agg(distinct (part ->> 'id')::bigint order by (part ->> 'id')::bigint), '{}')
    from jsonb_array_elements(p_rows) as row
   cross join jsonb_array_elements(row -> p_part) as part
$$;
-- The ids a statement over the listed Task ids returns to the caller.
create function pg_temp.ml_rls_ids(p_uid uuid, p_sql text, p_tasks bigint[]) returns bigint[] language sql as $$
  select pg_temp.ml_ids(pg_temp.ml_as(p_uid, replace(p_sql, ':tasks', quote_literal(p_tasks) || '::bigint[]')))
$$;

-- ------------------------------------------------------ mine and available
select is(pg_temp.ml_mine_only(pg_temp.ml_ids(pg_temp.ml_list(pg_temp.ml_uid(1), 'mine'))),
          array(select pg_temp.ml_id(name) from unnest(array['t_now', 't_replaced', 't_soon', 't_undated', 't_reopened', 't_rejoined']) as name order by 1),
          'mine: every Task whose newest own Assignment did not end in leaving it -- held, replaced in, reopened, taken again -- and no Task given up');
select is((select count(*)::int from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(1), 'mine')) as row
            where (row ->> 'id')::bigint = pg_temp.ml_id('t_reopened')), 1,
          'mine: a reopened Task with two own Assignments is listed once');
select ok(pg_temp.ml_id('t_gaveup') = any(pg_temp.ml_ids(pg_temp.ml_list(pg_temp.ml_uid(2), 'mine'))),
          'mine: the Task another Member gave up is the new Executor''s');
select is(pg_temp.ml_mine_only(pg_temp.ml_ids(pg_temp.ml_list(pg_temp.ml_uid(1), 'available'))),
          array(select pg_temp.ml_id(name) from unnest(array['o_local', 'o_org', 'o_pending']) as name order by 1),
          'available: the open Opportunities of the Member''s Group and the org ones, and a closed queue they wait in');
select is(pg_temp.ml_mine_only(pg_temp.ml_ids(pg_temp.ml_list(pg_temp.ml_uid(4), 'available'))),
          array[pg_temp.ml_id('o_org')],
          'available: outside the Group only the org Opportunity -- not a local one, not a queue they left');
select is((select row ->> 'my_candidature' from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(1), 'available')) as row
            where (row ->> 'id')::bigint = pg_temp.ml_id('o_pending')), 'pending',
          'my_candidature: the caller''s newest Candidature, pending after one they withdrew');
select ok((select bool_and(row -> 'my_candidature' = 'null'::jsonb) from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(1), 'mine')) as row),
          'my_candidature: null where the caller is no Candidate');

-- ------------------------------------------------------------------ order
select is(array(select row ->> 'title' from jsonb_array_elements(
            pg_temp.ml_as(pg_temp.ml_uid(1), 'select title, place from (select title, row_number() over () as place from public.task_list(p_list => ''mine'', p_finished => false)) as q')) as row
            order by (row ->> 'place')::int),
          array['Gama #ML', 'Alfa #ML', 'Beta #ML', 'Zeta #ML', 'Eta #ML', 'Delta #ML'],
          'mine, open: soonest deadline first, the title between equal deadlines, undated last');

-- -------------------------------------------------- what the embeds hold
select is(pg_temp.ml_embedded((select jsonb_agg(row) from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(1), 'mine')) as row
                                where (row ->> 'id')::bigint = pg_temp.ml_id('t_replaced')), 'assignments'),
          array(select id from public.task_assignments where task_id = pg_temp.ml_id('t_replaced') and member_id = pg_temp.ml_uid(1)),
          'a Volunteer''s row embeds their own Assignment, not the one they replaced');
select is(jsonb_array_length((select row -> 'assignments' from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(3), 'available')) as row
                               where (row ->> 'id')::bigint = pg_temp.ml_id('o_local'))), 1,
          'the Group''s Manager sees the Executor''s Assignment on an Opportunity of theirs');
select is(jsonb_array_length((select row -> 'assignments' from jsonb_array_elements(pg_temp.ml_list(pg_temp.ml_uid(1), 'available')) as row
                               where (row ->> 'id')::bigint = pg_temp.ml_id('o_local'))), 0,
          'a Volunteer does not see another Member''s Assignment on an Opportunity');

-- The reopened team Opportunity: #5's Submission and reversed Evaluation.
create function pg_temp.ml_team_row(p_uid uuid) returns jsonb language sql as $$
  select row from jsonb_array_elements(pg_temp.ml_list(p_uid, 'available')) as row
   where (row ->> 'id')::bigint = (select id from ml_team)
$$;
select ok((select row -> 'submission' = '[]'::jsonb and row -> 'evaluations' = '[]'::jsonb
             from (select pg_temp.ml_team_row(pg_temp.ml_uid(4)) as row) as listed),
          'available: a Volunteer outside the work reads neither the Executor''s Submission nor their Evaluation');
select ok((select jsonb_array_length(row -> 'submission') = 1 and row -> 'evaluations' = '[]'::jsonb
             from (select pg_temp.ml_team_row(pg_temp.ml_uid(2)) as row) as listed),
          'available: a member of a Group with Shared Work Visibility reads the Executor''s Submission, not their Evaluation');
select ok((select jsonb_array_length(row -> 'evaluations') = 1
             from (select pg_temp.ml_team_row(pg_temp.ml_uid(3)) as row) as listed),
          'available: the Group''s Manager, a Volunteer, reads the Executor''s Evaluation');

-- ------------------------------------------------------------- the parity
select is_empty($$
  select caller.uid
    from ml_callers as caller
   where pg_temp.ml_ids(pg_temp.ml_list(caller.uid, 'mine'))
         is distinct from pg_temp.ml_rls_ids(caller.uid, $q$
           select own.task_id as id
             from (select distinct on (assignment.task_id) assignment.task_id, assignment.end_reason
                     from public.task_assignments as assignment
                    where assignment.member_id = auth.uid()
                    order by assignment.task_id, assignment.assigned_at desc, assignment.id desc) as own
             join public.tasks as task on task.id = own.task_id
            where coalesce(own.end_reason, '') not in ('gave_up', 'replaced', 'task_updated', 'group_changed') $q$, '{}')
$$, 'mine equals what Taskurile mele kept from task_assignments through RLS, for every caller');
select is_empty($$
  select caller.uid
    from ml_callers as caller
   where pg_temp.ml_ids(pg_temp.ml_list(caller.uid, 'available'))
         is distinct from pg_temp.ml_rls_ids(caller.uid, $q$
           select task.id from public.tasks as task
            where task.kind = 'task' and task.assignment_mode = 'public' and task.queue_closed_at is null
              and task.status in ('todo', 'in_progress', 'in_review')
           union
           select task.id from public.task_candidates as candidature
             join public.tasks as task on task.id = candidature.task_id
            where candidature.member_id = auth.uid() and candidature.status = 'pending'
              and task.kind = 'task' and task.assignment_mode = 'public' $q$, '{}')
$$, 'available equals what Disponibile read from tasks and task_candidates through RLS, for every caller');

create function pg_temp.ml_embed_parity(p_list text, p_part text, p_sql text) returns setof uuid language sql as $$
  select caller.uid
    from ml_callers as caller
   cross join lateral (select pg_temp.ml_list(caller.uid, p_list) as rows) as listed
   where pg_temp.ml_embedded(listed.rows, p_part)
         is distinct from pg_temp.ml_rls_ids(caller.uid, p_sql, pg_temp.ml_ids(listed.rows))
$$;
select is_empty($$ select * from pg_temp.ml_embed_parity('mine', 'assignments',
  'select id from public.task_assignments where task_id = any(:tasks)') $$,
  'mine: the embedded Assignments are the ones RLS returns, for every caller');
select is_empty($$ select * from pg_temp.ml_embed_parity('available', 'assignments',
  'select id from public.task_assignments where task_id = any(:tasks)') $$,
  'available: the embedded Assignments are the ones RLS returns, for every caller');
select is_empty($$ select * from pg_temp.ml_embed_parity('mine', 'evaluations',
  'select id from public.task_evaluations where task_id = any(:tasks)') $$,
  'mine: the embedded Evaluations are the ones RLS returns, for every caller');
select is_empty($$ select * from pg_temp.ml_embed_parity('available', 'evaluations',
  'select id from public.task_evaluations where task_id = any(:tasks)') $$,
  'available: the embedded Evaluations are the ones RLS returns, for every caller');
select is_empty($$ select * from pg_temp.ml_embed_parity('mine', 'submission',
  'select distinct on (task_id) id from public.task_activity where task_id = any(:tasks) and kind = ''submitted'' order by task_id, id desc') $$,
  'mine: the embedded Submission is the newest one RLS returns, for every caller');
select is_empty($$ select * from pg_temp.ml_embed_parity('available', 'submission',
  'select distinct on (task_id) id from public.task_activity where task_id = any(:tasks) and kind = ''submitted'' order by task_id, id desc') $$,
  'available: the embedded Submission is the newest one RLS returns, for every caller');

-- The parity reads something: the finished Task of the shared fixture
-- reaches its Executor with its Evaluation and Submission.
select ok(array_length(pg_temp.ml_embedded(pg_temp.ml_list(pg_temp.g521_uid(5), 'mine'), 'evaluations'), 1) > 0
          and array_length(pg_temp.ml_embedded(pg_temp.ml_list(pg_temp.ml_uid(1), 'mine'), 'submission'), 1) > 0,
          'an Executor''s rows carry their Evaluation and their Submission');

-- ------------------------------------------------------- refusals, summary
select throws_ok($$ select * from public.task_list(p_list => 'available', p_finished => true) $$,
                 'PT400', 'invalid_list', 'available has no finished part: PT400 invalid_list');
select is((pg_temp.ml_as(pg_temp.ml_uid(1),
            'select sum(tasks)::int as tasks from public.task_list_summary(''mine'')') -> 0 ->> 'tasks')::int, 6,
          'task_list_summary(mine) counts the Member''s list');

-- --------------------------------------- no organization standing, nothing
select ok(pg_temp.ml_id('t_six') = any(pg_temp.ml_ids(pg_temp.ml_list(pg_temp.ml_uid(6), 'mine'))),
          'mine: an active Member lists their own Task');
update public.profiles set status = 'inactiv' where id = pg_temp.ml_uid(6);
select is(pg_temp.ml_as(pg_temp.ml_uid(6),
            'select id from public.task_list(p_list => ''mine'')
             union all select id from public.task_list(p_list => ''available'')'), '[]'::jsonb,
          'a deactivated Member with stale claims lists nothing: not their own Tasks, not an Opportunity');
select is(pg_temp.ml_as(pg_temp.ml_uid(6), 'select tasks from public.task_list_summary(''mine'')'), '[]'::jsonb,
          'a deactivated Member''s summary of their list is empty');
select pg_temp.test_login(pg_temp.ml_uid(1), '{}'::jsonb);
select is_empty($$ select id from public.task_list(p_list => 'mine')
                   union all select id from public.task_list(p_list => 'available')
                   union all select 0 from public.task_list_summary('mine') $$,
                'a caller without organization claims lists nothing and counts nothing');
select set_config('role', 'none', true);
select pg_temp.test_clear_jwt();

select * from finish();
rollback;
