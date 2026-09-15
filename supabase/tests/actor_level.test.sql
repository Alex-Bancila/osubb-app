-- actor_level.test.sql — #364 shared live actor authorization primitives.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email) values
  ('36400000-0000-0000-0000-000000000001', 'actor.active.364@test.local'),
  ('36400000-0000-0000-0000-000000000002', 'actor.inactive.364@test.local'),
  ('36400000-0000-0000-0000-000000000003', 'actor.missing.364@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('36400000-0000-0000-0000-000000000001', 'Actor Active', 'actor.active.364@test.local', 'bce', 'activ'),
  ('36400000-0000-0000-0000-000000000002', 'Actor Inactive', 'actor.inactive.364@test.local', 'bc', 'inactiv');

create function pg_temp.call_actor_level()
returns integer language sql stable security definer set search_path = ''
as $$ select private.actor_level() $$;
create function pg_temp.call_require_active_member()
returns uuid language sql stable security definer set search_path = ''
as $$ select private.require_active_member() $$;
grant execute on function pg_temp.call_actor_level() to authenticated;
grant execute on function pg_temp.call_require_active_member() to authenticated;

select has_function('private', 'actor_level', array['uuid'], 'actor_level(uuid) exists');
select has_function('private', 'require_active_member', 'require_active_member() exists');
select function_returns('private', 'actor_level', array['uuid'], 'integer', 'actor_level returns integer');
select function_returns('private', 'require_active_member', 'uuid', 'require_active_member returns uuid');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='actor_level'), 'actor_level is security definer');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='require_active_member'), 'require_active_member is security definer');
select ok(not has_function_privilege('authenticated', 'private.actor_level(uuid)', 'execute'), 'authenticated cannot execute actor_level directly');
select ok(not has_function_privilege('authenticated', 'private.require_active_member()', 'execute'), 'authenticated cannot execute require_active_member directly');
select ok(not has_function_privilege('anon', 'private.actor_level(uuid)', 'execute'), 'anon cannot execute actor_level');
select ok(not has_function_privilege('service_role', 'private.actor_level(uuid)', 'execute'), 'service_role has no direct actor_level grant');

select pg_temp.test_login('36400000-0000-0000-0000-000000000001', jsonb_build_object('member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(pg_temp.call_actor_level(), 5, 'an active actor receives their live level');
select is(pg_temp.call_require_active_member(), '36400000-0000-0000-0000-000000000001'::uuid, 'the active-member gate returns auth.uid()');
reset role;

select pg_temp.test_login('36400000-0000-0000-0000-000000000002', jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(pg_temp.call_actor_level(), null::integer, 'an inactive actor receives null despite stale claims');
select is(private.is_global_task_reader(), false, 'a stale leadership token yields false from the global-reader predicate');
select throws_ok($$ select pg_temp.call_require_active_member() $$, '42501', 'not_active_member', 'the inactive actor is rejected');
reset role;

select pg_temp.test_login('36400000-0000-0000-0000-000000000003', jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(pg_temp.call_actor_level(), null::integer, 'an actor without a profile receives null');
select throws_ok($$ select pg_temp.call_require_active_member() $$, '42501', 'not_active_member', 'an actor without a profile is rejected');
reset role;

select pg_temp.test_login('36400000-0000-0000-0000-000000000001', jsonb_build_object('provider','email'));
select throws_ok($$ select pg_temp.call_require_active_member() $$, '42501', 'not_active_member', 'organization claims remain mandatory');
reset role;

select is(public.member_level('36400000-0000-0000-0000-000000000002'), 0, 'member_level preserves its inactive-member zero sentinel');

select * from finish();
rollback;
