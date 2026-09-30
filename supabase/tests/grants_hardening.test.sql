-- #363: helper functions are not anon RPC surface, views are read-only,
-- JWT helpers pin search_path, the dead in_my_dept helper is gone.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(16);

-- search_path pinned on every JWT helper (auth_role was fixed in #237).
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auth_level','auth_role','auth_is_member','auth_in_group')
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'),
  4::bigint,
  'all four JWT helpers pin search_path'
);

-- anon holds no execute on any helper.
select is(has_function_privilege('anon', 'public.rating_mult(integer)', 'execute'), false, 'anon: rating_mult denied');
select is(has_function_privilege('anon', 'public.auth_level()', 'execute'), false, 'anon: auth_level denied');
select is(has_function_privilege('anon', 'public.auth_role()', 'execute'), false, 'anon: auth_role denied');
select is(has_function_privilege('anon', 'public.auth_is_member()', 'execute'), false, 'anon: auth_is_member denied');
select is(has_function_privilege('anon', 'public.auth_in_group(bigint)', 'execute'), false, 'anon: auth_in_group denied');
select is(has_function_privilege('authenticated', 'public.auth_in_group(bigint)', 'execute'), true, 'authenticated: auth_in_group allowed');

-- authenticated keeps execute (policies and the generated points column need it).
select is(has_function_privilege('authenticated', 'public.auth_level()', 'execute'), true, 'authenticated: auth_level allowed');
select is(has_function_privilege('authenticated', 'public.rating_mult(integer)', 'execute'), true, 'authenticated: rating_mult allowed');

-- #576: the capability row and the caller's Groups are member reads, never anon RPC surface.
select is(has_function_privilege('anon', 'public.my_capabilities()', 'execute'), false, 'anon: my_capabilities denied');
select is(has_function_privilege('anon', 'public.my_groups()', 'execute'), false, 'anon: my_groups denied');
select is(has_function_privilege('authenticated', 'public.my_capabilities()', 'execute'), true, 'authenticated: my_capabilities allowed');
select is(has_function_privilege('authenticated', 'public.my_groups()', 'execute'), true, 'authenticated: my_groups allowed');

-- views: select only.
select is(has_table_privilege('authenticated', 'public.profiles_directory', 'insert'), false, 'profiles_directory: no insert');
-- #936: leaderboard, dept_cup and member_points are dropped views; their
-- successors (leadership_leaderboard, department_cup, a points_ledger sum)
-- are functions, so "no insert/update/delete" has no equivalent to port --
-- deleted rather than turned into a meaningless function-grant check.
select is(has_function_privilege('authenticated', 'public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz)', 'execute'), true, 'leadership_leaderboard: execute kept (#936, was leaderboard: select kept)');

-- dead helper removed.
select hasnt_function('public', 'in_my_dept', array['uuid'], 'in_my_dept dropped');

select * from finish();
rollback;
