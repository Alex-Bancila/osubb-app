-- #1052: Task lists that stay fast (spec 2026-10-14): private.task_list_scope decides
-- a list's authority once per Group, with the per-Task rules as its fallback;
-- public.task_list, task_list_summary, leadership_filter_work and
-- can_manage_task read through it.
--
-- The oracle of every equality below is the rule that already exists:
-- public.my_managed_task_ids() for 'managed' (tasks_read and
-- private.can_manage_task per Task) and `select id from public.tasks` under
-- the caller's own RLS for 'all'. Every caller of the #521 Group matrix, the
-- demo seed's Members, an inactive Member and a claimless one are swept over
-- every Task in the database, the seed's included.
--
-- Mutation record (2026-10-14, each applied to the live database, the suite
-- run, the function restored). Every one fails the assertion named:
--   scope, managed: a listed Group decides every Task; the unassigned
--     shortcut answers for an executed Task; every Group is listed
--     -> "the managed list is exactly my_managed_task_ids()", "a Responsible
--     under a Manager manages ...".
--   scope, all: no per-Task fallback; every Group listed from level 5;
--     offered below level 5 -> "the all list is the Tasks RLS returns ...",
--     "a Private Group's Tasks reach a BCE only through ...".
--   scope: claims not asked -> "a caller without org claims is listed nothing".
--   task_list: p_finished ignored; the Group exact, not the subtree; the
--     Campaign ignored; the range's end inside; an undated Task inside a
--     range; late as any completed Task; raw titles compared; the search
--     as a LIKE pattern; the key dropping only combining marks; Grupuri
--     preferate ignored; every unselected row muting; finished Tasks oldest
--     first; the Executor of a finished Task its latest Assignment whatever
--     ended it; the earliest submission; total counting the page -> each
--     fails the assertion of its own filter, order, page or embed.
--   summary counting every Task; filter work with unevaluated Tasks;
--     can_manage_task true for any readable Task -> their sweeps.
--   scope asked per Task again (managed, all) -> the guard's four timings.
-- One mutation is equivalent by construction and is not a gap: dropping a
-- limb of `whole` (no Manager on the path, the caller a Manager, level 6)
-- changes nothing but speed, because the per-Task fallback answers the same.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(53);

\ir _group_task_fixtures.psql
reset role;

-- A Private Group: #10 is its member, #11 its Responsible; BCE #9 holds
-- nothing there and cannot see it.
insert into public.groups(name, category, application_level, is_private)
values ('Private #TL', 'team', 0, true);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.g521_uid(n), case n when 11 then 'responsible' else 'member' end
  from public.groups as grp cross join (values (10), (11)) as held(n)
 where grp.name = 'Private #TL';

-- A Group whose Minimum Level is above its own Responsible (#10, a
-- Voluntar): managing a Task there implies reading it by position, and the
-- sweeps below hold the scope to that.
-- (The roster refuses a member below the level, so the level is raised after
-- the appointment, as a later change of the Group's setting would leave it.)
insert into public.groups(name, category) values ('MinLevel #TL', 'team');
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.g521_uid(10), 'responsible' from public.groups as grp where grp.name = 'MinLevel #TL';
update public.groups set min_level = 5 where name = 'MinLevel #TL';

-- An inactive BC (stale claims) beside the matrix.
insert into auth.users(id, email)
values ('52100000-0000-0000-0000-000000000099', 'inactive.tl@test.local');
insert into public.profiles(id, full_name, email, role, status)
values ('52100000-0000-0000-0000-000000000099', 'Inactive TL', 'inactive.tl@test.local', 'bc', 'inactiv');

-- The matrix's Tasks: every Executor position the manage rule reads.
select pg_temp.g521_task('p_none', 'project');
select pg_temp.g521_task('p_member', 'project', 5, 'in_progress');
select pg_temp.g521_task('p_resp', 'project', 4, 'in_progress');
select pg_temp.g521_task('p_mgr', 'project', 2, 'in_progress');
select pg_temp.g521_task('p_done', 'project', 5, 'completed');
select pg_temp.g521_task('d_member', 'dept', 5, 'in_progress');
select pg_temp.g521_task('d_none', 'dept');
select pg_temp.g521_task('c_member', 'dt', 8, 'in_review');
select pg_temp.g521_task('i_resp', 'ind', 7, 'in_progress');
select pg_temp.g521_task('i_none', 'ind');
select pg_temp.g521_task('a_none', 'archived');
reset role;
-- In the Private Group: one nobody outside reads, one the BCE executes, one
-- the BCE is a Candidate on.
insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind, queue_opened_at)
select 'Group #521 ' || task.name, grp.id, pg_temp.g521_uid(1), 'todo', 'local', task.mode, 'task',
       case when task.mode = 'public' then now() end
  from public.groups as grp
 cross join (values ('pv_hidden', 'direct'), ('pv_own', 'direct'), ('pv_candidate', 'public')) as task(name, mode)
 where grp.name = 'Private #TL';
insert into g521_tasks
select substr(task.title, 12), task.id from public.tasks as task
 where task.title in ('Group #521 pv_hidden', 'Group #521 pv_own', 'Group #521 pv_candidate');
