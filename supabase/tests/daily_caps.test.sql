-- daily_caps.test.sql — security pass L3 / L5 (2026-09-27): per-Member daily
-- caps on the five writes that notify other people, and a Latin-only Nickname.
--
-- Each cap is filled to one below its limit with rows written as the owner
-- (rolled back; no client write path implied), then the command is called
-- twice: the limit-th call lives, the next one is PT409 rate_limited. Taking
-- the require_daily_cap call out of a command turns its "refused" assertion red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- ==================== Fixtures ====================

create function pg_temp.cap_uid(n integer) returns uuid language sql immutable as $$
  select ('ca900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.cap_uid(n), 'cap.' || n || '@test.local' from generate_series(1, 2) n;

-- 1 a BC (creates Tasks and Announcements), 2 a Voluntar (applies, queues, requests).
insert into public.profiles (id, full_name, email, role, status) values
  (pg_temp.cap_uid(1), 'Plafon BC', 'cap.1@test.local', 'bc', 'activ'),
  (pg_temp.cap_uid(2), 'Plafon Voluntar', 'cap.2@test.local', 'voluntar', 'activ');

insert into public.groups (name, category, min_level, accepts_applications, application_level, created_by)
values ('Plafon A', 'department', 0, true, 0, pg_temp.cap_uid(1)),
       ('Plafon B', 'department', 0, true, 0, pg_temp.cap_uid(1)),
       ('Plafon Lucru', 'department', 0, false, null, pg_temp.cap_uid(1));

create function pg_temp.cap_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.group_members (group_id, member_id, group_role)
values (pg_temp.cap_group('Plafon Lucru'), pg_temp.cap_uid(2), 'member');

-- Two public Opportunities in the Voluntar's Group, created through the command.
select pg_temp.test_login_leadership(pg_temp.cap_uid(1));
create temp table cap_tasks as
select (public.create_task('Plafon T1', 'd', now() + interval '7 days', 'local', 'public',
          p_group_id => pg_temp.cap_group('Plafon Lucru'))).id as t1,
       (public.create_task('Plafon T2', 'd', now() + interval '7 days', 'local', 'public',
          p_group_id => pg_temp.cap_group('Plafon Lucru'))).id as t2;
reset role;
grant select on cap_tasks to authenticated;

-- The error DETAIL of a statement, or null when it lives.
create function pg_temp.cap_detail(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm || ' / ' || coalesce(v_detail, '');
end;
$$;

-- ==================== The helper is nobody's to call ====================

select ok(
  not has_function_privilege('authenticated', 'private.require_daily_cap(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.require_daily_cap(text, uuid)', 'execute'),
  'require_daily_cap is granted to no client role');

-- ==================== group_application: 10 per 24 hours ====================

insert into public.group_applications (group_id, member_id, status, decided_by, decided_at)
select pg_temp.cap_group('Plafon B'), pg_temp.cap_uid(2), 'withdrawn', pg_temp.cap_uid(2), now()
  from generate_series(1, 9);

select pg_temp.test_login_leadership(pg_temp.cap_uid(2));
select lives_ok(
  format($$ select public.apply_to_group(%s, null) $$, pg_temp.cap_group('Plafon A')),
  'the tenth Application in 24 hours is filed');
select throws_ok(
  format($$ select public.apply_to_group(%s, null) $$, pg_temp.cap_group('Plafon B')),
  'PT409', 'rate_limited',
  'the eleventh Application in 24 hours is refused, withdrawn ones included');
select is(
  pg_temp.cap_detail(format($$ select public.apply_to_group(%s, null) $$, pg_temp.cap_group('Plafon B'))),
  'PT409 rate_limited / group_application: at most 10 per Member in any 24 hours',
  'the refusal''s DETAIL names the cap and its window');
reset role;

update public.group_applications
   set created_at = now() - interval '2 days',
       decided_at = case when decided_at is null then null else now() - interval '2 days' end
 where member_id = pg_temp.cap_uid(2);

select pg_temp.test_login_leadership(pg_temp.cap_uid(2));
select lives_ok(
  format($$ select public.apply_to_group(%s, null) $$, pg_temp.cap_group('Plafon B')),
  'Applications older than 24 hours no longer count');
reset role;

-- ==================== task_interest: 30 per 24 hours ====================

insert into public.task_activity (task_id, kind, actor_id)
select (select t1 from cap_tasks), 'interest_expressed', pg_temp.cap_uid(2)
  from generate_series(1, 29);

select pg_temp.test_login_leadership(pg_temp.cap_uid(2));
select lives_ok(
  format($$ select public.express_task_interest(%s) $$, (select t1 from cap_tasks)),
  'the thirtieth expression of interest in 24 hours joins the queue');
select throws_ok(
  format($$ select public.express_task_interest(%s) $$, (select t2 from cap_tasks)),
  'PT409', 'rate_limited',
  'the thirty-first expression of interest in 24 hours is refused');
reset role;

-- ==================== completed_work_request: 30 per 24 hours ====================

insert into public.completed_work_requests (requester_id, group_id, description, status)
select pg_temp.cap_uid(2), pg_temp.cap_group('Plafon Lucru'), 'Cerere veche ' || n, 'pending'
  from generate_series(1, 29) n;

select pg_temp.test_login_leadership(pg_temp.cap_uid(2));
select lives_ok(
  format($$ select public.create_completed_work_request('Am lucrat', %s) $$, pg_temp.cap_group('Plafon Lucru')),
  'the thirtieth Completed Work Request in 24 hours is filed');
select throws_ok(
  format($$ select public.create_completed_work_request('Am lucrat iar', %s) $$, pg_temp.cap_group('Plafon Lucru')),
  'PT409', 'rate_limited',
  'the thirty-first Completed Work Request in 24 hours is refused');
select throws_ok(
  format($$ select public.create_completed_work_request('   ', %s) $$, pg_temp.cap_group('Plafon Lucru')),
  'PT400', 'description_required',
  'a malformed Request over the cap still hears its own reason');
reset role;

update public.completed_work_requests
   set created_at = now() - interval '2 days'
 where requester_id = pg_temp.cap_uid(2);

select pg_temp.test_login_leadership(pg_temp.cap_uid(2));
select lives_ok(
  format($$ select public.create_completed_work_request('Am lucrat azi', %s) $$, pg_temp.cap_group('Plafon Lucru')),
  'Requests older than 24 hours no longer count');
reset role;

-- ==================== task_create: 100 per 24 hours ====================

insert into public.task_activity (task_id, kind, actor_id)
select (select t1 from cap_tasks), 'created', pg_temp.cap_uid(1)
  from generate_series(1, 99 - (select count(*)::int from public.task_activity
                                  where actor_id = pg_temp.cap_uid(1) and kind = 'created'));

select pg_temp.test_login_leadership(pg_temp.cap_uid(1));
select lives_ok(
  format($$ select public.create_task('Plafon 100', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => %s) $$,
         pg_temp.cap_group('Plafon Lucru')),
  'the hundredth Task in 24 hours is created');
select throws_ok(
  format($$ select public.create_task('Plafon 101', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => %s) $$,
         pg_temp.cap_group('Plafon Lucru')),
  'PT409', 'rate_limited',
  'the hundred-and-first Task in 24 hours is refused');
select throws_ok(
  format($$ select public.create_task('  ', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => %s) $$,
         pg_temp.cap_group('Plafon Lucru')),
  'PT400', 'title_required',
  'a malformed Task over the cap still hears its own reason');
select throws_ok(
  format($$ select public.duplicate_task(%s, now() + interval '7 days') $$, (select t1 from cap_tasks)),
  'PT409', 'rate_limited',
  'duplicating a Task spends the same daily allowance as creating one');
reset role;

-- ==================== announcement: 20 per 24 hours ====================

insert into public.announcements (title, body, group_id, audience, created_by)
select 'Anunț vechi ' || n, 'b', pg_temp.cap_group('Plafon Lucru'), 'local', pg_temp.cap_uid(1)
  from generate_series(1, 19) n;

select pg_temp.test_login_leadership(pg_temp.cap_uid(1));
select lives_ok(
  format($$ insert into public.announcements (title, body, group_id, audience) values ('Anunț 20', 'b', %s, 'local') $$,
         pg_temp.cap_group('Plafon Lucru')),
  'the twentieth Announcement in 24 hours is published');
select throws_ok(
  format($$ insert into public.announcements (title, body, group_id, audience) values ('Anunț 21', 'b', %s, 'local') $$,
         pg_temp.cap_group('Plafon Lucru')),
  'PT409', 'rate_limited',
  'the twenty-first Announcement in 24 hours is refused');
reset role;

select pg_temp.test_clear_jwt();
select lives_ok(
  format($$ insert into public.announcements (title, body, group_id, audience, created_by) values ('Anunț server', 'b', %s, 'local', %L) $$,
         pg_temp.cap_group('Plafon Lucru'), pg_temp.cap_uid(1)),
  'a server-side write with no signed-in Member is not capped');

-- ==================== L5: a Latin-only Nickname ====================

select throws_ok(
  $$ update public.profiles set nickname = 'Аlex' where id = 'ca900000-0000-0000-0000-000000000002' $$,
  '23514', 'nickname_invalid',
  'a Nickname with a Cyrillic letter is refused');
select throws_ok(
  $$ update public.profiles set nickname = 'Αlex' where id = 'ca900000-0000-0000-0000-000000000002' $$,
  '23514', 'nickname_invalid',
  'a Nickname with a Greek letter is refused');
select lives_ok(
  $$ update public.profiles set nickname = 'Ștefan Țăran-Îâ' where id = 'ca900000-0000-0000-0000-000000000002' $$,
  'a Nickname with the Romanian letters ș ț ă î â is accepted');

alter table public.profiles disable trigger profiles_guard_nickname;
select throws_ok(
  $$ update public.profiles set nickname = 'Аlex' where id = 'ca900000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'profiles_nickname_ck itself refuses a Cyrillic letter when the guard is bypassed');
alter table public.profiles enable trigger profiles_guard_nickname;

select ok(
  (select convalidated from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_nickname_ck'),
  'profiles_nickname_ck is validated when every stored Nickname passes');

select * from finish();
rollback;
