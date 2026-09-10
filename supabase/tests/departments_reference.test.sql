-- #310: Diverse and Secretariat exist as coordination structures, the
-- legacy 'it' department is gone, and its teams live under Diverse.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(7);

select results_eq(
  $$ select id from departments where kind = 'coordination' order by id $$,
  $$ values ('diverse'), ('secretariat') $$,
  'exactly two coordination structures'
);
select is((select count(*) from departments where id = 'it'), 0::bigint, 'legacy it department removed');
select is((select dept_id from teams where id = 'it'), 'diverse', 'IT team belongs to Diverse');
select is((select dept_id from teams where id = 'interne'), 'diverse', 'Interne team belongs to Diverse');
select is((select is_interne from teams where id = 'interne'), true, 'Interne team is flagged is_interne');
select is(
  (select count(*) from departments where kind = 'department'),
  5::bigint,
  'still exactly five cup departments'
);
-- No row anywhere still points at the retired department.
select is(
  (select count(*) from (
     select dept_id from member_departments where dept_id = 'it'
     union all select dept_id from teams where dept_id = 'it'
     union all select dept_id from tasks where dept_id = 'it'
     union all select dept_id from events where dept_id = 'it'
     union all select dept_id from announcements where dept_id = 'it'
     union all select dept_id from task_requests where dept_id = 'it') x),
  0::bigint,
  'nothing references department it'
);

select * from finish();
rollback;