-- In the Group above its Responsible's level.
insert into public.tasks(title, group_id, created_by, status, audience, assignment_mode, kind)
select 'Group #521 ml_task', grp.id, pg_temp.g521_uid(1), 'todo', 'local', 'direct', 'task'
  from public.groups as grp where grp.name = 'MinLevel #TL';
insert into g521_tasks
select 'ml_task', task.id from public.tasks as task where task.title = 'Group #521 ml_task';
insert into public.task_assignments(task_id, member_id, assigned_by)
select id, pg_temp.g521_uid(9), pg_temp.g521_uid(1) from g521_tasks where name = 'pv_own';
insert into public.task_candidates(task_id, member_id)
select id, pg_temp.g521_uid(9) from g521_tasks where name = 'pv_candidate';

-- The filter fixtures: a Group and a Child Group of their own, managed by
-- BCE #9, so every filter, order and page below is asked of exactly these
-- seven Tasks.
insert into public.groups(name, category, application_level) values ('TL Root', 'department', 0);
insert into public.groups(name, category, parent_id, application_level)
select 'TL Child', 'team', id, 0 from public.groups where name = 'TL Root';
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.g521_uid(9), 'manager' from public.groups where name = 'TL Root';
insert into public.campaigns(name, group_id, created_by)
select 'Campanie TL', id, pg_temp.g521_uid(1) from public.groups where name = 'TL Root';

