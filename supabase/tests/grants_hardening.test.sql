-- #363: helper functions are not anon RPC surface, views are read-only,
-- JWT helpers pin search_path, the dead in_my_dept helper is gone.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(17);

-- search_path pinned on every JWT helper (auth_role was fixed in #237).
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auth_level','auth_role','auth_in_dept','auth_in_team','auth_is_member','auth_in_group')
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'),
  6::bigint,
  'all six JWT helpers pin search_path'
);

-- anon holds no execute on any helper.
select is(has_function_privilege('anon', 'public.rating_mult(integer)', 'execute'), false, 'anon: rating_mult denied');
select is(has_function_privilege('anon', 'public.auth_level()', 'execute'), false, 'anon: auth_level denied');
select is(has_function_privilege('anon', 'public.auth_role()', 'execute'), false, 'anon: auth_role denied');
select is(has_function_privilege('anon', 'public.auth_in_dept(text)', 'execute'), false, 'anon: auth_in_dept denied');
select is(has_function_privilege('anon', 'public.auth_in_team(text)', 'execute'), false, 'anon: auth_in_team denied');
select is(has_function_privilege('anon', 'public.auth_is_member()', 'execute'), false, 'anon: auth_is_member denied');
select is(has_function_privilege('anon', 'public.auth_in_group(bigint)', 'execute'), false, 'anon: auth_in_group denied');
select is(has_function_privilege('authenticated', 'public.auth_in_group(bigint)', 'execute'), true, 'authenticated: auth_in_group allowed');

-- authenticated keeps execute (policies and the generated points column need it).
select is(has_function_privilege('authenticated', 'public.auth_level()', 'execute'), true, 'authenticated: auth_level allowed');
select is(has_function_privilege('authenticated', 'public.rating_mult(integer)', 'execute'), true, 'authenticated: rating_mult allowed');

-- views: select only.
select is(has_table_privilege('authenticated', 'public.profiles_directory', 'insert'), false, 'profiles_directory: no insert');
select is(has_table_privilege('authenticated', 'public.leaderboard', 'update'), false, 'leaderboard: no update');
select is(has_table_privilege('authenticated', 'public.dept_cup', 'delete'), false, 'dept_cup: no delete');
select is(has_table_privilege('authenticated', 'public.member_points', 'insert'), false, 'member_points: no insert');
select is(has_table_privilege('authenticated', 'public.leaderboard', 'select'), true, 'leaderboard: select kept');

-- dead helper removed.
select hasnt_function('public', 'in_my_dept', array['uuid'], 'in_my_dept dropped');

select * from finish();
rollback;
