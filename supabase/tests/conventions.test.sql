-- #365: machine-checked house rules 3 and 4 plus the grant posture #363
-- established — every security definer function in public/private pins
-- search_path to the empty string, nothing in public or private is
-- executable by anon (trigger functions included), no trigger function or
-- require_* helper is executable by authenticated either, every view runs as
-- the caller except the two documented owner-rights exceptions, and the
-- private schema is invisible to anon and service_role. Each check returns
-- the offending objects by name, so a red run says what to fix. Supabase-
-- owned schemas (graphql, auth, storage) are out of scope. This suite does
-- not check the four-role revoke form, object naming, or error codes — those
-- stay reviewed, not machine-checked. The written rules:
-- docs/backend/conventions.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Postgres stores an empty search_path as the literal proconfig entry
-- search_path="" (confirmed against add_project_member_impl on the live
-- database) — match that exact text, not just any search_path setting.
create function pg_temp.definers_without_empty_search_path() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                      where c = 'search_path=""');
$$;

create function pg_temp.anon_executable_functions() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and has_function_privilege('anon', p.oid, 'execute');
$$;

-- Trigger functions and require_* helpers are invoked by the trigger
-- machinery or by another security-definer function, never called directly
-- by a client, so authenticated must never be able to execute them either.
create function pg_temp.authenticated_executable_internals() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prorettype = 'trigger'::regtype or p.proname like 'require\_%' escape '\')
     and has_function_privilege('authenticated', p.oid, 'execute');
$$;

-- Postgres stores a view's security_invoker reloption as written, so accept
-- every true spelling (on/true/yes/1), case-insensitively.
create function pg_temp.owner_rights_views() returns text[]
language sql as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce(array_to_string(c.reloptions, ','), '') !~* '(^|,)security_invoker=(on|true|yes|1)(,|$)'
     and c.relname not in ('member_points', 'profiles_contact');
$$;

select is(pg_temp.definers_without_empty_search_path(), '{}'::text[],
  'every security definer function in public/private pins search_path to the empty string');
select is(pg_temp.anon_executable_functions(), '{}'::text[],
  'anon can execute no function in public or private, trigger functions included');
select is(pg_temp.authenticated_executable_internals(), '{}'::text[],
  'authenticated cannot execute any trigger function or require_* helper');
select is(pg_temp.owner_rights_views(), '{}'::text[],
  'every view is security_invoker except the two documented owner-rights exceptions');
select is(has_schema_privilege('anon', 'private', 'usage'), false,
  'anon has no usage on the private schema');
select is(has_schema_privilege('service_role', 'private', 'usage'), false,
  'service_role has no usage on private either — commands go through public wrappers');
-- The allow-list stays honest: both exceptions must still exist and still be
-- owner-rights. Retire an entry here the day the view goes invoker.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname in ('member_points', 'profiles_contact')
      and coalesce(array_to_string(c.reloptions, ','), '') !~* '(^|,)security_invoker=(on|true|yes|1)(,|$)'),
  2::bigint,
  'member_points and profiles_contact are the two owner-rights views');

-- The sweep is not hollow. A throwaway definer created the way a careless
-- migration would — no search_path, no revoke — must be named by BOTH checks:
-- the first because it lacks search_path, the second because Supabase's
-- default ACL grants EXECUTE on new public functions to anon. That second
-- assertion also documents why every migration needs an explicit revoke.
-- The probe is dropped (and the whole suite rolls back).
create function public.conventions_probe_definer() returns int
language sql security definer as $$ select 1 $$;
select is(pg_temp.definers_without_empty_search_path(), array['public.conventions_probe_definer'],
  'a definer without search_path is reported by name');
select is(pg_temp.anon_executable_functions(), array['public.conventions_probe_definer'],
  'a function created without a revoke is anon-executable and reported by name');
drop function public.conventions_probe_definer();
select is(pg_temp.definers_without_empty_search_path() || pg_temp.anon_executable_functions(), '{}'::text[],
  'both sweeps are clean again once the probe is dropped');

select * from finish();
rollback;