create function pg_temp.gid_tl(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.at_tl(p_day text) returns timestamptz language sql immutable as $$
  select (p_day || ' 12:00')::timestamp at time zone 'Europe/Bucharest'
$$;
create function pg_temp.task_tl(
  p_title text, p_group text, p_status public.task_status,
  p_deadline timestamptz default null, p_done timestamptz default null, p_campaign boolean default false)
returns bigint language sql as $$
  insert into public.tasks(title, group_id, created_by, created_at, status, audience, assignment_mode, kind,
                           deadline, completed_at, unfulfilled_at, cancelled_at, cancel_reason,
                           difficulty, rating, campaign_id)
  values (p_title, pg_temp.gid_tl(p_group), pg_temp.g521_uid(1), pg_temp.at_tl('2026-01-01'), p_status,
          'local', 'direct', 'task', p_deadline,
          case when p_status = 'completed' then p_done end,
          case when p_status = 'unfulfilled' then p_done end,
          case when p_status = 'cancelled' then p_done end,
          case when p_status = 'cancelled' then 'fixture' end,
          case when p_status in ('completed', 'unfulfilled') then 3 end,
          case when p_status in ('completed', 'unfulfilled') then 3 end,
          case when p_campaign then (select id from public.campaigns where name = 'Campanie TL') end)
  returning id
$$;
create function pg_temp.tid_tl(p_title text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
grant execute on function pg_temp.gid_tl(text) to authenticated;
grant execute on function pg_temp.at_tl(text) to authenticated;
grant execute on function pg_temp.tid_tl(text) to authenticated;

-- In id order: the finished ones' undated pair ends as (Ziar, Banner).
select pg_temp.task_tl('TL Ședință generală', 'TL Child', 'completed', pg_temp.at_tl('2026-03-10'), pg_temp.at_tl('2026-03-09'), true);
select pg_temp.task_tl('TL sedinta de lucru', 'TL Child', 'completed', pg_temp.at_tl('2026-03-12'), pg_temp.at_tl('2026-03-13'));
select pg_temp.task_tl('TL Afiș', 'TL Root', 'unfulfilled', pg_temp.at_tl('2026-04-01'), pg_temp.at_tl('2026-04-02'));
select pg_temp.task_tl('TL Banner', 'TL Root', 'cancelled', null, pg_temp.at_tl('2026-04-03'));
select pg_temp.task_tl('TL Ziar', 'TL Root', 'completed', null, pg_temp.at_tl('2026-04-04'));
select pg_temp.task_tl('TL Atelier', 'TL Child', 'in_progress', pg_temp.at_tl('2026-05-01'));
select pg_temp.task_tl('TL Zid', 'TL Root', 'todo');

-- Assignment History: an open Executor, the Member who finished, a Member
-- who gave up before the one who failed, a cancelled Task's last holder, a
-- row that ended after the completing one.
insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
values
  (pg_temp.tid_tl('TL Atelier'), pg_temp.g521_uid(8), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), null, null),
  (pg_temp.tid_tl('TL Ședință generală'), pg_temp.g521_uid(5), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-03-09'), 'completed'),
  (pg_temp.tid_tl('TL sedinta de lucru'), pg_temp.g521_uid(5), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-03-13'), 'completed'),
  (pg_temp.tid_tl('TL Afiș'), pg_temp.g521_uid(8), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-02-10'), 'gave_up'),
  (pg_temp.tid_tl('TL Afiș'), pg_temp.g521_uid(5), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-11'), pg_temp.at_tl('2026-04-02'), 'failed'),
  (pg_temp.tid_tl('TL Banner'), pg_temp.g521_uid(5), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-04-03'), 'cancelled'),
  -- The Member who finished is not the last row of the history.
  (pg_temp.tid_tl('TL Ziar'), pg_temp.g521_uid(5), pg_temp.g521_uid(9), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-04-04'), 'completed'),
  (pg_temp.tid_tl('TL Ziar'), pg_temp.g521_uid(8), pg_temp.g521_uid(9), pg_temp.at_tl('2026-04-04'), pg_temp.at_tl('2026-04-05'), 'task_updated');
-- Evaluations: one standing, one reversed.
select pg_temp.test_credit_task(pg_temp.tid_tl('TL Ședință generală'), pg_temp.g521_uid(5), pg_temp.g521_uid(9));
select pg_temp.test_credit_task(pg_temp.tid_tl('TL sedinta de lucru'), pg_temp.g521_uid(5), pg_temp.g521_uid(9));
select pg_temp.test_reverse_award(pg_temp.tid_tl('TL sedinta de lucru'), pg_temp.g521_uid(5), now());
-- Two submissions: only the later one is the Submission Note.
insert into public.task_activity(task_id, kind, actor_id, note, details, occurred_at)
values
  (pg_temp.tid_tl('TL Atelier'), 'submitted', pg_temp.g521_uid(8), 'prima predare', '{}', pg_temp.at_tl('2026-04-10')),
  (pg_temp.tid_tl('TL Atelier'), 'submitted', pg_temp.g521_uid(8), 'a doua predare',
   '{"link_label": "Dosar", "link_url": "https://example.test/dosar"}', pg_temp.at_tl('2026-04-12'));
-- Grupuri preferate: BC #1 unselected the Child Group; BCE #9 did too, but
-- holds a position above it, so that row is never read.
insert into public.member_group_unselected(member_id, group_id)
values (pg_temp.g521_uid(1), pg_temp.gid_tl('TL Child')), (pg_temp.g521_uid(9), pg_temp.gid_tl('TL Child'));

-- The scope, read as the caller. It is private; a definer wrapper is the
-- only way a test under `authenticated` reaches it.
create function pg_temp.scope_tl(p_list text) returns table(task_id bigint)
language sql stable security definer set search_path = '' as $$
  select scope.task_id from private.task_list_scope(p_list) as scope
$$;
grant execute on function pg_temp.scope_tl(text) to authenticated;

-- Ids a statement returns to a caller: logs in with the Member's live claims
-- (or the given ones), runs it, logs out.
create function pg_temp.ids_as(p_uid uuid, p_sql text, p_claims jsonb default null)
returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  if p_claims is null then
    perform pg_temp.test_login_leadership(p_uid);
  else
    perform pg_temp.test_login(p_uid, p_claims);
  end if;
  execute format('select coalesce(array_agg(x order by x), ''{}'') from (%s) as q(x)', p_sql) into v_ids;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

-- A count a statement returns to a caller.
create function pg_temp.count_as(p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform pg_temp.test_login_leadership(p_uid);
  execute p_sql into v_count;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_count;
end;
$$;
-- The texts a statement returns to a caller, in the statement's own order.
create function pg_temp.texts_as(p_uid uuid, p_sql text) returns text[] language plpgsql as $$
declare
  v_texts text[];
begin
  perform pg_temp.test_login_leadership(p_uid);
  execute format(
    'select coalesce(array_agg(x order by n), ''{}'') from (select x, row_number() over () as n from (%s) as q(x)) as numbered',
    p_sql) into v_texts;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_texts;
end;
$$;
-- The filter fixtures' titles a task_list call returns to BCE #9, without
-- their "TL " prefix. `p_args` are the call's named arguments after p_list.
create function pg_temp.listed_tl(p_args text default '') returns text[] language sql as $$
  select pg_temp.texts_as(pg_temp.g521_uid(9), format(
    'select substr(title, 4) from public.task_list(p_list => ''managed'', p_group_id => %s%s)',
    pg_temp.gid_tl('TL Root'), case when p_args = '' then '' else ', ' || p_args end))
$$;
-- The reason a statement is refused with, as BCE #9 (null when it is not).
create function pg_temp.reason_tl(p_sql text) returns text language plpgsql as $$
declare
  v_state text;
  v_message text;
begin
  perform pg_temp.test_login_leadership(pg_temp.g521_uid(9));
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_state || ' ' || v_message;
end;
$$;

-- Every caller the sweeps use: the #521 matrix and the demo seed's Members.
create temp table callers_tl as
select profile.id, profile.email, role.level
  from public.profiles as profile
  join public.roles as role on role.id = profile.role
 where profile.email like 'member.%.521@test.local'
    or profile.email like '%@demo.osubb';
grant select on callers_tl to authenticated;

-- ==================== Shape ====================

select ok((select prosecdef from pg_proc where oid = 'private.task_list_scope(text)'::regprocedure),
  'the scope runs with definer rights: it reads every Group and Task to decide');
select ok(not has_function_privilege('authenticated', 'private.task_list_scope(text)', 'execute')
      and not has_function_privilege('anon', 'private.task_list_scope(text)', 'execute')
      and not has_function_privilege('service_role', 'private.task_list_scope(text)', 'execute'),
  'no client role calls the scope');

-- ==================== 'managed' is my_managed_task_ids() ====================

select is(
  (select count(*) from callers_tl as caller
    where pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('managed')$$)
          is distinct from
          pg_temp.ids_as(caller.id, $$select task_id from public.my_managed_task_ids()$$)),
  0::bigint,
  'for every caller the managed list is exactly my_managed_task_ids()');
select cmp_ok(
  (select count(*) from callers_tl as caller
    where cardinality(pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('managed')$$)) > 0),
  '>=', 6::bigint,
  'the sweep is not vacuous: BC, the Moderator, Managers and Responsibles each manage Tasks');
-- The rows the shortcuts must not decide.
select is(
  pg_temp.ids_as(pg_temp.g521_uid(3), $$select scope.task_id from pg_temp.scope_tl('managed') as scope
      join g521_tasks as fixture on fixture.id = scope.task_id$$),
  (select array_agg(id order by id) from g521_tasks where name in ('p_none', 'p_member', 'p_done')),
  'a Responsible under a Manager manages the Tasks no Manager or Responsible executes, and the unassigned and finished ones');
select is(
  pg_temp.ids_as(pg_temp.g521_uid(6), $$select scope.task_id from pg_temp.scope_tl('managed') as scope
      join g521_tasks as fixture on fixture.id = scope.task_id$$),
  (select array_agg(id order by id) from g521_tasks where name in ('i_resp', 'i_none')),
  'peers with no Manager above them manage each other''s Tasks');
select is(
  pg_temp.ids_as(pg_temp.g521_uid(2), $$select scope.task_id from pg_temp.scope_tl('managed') as scope
      join g521_tasks as fixture on fixture.id = scope.task_id$$),
  (select array_agg(id order by id) from g521_tasks where name like 'p\_%'),
  'a Group Manager manages every Task of the Group, and none of the archived one');

select is(
  pg_temp.ids_as(pg_temp.g521_uid(10), $$select scope.task_id from pg_temp.scope_tl('managed') as scope
      join g521_tasks as fixture on fixture.id = scope.task_id$$),
  (select array_agg(id order by id) from g521_tasks where name = 'ml_task'),
  'a Responsible below their Group''s Minimum Level manages its Tasks, as my_managed_task_ids() says');

-- ==================== 'all' is what tasks_read returns ====================

select is(
  (select count(*) from callers_tl as caller
    where pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('all')$$)
          is distinct from
          case when caller.level >= 5
               then pg_temp.ids_as(caller.id, $$select id from public.tasks$$)
               else '{}'::bigint[] end),
  0::bigint,
  'for every caller the all list is the Tasks RLS returns from level 5 up, and nothing below');
select is(
  pg_temp.ids_as(pg_temp.g521_uid(9), $$select scope.task_id from pg_temp.scope_tl('all') as scope
      join g521_tasks as fixture on fixture.id = scope.task_id where fixture.name like 'pv\_%'$$),
  (select array_agg(id order by id) from g521_tasks where name in ('pv_own', 'pv_candidate')),
  'a Private Group''s Tasks reach a BCE only through their own Assignment or Candidature');

-- ==================== Nobody else ====================

select is(
  pg_temp.ids_as('52100000-0000-0000-0000-000000000099', $$select task_id from pg_temp.scope_tl('managed')
      union all select task_id from pg_temp.scope_tl('all')$$),
  '{}'::bigint[],
  'an inactive BC with stale claims is listed nothing');
select is(
  pg_temp.ids_as(pg_temp.g521_uid(1), $$select task_id from pg_temp.scope_tl('managed')
      union all select task_id from pg_temp.scope_tl('all')$$, '{}'::jsonb),
  '{}'::bigint[],
  'a caller without org claims is listed nothing');
select is(
  pg_temp.ids_as(pg_temp.g521_uid(1), $$select task_id from pg_temp.scope_tl('nope')$$),
  '{}'::bigint[],
  'an unknown list is empty');

-- ==================== task_list: shape and refusals ====================

select ok(not (select prosecdef from pg_proc where proname = 'task_list' and pronamespace = 'public'::regnamespace)
      and (select prosecdef from pg_proc where proname = 'task_list_impl' and pronamespace = 'private'::regnamespace),
  'task_list is an invoker wrapper over a definer body');
select ok(has_function_privilege('authenticated', 'public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)', 'execute')
      and not has_function_privilege('service_role', 'public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)', 'execute')
      and not has_function_privilege('authenticated', 'private.require_task_list_args(text, boolean, text, text, integer, integer)', 'execute'),
  'only a signed-in Member calls task_list');
select is(
  array[
    pg_temp.reason_tl($$select * from public.task_list('nope')$$),
    pg_temp.reason_tl($$select * from public.task_list(null)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_state => 'todo')$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_sort => 'points')$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_sort => null)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_limit => 0)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_limit => 501)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_limit => null)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_offset => -1)$$),
    pg_temp.reason_tl($$select * from public.task_list('managed', p_from => now(), p_to => now() - interval '1 day')$$)],
  array['PT400 invalid_list', 'PT400 invalid_list', 'PT400 invalid_state', 'PT400 invalid_sort', 'PT400 invalid_sort',
        'PT400 invalid_page', 'PT400 invalid_page', 'PT400 invalid_page', 'PT400 invalid_page',
        'PT400 invalid_date_range'],
  'a malformed call is refused with its reason');

