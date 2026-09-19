-- #189: capability wrapper fails closed and delegates to command authority.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(5);
select has_function('public', 'can_evaluate_task', array['bigint']);
select ok(not has_function_privilege('anon', 'public.can_evaluate_task(bigint)', 'execute'), 'anon cannot query capability');
select ok(has_function_privilege('authenticated', 'public.can_evaluate_task(bigint)', 'execute'), 'members may query capability');
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select is(public.can_evaluate_task(-189), false, 'claimless and missing target deny');
reset role;
select ok(position('private.can_evaluate_task' in pg_get_functiondef('public.can_evaluate_task(bigint)'::regprocedure)) > 0, 'authority remains with the command helper');
select * from finish();
rollback;
