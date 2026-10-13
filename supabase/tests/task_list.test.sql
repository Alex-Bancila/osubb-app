-- Task lists that stay fast (spec 2026-10-14): private.task_list_scope decides
-- a list's authority once per Group, with the per-Task rules as its fallback.
--
-- The oracle of every equality below is the rule that already exists:
-- public.my_managed_task_ids() for 'managed' (tasks_read and
-- private.can_manage_task per Task) and `select id from public.tasks` under
-- the caller's own RLS for 'all'. Every caller of the #521 Group matrix, the
-- demo seed's Members, an inactive Member and a claimless one are swept over
-- every Task in the database, the seed's included.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
insert into public.task_assignments(task_id, member_id, assigned_by)
select id, pg_temp.g521_uid(9), pg_temp.g521_uid(1) from g521_tasks where name = 'pv_own';
insert into public.task_candidates(task_id, member_id)
select id, pg_temp.g521_uid(9) from g521_tasks where name = 'pv_candidate';

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
  pg_temp.ids_as(pg_temp.g521_uid(1), $$select task_id from pg_temp.scope_tl('mine')$$),
  '{}'::bigint[],
  'an unknown list is empty');

-- ==================== The search key ====================

select is(
  array[private.fold_search('Ședință'), private.fold_search('ŞEDINŢĂ'),
        private.fold_search('  Înscrieri la Târg '), private.fold_search(null)],
  array['sedinta', 'sedinta', '  inscrieri la targ ', ''],
  'the search key drops case and diacritics, comma-below and cedilla alike');

select * from finish();
rollback;