-- ==================== task_list: the rows ====================

select is(
  (select count(*) from callers_tl as caller
    where pg_temp.ids_as(caller.id, $$select id from public.task_list('managed')$$)
          is distinct from pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('managed')$$)
       or pg_temp.ids_as(caller.id, $$select id from public.task_list('all')$$)
          is distinct from pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('all')$$)),
  0::bigint,
  'for every caller task_list returns the scope, each Task once');
select is(
  pg_temp.ids_as('52100000-0000-0000-0000-000000000099', $$select id from public.task_list('managed')
      union all select id from public.task_list('all')$$)
  || pg_temp.ids_as(pg_temp.g521_uid(1), $$select id from public.task_list('managed')$$, '{}'::jsonb),
  '{}'::bigint[],
  'an inactive or claimless caller gets no rows and no error');
select is(
  pg_temp.count_as(pg_temp.g521_uid(1), $$
    select count(*) from public.task_list('managed') as listed
      join public.tasks as task on task.id = listed.id
     where (listed.group_id, listed.title, listed.description, listed.status, listed.deadline, listed.completed_at,
            listed.review_round, listed.assignment_mode, listed.audience, listed.kind, listed.parent_task_id,
            listed.campaign_id, listed.duplicated_from_task_id, listed.queue_closed_at, listed.links)
           is not distinct from
           (task.group_id, task.title, task.description, task.status, task.deadline, task.completed_at,
            task.review_round, task.assignment_mode, task.audience, task.kind, task.parent_task_id,
            task.campaign_id, task.duplicated_from_task_id, task.queue_closed_at, task.links)$$),
  (select count(*) from public.tasks),
  'BC is listed every Task, each row carrying its own columns');

