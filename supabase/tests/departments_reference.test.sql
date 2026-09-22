-- #310: Diverse and Secretariat exist as coordination structures, the
-- legacy 'it' department is gone, and its teams live under Diverse.
-- #215: display name corrected to Educațional.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(11);

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
  -- Not revert-sensitive on its own: the legacy 'it' department was already
  -- kind = 'coordination' in 0001_core_schema.sql, so this count was 5 both
  -- before and after this migration. It still guards against a department
  -- cup that has silently grown or shrunk some other way.
  'department cup still holds exactly five kind=department rows'
);
-- The real guard for #310: diverse and secretariat must never be kind =
-- 'department', or the Department Cup would score coordination structures
-- against the five real departments.
select is(
  (select count(*) from departments where id in ('diverse', 'secretariat') and kind = 'department'),
  0::bigint,
  'diverse and secretariat are coordination structures, not Department Cup entries'
);
-- No row anywhere still points at the retired department.
select is(
  (select count(*) from (
     select dept_id from member_departments where dept_id = 'it'
     union all select dept_id from teams where dept_id = 'it'
     union all select dept_id from announcements where dept_id = 'it'
     -- #345 dropped task_requests, the sixth table #310 had to sweep; #579 dropped the
     -- dept_id columns of tasks, events and completed_work_requests (their Origin is a Group).
     union all select legacy_dept_id from groups where legacy_dept_id = 'it') x),
  0::bigint,
  'nothing references department it'
);
-- #215: the display name carries the comma-below ț (U+021B) that CONTEXT.md
-- and 0001_core_schema.sql's own 'Organizație' use — not the cedilla form —
-- and the stable identifier is untouched.
select is((select name from departments where id = 'edu'), 'Educațional',
  'edu displays as Educațional');
select ok((select position(chr(539) in name) > 0 from departments where id = 'edu'),
  'the ț in Educațional is U+021B (comma below), matching CONTEXT.md');
select is((select count(*) from departments where id = 'edu'), 1::bigint,
  'exactly one edu department, id unchanged');

select * from finish();
rollback;
