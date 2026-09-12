begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(8);

select extensions.dblink_connect('claim_setup_287', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('claim_setup_287', $setup$
  delete from public.tasks where title = 'Concurrent public opportunity 287';
  drop function if exists public.test_claim_result_287(bigint);
  drop function if exists public.test_claim_result_287(bigint, uuid);
  delete from auth.users where id in (
    '28700000-0000-0000-0000-000000000010',
    '28700000-0000-0000-0000-000000000011');
  insert into auth.users (id, email) values
    ('28700000-0000-0000-0000-000000000010', 'claim-race-287@test.local'),
    ('28700000-0000-0000-0000-000000000011', 'claim-outsider-287@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('28700000-0000-0000-0000-000000000010', 'Claim Race 287',
     'claim-race-287@test.local', 'voluntar', 'activ'),
    ('28700000-0000-0000-0000-000000000011', 'Claim Outsider 287',
     'claim-outsider-287@test.local', 'voluntar', 'activ');
  insert into public.tasks
    (title, difficulty, dept_id, status, audience, assignment_mode, created_by)
  values ('Concurrent public opportunity 287', 1, 'edu', 'todo', 'org', 'public',
          '28700000-0000-0000-0000-000000000010');

  create function public.test_claim_result_287(p_task_id bigint, p_actor_id uuid)
  returns text language plpgsql as $function$
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', p_actor_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'member_role', 'voluntar',
        'member_level', 1,
        'dept_ids', jsonb_build_array(),
        'team_ids', jsonb_build_array()
      )
    )::text, true);
    perform public.claim_open_task(p_task_id);
    return 'ok';
  exception when sqlstate 'PT409' then
    return 'PT409';
  end
  $function$;
  grant execute on function public.test_claim_result_287(bigint, uuid) to authenticated;
$setup$);

select pg_temp.test_login(
  '28700000-0000-0000-0000-000000000010',
  jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
                     'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;

create temp table claim_race_287 as
select * from pg_temp.test_race(
  $$ select public.test_claim_result_287(
       (select id from public.tasks where title = 'Concurrent public opportunity 287'),
       '28700000-0000-0000-0000-000000000010') $$,
  $$ select public.test_claim_result_287(
       (select id from public.tasks where title = 'Concurrent public opportunity 287'),
       '28700000-0000-0000-0000-000000000011') $$
);

select is((select result_a from claim_race_287), 'ok',
  'the first concurrent claim succeeds');
select ok((select b_waited from claim_race_287),
  'the second claim waits on the Task row lock');
select is((select result_b from claim_race_287), 'PT409',
  'the waiting claim rechecks fresh state and receives a conflict');
select is((select count(*) from public.task_assignees as assignment
            join public.tasks as task on task.id = assignment.task_id
           where task.title = 'Concurrent public opportunity 287'),
  1::bigint, 'concurrent claims create exactly one assignee');
select is((select format('%s:%s', status, assignment_mode)
            from public.tasks where title = 'Concurrent public opportunity 287'),
  'todo:public', 'claiming preserves todo lifecycle and public Assignment Mode');

select pg_temp.test_login(
  '28700000-0000-0000-0000-000000000010',
  jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
                     'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.tasks
            where title = 'Concurrent public opportunity 287'),
  1::bigint, 'the winning Executor can still read the claimed Task');
reset role;

select pg_temp.test_login(
  '28700000-0000-0000-0000-000000000011',
  jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
                     'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.tasks
            where title = 'Concurrent public opportunity 287'),
  0::bigint, 'an outsider no longer sees the claimed Task as an opportunity');
reset role;

select extensions.dblink_exec('claim_setup_287', $cleanup$
  delete from public.tasks where title = 'Concurrent public opportunity 287';
  drop function public.test_claim_result_287(bigint, uuid);
  delete from auth.users where id in (
    '28700000-0000-0000-0000-000000000010',
    '28700000-0000-0000-0000-000000000011');
$cleanup$);
select extensions.dblink_disconnect('claim_setup_287');

select pass('the concurrency fixtures were cleaned up');
select * from finish();
rollback;