-- The history a row carries is what RLS gives that caller, and its Executor
-- is visible_task_executors' answer. Counted over every row of every list a
-- Manager, a Responsible, a BCE, BC and the Moderator have.
create function pg_temp.embed_differences_tl(p_uid uuid, p_list text) returns bigint language sql as $$
  select pg_temp.count_as(p_uid, format($sql$
    select count(*) from public.task_list(%1$L) as listed
     where listed.assignments is distinct from coalesce((
             select jsonb_agg(jsonb_build_object('id', held.id, 'member_id', held.member_id, 'ended_at', held.ended_at) order by held.id)
               from public.task_assignments as held where held.task_id = listed.id), '[]'::jsonb)
        or listed.evaluations is distinct from coalesce((
             select jsonb_agg(jsonb_build_object('id', evaluation.id, 'difficulty', evaluation.difficulty, 'rating', evaluation.rating,
                                                 'points', evaluation.points, 'reversed_at', evaluation.reversed_at) order by evaluation.id)
               from public.task_evaluations as evaluation where evaluation.task_id = listed.id), '[]'::jsonb)
        or listed.submission is distinct from coalesce((
             select jsonb_build_array(jsonb_build_object('id', event.id, 'kind', event.kind, 'note', event.note,
                                                         'details', event.details, 'occurred_at', event.occurred_at))
               from public.task_activity as event
              where event.task_id = listed.id and event.kind = 'submitted'
              order by event.id desc limit 1), '[]'::jsonb)
        or listed.executor is distinct from (
             select jsonb_build_object('member_id', executor.member_id, 'full_name', executor.full_name,
                                       'nickname', executor.nickname, 'is_current', executor.is_current)
               from public.visible_task_executors((select array_agg(every.id) from public.task_list(%1$L) as every)) as executor
              where executor.task_id = listed.id)
  $sql$, p_list))
$$;
select is(
  array[pg_temp.embed_differences_tl(pg_temp.g521_uid(1), 'managed'),
        pg_temp.embed_differences_tl(pg_temp.g521_uid(2), 'managed'),
        pg_temp.embed_differences_tl(pg_temp.g521_uid(3), 'managed'),
        pg_temp.embed_differences_tl(pg_temp.g521_uid(9), 'managed'),
        pg_temp.embed_differences_tl(pg_temp.g521_uid(9), 'all'),
        pg_temp.embed_differences_tl((select id from public.profiles where email = 'moderator@demo.osubb'), 'managed')],
  array[0, 0, 0, 0, 0, 0]::bigint[],
  'a row''s Assignments, Evaluations, Submission Note and Executor are what RLS and visible_task_executors give the caller');
select is(
  pg_temp.texts_as(pg_temp.g521_uid(9), format($$
    select concat_ws(' | ', substr(title, 4),
             jsonb_array_length(assignments), jsonb_array_length(evaluations),
             coalesce(submission -> 0 ->> 'note', '-'),
             coalesce(executor ->> 'member_id', '-'), coalesce(executor ->> 'is_current', '-'),
             coalesce((select count(*) from jsonb_array_elements(evaluations) as item
                        where item ->> 'reversed_at' is not null)::text, '0'))
      from public.task_list('managed', p_group_id => %s, p_sort => 'title')$$, pg_temp.gid_tl('TL Root'))),
  array[
    'Atelier | 1 | 0 | a doua predare | ' || pg_temp.g521_uid(8) || ' | true | 0',
    'Zid | 0 | 0 | - | - | - | 0',
    'Afiș | 2 | 0 | - | ' || pg_temp.g521_uid(5) || ' | false | 0',
    'Banner | 1 | 0 | - | - | - | 0',
    'sedinta de lucru | 1 | 1 | - | ' || pg_temp.g521_uid(5) || ' | false | 1',
    'Ședință generală | 1 | 1 | - | ' || pg_temp.g521_uid(5) || ' | false | 0',
    'Ziar | 2 | 0 | - | ' || pg_temp.g521_uid(5) || ' | false | 0'],
  'the latest submission, the Member who finished, no Executor for a cancelled Task, a reversed Evaluation kept');

-- ==================== task_list: filters, order, pages ====================

