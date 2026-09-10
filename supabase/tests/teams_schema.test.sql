-- teams_schema.test.sql — issue #276: Department and Independent Teams.
-- Runs in one transaction and rolls back, leaving the local demo untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(6);

select col_is_null(
  'public', 'teams', 'dept_id',
  'a Team may omit its parent Department');

select lives_ok(
  $$ insert into public.teams (id, name, dept_id)
     values ('team-department-276', 'Department Team #276', 'edu') $$,
  'a Department Team may reference an existing Department');

select lives_ok(
  $$ insert into public.teams (id, name)
     values ('team-independent-276', 'Independent Team #276') $$,
  'an Independent Team may omit a Department');

select is(
  (select dept_id from public.teams where id = 'team-department-276'),
  'edu',
  'a Department Team retains its parent Department');

select is(
  (select dept_id from public.teams where id = 'team-independent-276'),
  null,
  'an Independent Team is distinguished by a null parent Department');

select throws_ok(
  $$ insert into public.teams (id, name, dept_id)
     values ('team-invalid-276', 'Invalid Department Team #276', 'missing-department') $$,
  '23503', null,
  'a Department Team must reference an existing Department');

select * from finish();
rollback;
