-- R57 (Alex, 2026-10-14): a public Task's Minimum Level -- the lowest Level
-- that sees it as an Opportunity or through Shared Work Visibility and may join
-- its Candidate Queue. Never a gate on a Group Role on the path, BCE and above,
-- or one's own history. Spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.m(n integer) returns uuid language sql immutable as $$
  select ('57100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- 1 recrut, 2 voluntar, 3 activ, 4 bc, 5 activ (Manager), 6 recrut (Responsible),
-- 7 voluntar and 8 recrut (Shared Work Visibility), 9 recrut (nothing to do with it).
insert into auth.users(id, email)
select pg_temp.m(n), 'level.' || n || '.57@test.local' from generate_series(1, 9) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.m(n), 'Level #57 ' || n, 'level.' || n || '.57@test.local',
       (case n when 1 then 'recrut' when 2 then 'voluntar' when 3 then 'activ' when 4 then 'bc'
               when 5 then 'activ' when 6 then 'recrut' when 7 then 'voluntar' else 'recrut' end)::member_role,
       'activ'::member_status
  from generate_series(1, 9) n;
insert into groups(name, category, min_level, shared_work_visibility) values
  ('Min #57', 'team', 0, false), ('Shared #57', 'team', 0, true),
  ('Floor #57', 'team', 1, false), ('Card #57', 'team', 0, false);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.m(roster.n), roster.role
  from (values ('Min #57', 5, 'manager'), ('Min #57', 4, 'manager'), ('Min #57', 6, 'responsible'),
               ('Min #57', 1, 'member'), ('Min #57', 2, 'member'), ('Min #57', 3, 'member'),
               ('Shared #57', 5, 'manager'), ('Shared #57', 7, 'member'), ('Shared #57', 8, 'member'),
               ('Floor #57', 5, 'manager'), ('Floor #57', 2, 'member'), ('Floor #57', 3, 'member'),
               ('Card #57', 4, 'manager')) as roster(grp, n, role)
  join groups as grp on grp.name = roster.grp;
-- The roster refuses a member below the level, so Card #57 rises afterwards.
update groups set min_level = 3 where name = 'Card #57';
create function pg_temp.g(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.t(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
create function pg_temp.reads(p_member integer, p_title text) returns integer language plpgsql as $$
declare v_count integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.m(p_member));
  select count(*)::int into v_count from public.tasks where title = p_title;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_count;
end;
$$;

insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level) values
  ('Org V #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1),
  ('Org R #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 0),
  ('Local A #57',  pg_temp.g('Floor #57'),  '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), 2),
  ('Card V #57',   pg_temp.g('Card #57'),   '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1);
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Shared V #57', pg_temp.g('Shared #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);
insert into tasks (title, group_id, status, kind, audience, assignment_mode)
values ('Umb #57', pg_temp.g('Shared #57'), 'todo', 'umbrella', null, null);
insert into tasks (title, group_id, parent_task_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Sub V #57', pg_temp.g('Shared #57'), pg_temp.t('Umb #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);

-- ==================== Who reads ====================
select is(pg_temp.reads(2, 'Org V #57'), 1, 'an org-wide Opportunity at Voluntar reaches a Voluntar');
select is(pg_temp.reads(1, 'Org V #57'), 0, '... and not a Recrut');
select is(pg_temp.reads(1, 'Org R #57'), 1, 'at Recrut it still reaches everyone (R26 kept)');
select is(pg_temp.reads(2, 'Local A #57'), 0, 'a local one at Voluntar Activ is hidden from a Voluntar member');
select is(pg_temp.reads(3, 'Local A #57'), 1, '... and read by a Voluntar Activ member');
select is(pg_temp.reads(7, 'Shared V #57'), 1, 'Shared Work Visibility shows it at the Role');
select is(pg_temp.reads(8, 'Shared V #57'), 0, '... and hides it below the Role');
select is(pg_temp.reads(8, 'Umb #57'), 1, 'the Umbrella is read through Shared Work Visibility');
select is(pg_temp.reads(8, 'Sub V #57'), 0, 'its Subtask above the Role stays hidden (judged on the Task itself)');
select is(pg_temp.reads(7, 'Sub V #57'), 1, '... and shows at the Role');
select is(pg_temp.reads(6, 'Org V #57'), 1, 'a Group Responsible below the Role still reads it (R3)');
select is(pg_temp.reads(4, 'Org V #57'), 1, 'BC reads it (R1)');
select pg_temp.test_login_leadership(pg_temp.m(8));
select is(private.can_read_task(pg_temp.t('Sub V #57')), false, 'can_read_task agrees: hidden below the Role');
select pg_temp.test_login_leadership(pg_temp.m(7));
select is(private.can_read_task(pg_temp.t('Sub V #57')), true, 'can_read_task agrees: read at the Role');
reset role;
select pg_temp.test_clear_jwt();
-- The Group card: Card #57 sits at level 3; its only org Opportunity at Voluntar.
select pg_temp.test_login_leadership(pg_temp.m(2));
select is((select count(*)::int from groups where name = 'Card #57'), 1,
  'a Voluntar reads the Group of an Opportunity they may see');
select pg_temp.test_login_leadership(pg_temp.m(1));
select is((select count(*)::int from groups where name = 'Card #57'), 0, '... a Recrut does not');
reset role;
select pg_temp.test_clear_jwt();
-- A past Candidate keeps reading it (R2).
insert into task_candidates (task_id, member_id, status, joined_at, decided_at, decided_by)
values (pg_temp.t('Org V #57'), pg_temp.m(1), 'withdrawn', now(), now(), pg_temp.m(1));
select is(pg_temp.reads(1, 'Org V #57'), 1, 'a past Candidate below the Role still reads it');
select throws_ok($$insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, min_level)
  values ('Direct #57', (select id from groups where name = 'Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'direct', 1)$$,
  '23514', null, 'a direct Task carries no Minimum Level (tasks_min_level_public_ck)');

select * from finish();
rollback;