select is(pg_temp.listed_tl(),
  array['Atelier', 'Zid', 'Afiș', 'sedinta de lucru', 'Ședință generală', 'Ziar', 'Banner'],
  'open Tasks first by deadline, then finished ones newest deadline first, undated last');
select is(pg_temp.listed_tl($$p_sort => 'title'$$),
  array['Atelier', 'Zid', 'Afiș', 'Banner', 'sedinta de lucru', 'Ședință generală', 'Ziar'],
  'by title inside each part, in Romanian order');
select is(
  array[pg_temp.listed_tl('p_finished => false') = array['Atelier', 'Zid'],
        pg_temp.listed_tl('p_finished => true') = array['Afiș', 'sedinta de lucru', 'Ședință generală', 'Ziar', 'Banner']],
  array[true, true],
  'p_finished keeps the open part or the finished part');
select is(
  pg_temp.texts_as(pg_temp.g521_uid(9), format(
    $$select substr(title, 4) from public.task_list('managed', p_group_id => %s)$$, pg_temp.gid_tl('TL Child'))),
  array['Atelier', 'sedinta de lucru', 'Ședință generală'],
  'a Group means that Group and the Groups below it: the Child Group alone leaves the parent''s Tasks out');
select is(pg_temp.listed_tl(format('p_campaign_id => %s', (select id from public.campaigns where name = 'Campanie TL'))),
  array['Ședință generală'],
  'the Campaign is exact');
select is(pg_temp.listed_tl(format('p_from => %L, p_to => %L', pg_temp.at_tl('2026-03-10'), pg_temp.at_tl('2026-03-12'))),
  array['Ședință generală'],
  'the range reads the deadline, its start inside and its end outside');
select is(pg_temp.listed_tl(format('p_from => %L', pg_temp.at_tl('2026-04-01'))),
  array['Atelier', 'Afiș'],
  'one bound is enough, and an undated Task is outside any range');
select is(
  array[pg_temp.listed_tl($$p_state => 'completed'$$) = array['sedinta de lucru', 'Ședință generală', 'Ziar'],
        pg_temp.listed_tl($$p_state => 'late'$$) = array['sedinta de lucru'],
        pg_temp.listed_tl($$p_state => 'unfulfilled'$$) = array['Afiș'],
        pg_temp.listed_tl($$p_state => 'cancelled'$$) = array['Banner']],
  array[true, true, true, true],
  'each finished state, and late as completed after the deadline');
select is(
  array[pg_temp.listed_tl($$p_search => 'SEDINTA'$$) = array['sedinta de lucru', 'Ședință generală'],
        pg_temp.listed_tl($$p_search => ' afiș '$$) = array['Afiș'],
        pg_temp.listed_tl($$p_search => 'xyz'$$) = '{}'::text[],
        cardinality(pg_temp.listed_tl($$p_search => '   '$$)) = 7,
        -- % and _ are characters of a title, never wildcards.
        pg_temp.listed_tl($$p_search => '%'$$) = '{}'::text[],
        pg_temp.listed_tl($$p_search => 'sedin_a'$$) = '{}'::text[]],
  array[true, true, true, true, true, true],
  'the search ignores case, diacritics and the spaces around it; a blank one matches all; % and _ match only themselves');
select is(
  array[
    cardinality(pg_temp.listed_tl('p_preferred => true')) = 7,
    pg_temp.texts_as(pg_temp.g521_uid(1), format(
      $$select substr(title, 4) from public.task_list('managed', p_group_id => %s, p_preferred => true)$$, pg_temp.gid_tl('TL Root')))
      = array['Zid', 'Afiș', 'Ziar', 'Banner'],
    cardinality(pg_temp.texts_as(pg_temp.g521_uid(1), format(
      $$select substr(title, 4) from public.task_list('managed', p_group_id => %s)$$, pg_temp.gid_tl('TL Root')))) = 7],
  array[true, true, true],
  'Grupuri preferate leaves out an unselected Group, never one the caller holds a position above, and only when asked');
select is(
  array[pg_temp.listed_tl('p_finished => true, p_limit => 2') = array['Afiș', 'sedinta de lucru'],
        pg_temp.listed_tl('p_finished => true, p_limit => 2, p_offset => 2') = array['Ședință generală', 'Ziar'],
        pg_temp.listed_tl('p_finished => true, p_limit => 2, p_offset => 4') = array['Banner'],
        pg_temp.listed_tl('p_finished => true, p_limit => 2, p_offset => 6') = '{}'::text[]],
  array[true, true, true, true],
  'pages are disjoint, in order, and cover the list');
select is(
  pg_temp.texts_as(pg_temp.g521_uid(9), format($$
    select distinct total::text from public.task_list('managed', p_group_id => %1$s, p_finished => true, p_limit => 2, p_offset => 2)
    union all select distinct total::text from public.task_list('managed', p_group_id => %1$s)$$, pg_temp.gid_tl('TL Root'))),
  array['5', '7'],
  'total counts what the filters match, whatever the page');

-- ==================== task_list_summary ====================

select ok(not (select prosecdef from pg_proc where oid = 'public.task_list_summary(text)'::regprocedure)
      and not (select prosecdef from pg_proc where oid = 'public.leadership_filter_work()'::regprocedure)
      and not (select prosecdef from pg_proc where oid = 'public.can_manage_task(bigint)'::regprocedure)
      and has_function_privilege('authenticated', 'public.task_list_summary(text)', 'execute')
      and has_function_privilege('authenticated', 'public.leadership_filter_work()', 'execute')
      and has_function_privilege('authenticated', 'public.can_manage_task(bigint)', 'execute')
      and not has_function_privilege('anon', 'public.task_list_summary(text)', 'execute')
      and not has_function_privilege('anon', 'public.leadership_filter_work()', 'execute')
      and not has_function_privilege('anon', 'public.can_manage_task(bigint)', 'execute')
      and not has_function_privilege('service_role', 'public.task_list_summary(text)', 'execute')
      and not has_function_privilege('service_role', 'public.leadership_filter_work()', 'execute')
      and not has_function_privilege('service_role', 'public.can_manage_task(bigint)', 'execute'),
  'the summary, the leadership filter work and the per-Task capability are invoker reads for a signed-in Member');
select is(
  pg_temp.texts_as(pg_temp.g521_uid(9), format($$
    select line from (
      select concat_ws(' | ', grp.name, coalesce(campaign.name, '-'), summary.status, summary.late::text, summary.dated::text, summary.tasks) as line
        from public.task_list_summary('managed') as summary
        join public.groups as grp on grp.id = summary.group_id
        left join public.campaigns as campaign on campaign.id = summary.campaign_id
       where grp.name like 'TL %%') as lines
     order by line collate "C"$$)),
  array['TL Child | - | completed | true | true | 1',
        'TL Child | - | in_progress | false | true | 1',
        'TL Child | Campanie TL | completed | false | true | 1',
        'TL Root | - | cancelled | false | false | 1',
        'TL Root | - | completed | false | false | 1',
        'TL Root | - | todo | false | false | 1',
        'TL Root | - | unfulfilled | false | true | 1'],
  'the summary counts a list by Group, Campaign, status, lateness and whether a deadline is set');
select is(
  (select count(*) from callers_tl as caller
    where pg_temp.count_as(caller.id, $$select coalesce(sum(tasks), 0)::bigint from public.task_list_summary('managed')$$)
          is distinct from cardinality(pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('managed')$$))
       or pg_temp.count_as(caller.id, $$select coalesce(sum(tasks), 0)::bigint from public.task_list_summary('all')$$)
          is distinct from cardinality(pg_temp.ids_as(caller.id, $$select task_id from pg_temp.scope_tl('all')$$))),
  0::bigint,
  'for every caller the summary counts exactly the list');
select is(pg_temp.reason_tl($$select * from public.task_list_summary('nope')$$), 'PT400 invalid_list',
  'the summary refuses an unknown list');

-- ==================== leadership_filter_work ====================

-- An evaluated Task inside the Private Group: BC reads it, BCE #9 does not.
select pg_temp.task_tl('TL secret', 'Private #TL', 'completed', pg_temp.at_tl('2026-03-20'), pg_temp.at_tl('2026-03-19'));
insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
values (pg_temp.tid_tl('TL secret'), pg_temp.g521_uid(10), pg_temp.g521_uid(1), pg_temp.at_tl('2026-02-01'), pg_temp.at_tl('2026-03-19'), 'completed');
select pg_temp.test_credit_task(pg_temp.tid_tl('TL secret'), pg_temp.g521_uid(10), pg_temp.g521_uid(1));

select is(
  (select count(*) from callers_tl as caller
    where pg_temp.texts_as(caller.id, $$select group_id || '/' || coalesce(campaign_id::text, '-')
                                          from public.leadership_filter_work() order by 1$$)
          is distinct from
          case when caller.level >= 5 then
            pg_temp.texts_as(caller.id, $$
              select pair from (
                select distinct task.group_id || '/' || coalesce(task.campaign_id::text, '-') as pair
                  from public.tasks as task
                 where task.kind = 'task'
                   and exists (select 1 from public.task_assignments as held
                                 join public.task_evaluations as evaluation on evaluation.assignment_id = held.id
                                where held.task_id = task.id)) as pairs
               order by 1$$)
          else '{}'::text[] end),
  0::bigint,
  'for every caller the leadership filter work is the Group and Campaign of the evaluated Tasks RLS returns, from level 5 up');
select is(
  array[
    pg_temp.gid_tl('Private #TL') || '/-' = any(pg_temp.texts_as(pg_temp.g521_uid(1),
      $$select group_id || '/' || coalesce(campaign_id::text, '-') from public.leadership_filter_work()$$)),
    pg_temp.gid_tl('Private #TL') || '/-' = any(pg_temp.texts_as(pg_temp.g521_uid(9),
      $$select group_id || '/' || coalesce(campaign_id::text, '-') from public.leadership_filter_work()$$)),
    pg_temp.gid_tl('TL Child') || '/' || (select id from public.campaigns where name = 'Campanie TL') = any(pg_temp.texts_as(pg_temp.g521_uid(9),
      $$select group_id || '/' || coalesce(campaign_id::text, '-') from public.leadership_filter_work()$$)),
    pg_temp.gid_tl('TL Root') || '/-' = any(pg_temp.texts_as(pg_temp.g521_uid(9),
      $$select group_id || '/' || coalesce(campaign_id::text, '-') from public.leadership_filter_work()$$))],
  array[true, false, true, false],
  'a Private Group''s evaluated Task is offered to BC and not to an outsider; a Group with no evaluated Task is not offered');

-- ==================== can_manage_task ====================

select is(
  (select count(*) from callers_tl as caller
    where pg_temp.count_as(caller.id, $$
      select count(*) from g521_tasks as fixture
       where public.can_manage_task(fixture.id)
             is distinct from exists (select 1 from public.my_managed_task_ids() as managed
                                       where managed.task_id = fixture.id)$$) <> 0),
  0::bigint,
  'for every caller can_manage_task says of one Task what the managed list says');
select is(pg_temp.count_as(pg_temp.g521_uid(1), $$select count(*) from (select public.can_manage_task(-1) as yes) as answer where yes$$),
  0::bigint, 'an unknown Task is not manageable');
set local role anon;
select throws_ok('select public.can_manage_task(1)', '42501', null, 'anon cannot ask the capability');
reset role;

-- ==================== The search key ====================

select is(
  array[private.fold_search('Ședință'), private.fold_search('ŞEDINŢĂ'),
        private.fold_search('  Înscrieri la Târg '), private.fold_search(null)],
  array['sedinta', 'sedinta', '  inscrieri la targ ', ''],
  'the search key drops case and diacritics, comma-below and cedilla alike');
-- The page folds a title with JavaScript's \p{Diacritic}, which also drops
-- the spacing marks; the same strings are pinned to the same keys in
-- app/src/screens/tracker/manager-task-list.test.ts.
select is(
  array[private.fold_search('Afiș · v2^'), private.fold_search('a`b¨c¯d´e¸f'),
        private.fold_search('Ziua 100% _liberă_')],
  array['afis  v2', 'abcdef', 'ziua 100% _libera_'],
  'the search key drops the spacing marks the page drops, and keeps % and _ as they are');

-- ==================== The guard: a list never asks per Task ====================
--
-- 6 000 finished Tasks in the Group where #3 is a Responsible under a Manager
-- -- the caller the shortcuts cannot decide by level. Measured locally: a page
-- 40 ms, the summary 15 ms, the filter work 12 ms; the per-Task rule they
-- replace, my_managed_task_ids(), 7.8 s on the same rows. The bound sits
-- between the two with room on both sides for a slower machine.

reset role;
with made as (
  insert into public.tasks(title, group_id, created_by, created_at, status, audience, assignment_mode, kind,
                           deadline, completed_at, difficulty, rating)
  select 'Guard TL ' || n, pg_temp.gid_tl('Project #521'), pg_temp.g521_uid(1),
         pg_temp.at_tl('2026-01-01'), 'completed', 'local', 'direct', 'task',
         pg_temp.at_tl('2026-02-01') + n * interval '1 hour', pg_temp.at_tl('2026-02-01') + n * interval '1 hour', 3, 3
    from generate_series(1, 6000) as n
  returning id, completed_at
),
held as (
  insert into public.task_assignments(task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
  select made.id, pg_temp.g521_uid(5), pg_temp.g521_uid(1), pg_temp.at_tl('2026-01-02'), made.completed_at, 'completed'
    from made
  returning id, task_id, ended_at
)
insert into public.task_evaluations(task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at)
select held.task_id, held.id, pg_temp.g521_uid(1), 'completed', 3, 3, 3, 'guard', held.ended_at from held;
analyze public.tasks;
analyze public.task_assignments;
analyze public.task_evaluations;

select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select cmp_ok((select max(total) from public.task_list('managed', p_finished => true, p_limit => 50)), '>=', 6000::bigint,
  'the guard''s Tasks are in the Responsible''s list');
select performs_ok($$select * from public.task_list('managed', p_finished => true, p_limit => 50, p_offset => 3000)$$, 750,
  'a page of 6 000 managed Tasks answers without asking per Task');
select performs_ok($$select * from public.task_list_summary('managed')$$, 750,
  'the summary of 6 000 managed Tasks answers without asking per Task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(9));
select performs_ok($$select * from public.task_list('all', p_finished => true, p_limit => 50)$$, 750,
  'a page of every Task answers without asking per Task');
select performs_ok($$select * from public.leadership_filter_work()$$, 750,
  'the leadership filter work answers without reading every evaluated Task through RLS');
reset role;
-- The Member's lists (spec 2026-10-14 member reads): the Executor of the
-- 6 000, a Volunteer -- the caller the managed set and the per-row
-- embeds are decided for.
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select performs_ok($$select * from public.task_list('mine', p_finished => true, p_limit => 50, p_offset => 3000)$$, 750,
  'a page of a Member''s 6 000 Tasks answers without asking per Task');
select performs_ok($$select * from public.task_list_summary('mine')$$, 750,
  'the summary of a Member''s 6 000 Tasks answers without asking per Task');
select performs_ok($$select * from public.task_list('available')$$, 750,
  'Disponibile answers beside 6 000 Tasks the Member reads');
reset role;

-- R57: a list row carries the Task's own Minimum Level, so an edit opened
-- from it prefills the real Role.
insert into public.tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level)
values ('TL Role #57', pg_temp.gid_tl('TL Root'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 2);
select is(pg_temp.texts_as(pg_temp.g521_uid(9),
  'select min_level::text from public.task_list(p_list => ''all'') where title = ''TL Role #57'''),
  array['2'], 'a list row carries the Task''s Minimum Level (R57)');

select * from finish();
rollback;
