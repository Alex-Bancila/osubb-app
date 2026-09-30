-- #365: machine-checked house rules 3 and 4 plus the grant posture #363
-- established — every security definer function in public/private pins
-- search_path to the empty string, nothing in public or private is
-- executable by anon (trigger functions included), no trigger function or
-- require_* helper is executable by authenticated either, every view runs as
-- the caller except the one documented owner-rights exception, and the
-- private schema is invisible to anon and service_role. Each check returns
-- the offending objects by name, so a red run says what to fix. Supabase-
-- owned schemas (graphql, auth, storage) are out of scope. This suite does
-- not check the four-role revoke form, object naming, or error codes — those
-- stay reviewed, not machine-checked. The written rules:
-- docs/backend/conventions.md. #520 also forbids presentation-category
-- references in functions and policies, apart from the three named mirror writers.
-- The security pass (2026-09-27, I1) adds four more: authenticated cannot write the
-- command-only tables at all, no public/private function reaches pg_net, the cron
-- jobs that do call pg_net run as a role that can, and pg_graphql is not installed.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Postgres stores an empty search_path as the literal proconfig entry
-- search_path="" (confirmed against add_group_member_impl on the live
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
     and c.relname not in ('profiles_contact');
$$;

select is(pg_temp.definers_without_empty_search_path(), '{}'::text[],
  'every security definer function in public/private pins search_path to the empty string');
select is(pg_temp.anon_executable_functions(), '{}'::text[],
  'anon can execute no function in public or private, trigger functions included');
select is(pg_temp.authenticated_executable_internals(), '{}'::text[],
  'authenticated cannot execute any trigger function or require_* helper');
select is(pg_temp.owner_rights_views(), '{}'::text[],
  'every view is security_invoker except the one documented owner-rights exception (profiles_contact; #936 dropped member_points)');
select is(has_schema_privilege('anon', 'private', 'usage'), false,
  'anon has no usage on the private schema');
select is(has_schema_privilege('service_role', 'private', 'usage'), false,
  'service_role has no usage on private either — commands go through public wrappers');
-- The allow-list stays honest: the exception must still exist and still be
-- owner-rights. Retire an entry here the day the view goes invoker.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname in ('profiles_contact')
      and coalesce(array_to_string(c.reloptions, ','), '') !~* '(^|,)security_invoker=(on|true|yes|1)(,|$)'),
  1::bigint,
  'profiles_contact is the one owner-rights view');

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


-- ADR-0009 Groups: no authority, visibility, membership, notification or Cup rule may branch
-- on the Group's presentation label. #576's public.my_groups() only PROJECTS it for the pickers (R14): a
-- security-invoker read whose every row decision lives in private.my_groups_impl, which stays
-- under this sweep.
--
-- #582 (ruling R16) adds the two Group structure commands that legitimately WRITE the label:
-- private.create_group_impl chooses it at creation and private.update_group_structure_impl is
-- BC's editor for it. Their public wrappers are listed with them for a mechanical reason, not
-- a second exemption: pg_get_functiondef renders a function's signature, and the wrapper's
-- argument is named p_category because that is the name PostgREST publishes. Nothing else in
-- public or private may name the column, and neither of the two writers BRANCHES on it --
-- both only assign what the caller sent, and their own prose about it lives in
-- `comment on function`, which this sweep deliberately does not read.
create function pg_temp.category_branching_functions() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind = 'f'
     and not (n.nspname = 'private'
              and p.proname in ('create_group_impl', 'update_group_structure_impl'))
     and not (n.nspname = 'public'
              and p.proname in ('my_groups', 'create_group', 'update_group_structure'))
     and pg_get_functiondef(p.oid) ~ '\mcategory\M';
$$;
create function pg_temp.category_branching_policies() returns text[]
language sql as $$
  select coalesce(array_agg(pol.tablename || '.' || pol.policyname order by 1), '{}')
    from pg_policies pol
   where pol.schemaname in ('public', 'private')
     and (coalesce(pol.qual, '') ~ '\mcategory\M' or coalesce(pol.with_check, '') ~ '\mcategory\M');
$$;
select is(pg_temp.category_branching_functions(), '{}'::text[],
  'no function in public/private branches on groups.category (ADR-0009: a presentation label only)');
select is(pg_temp.category_branching_policies(), '{}'::text[],
  'no policy qual or with_check mentions groups.category');
-- Non-hollow: a probe function and a probe policy that do branch must be named.
create function public.conventions_probe_category(g bigint) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = g and category = 'team') $$;
create policy conventions_probe_category on public.groups
  for select to authenticated using (public.auth_is_member() and category = 'team');
select is(pg_temp.category_branching_functions(), array['public.conventions_probe_category'],
  'a function whose body reads category is reported by name');
select is(pg_temp.category_branching_policies(), array['groups.conventions_probe_category'],
  'a policy whose qual reads category is reported by name');
drop policy conventions_probe_category on public.groups;
drop function public.conventions_probe_category(bigint);

-- Security pass I1: tables that only migrations or security-definer commands
-- write carry no write grant to authenticated. RLS (no write policy) is the
-- second guard, never the only one. Reference data (roles, difficulty_guide,
-- rating_guide) changes only by migration; a profiles row is inserted only by
-- provision_profile (service role) and never deleted by a client. profiles
-- keeps its column-level UPDATE grants for profiles_update_self.
create function pg_temp.command_only_write_grants() returns text[]
language sql as $$
  select coalesce(array_agg(t.tbl || ':' || t.priv order by t.tbl, t.priv), '{}')
    from (values ('roles', 'INSERT'), ('roles', 'UPDATE'), ('roles', 'DELETE'),
                 ('difficulty_guide', 'INSERT'), ('difficulty_guide', 'UPDATE'),
                 ('difficulty_guide', 'DELETE'),
                 ('rating_guide', 'INSERT'), ('rating_guide', 'UPDATE'),
                 ('rating_guide', 'DELETE'),
                 ('profiles', 'INSERT'), ('profiles', 'DELETE')) as t(tbl, priv)
   where has_table_privilege('authenticated', ('public.' || t.tbl)::regclass, t.priv);
$$;
select is(pg_temp.command_only_write_grants(), '{}'::text[],
  'authenticated has no INSERT/UPDATE/DELETE on roles, difficulty_guide or rating_guide, and no INSERT/DELETE on profiles');
select ok(
  has_table_privilege('authenticated', 'public.roles', 'select')
  and has_table_privilege('authenticated', 'public.difficulty_guide', 'select')
  and has_table_privilege('authenticated', 'public.rating_guide', 'select'),
  'authenticated still reads the three reference tables');
-- Non-hollow: a re-grant is named.
grant insert on table public.roles to authenticated;
select is(pg_temp.command_only_write_grants(), array['roles:INSERT'],
  'a re-granted write privilege on a command-only table is reported by name');
revoke insert on table public.roles from authenticated;

-- pg_net: EXECUTE on net.http_get/http_post stays granted to anon and
-- authenticated by Supabase (supabase_admin owns net and granted it; the
-- migration role cannot revoke it). The net schema is not exposed through the
-- Data API, so the remaining path would be one of our own functions calling
-- it. None may: HTTP leaves the database only from the cron jobs below.
create function pg_temp.pg_net_calling_functions() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ '\mnet\.(http_|_http)';
$$;
select is(pg_temp.pg_net_calling_functions(), '{}'::text[],
  'no function in public/private calls pg_net (net.http_*)');
create function public.conventions_probe_net() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  return net.http_get('https://example.invalid');
end;
$$;
select is(pg_temp.pg_net_calling_functions(), array['public.conventions_probe_net'],
  'a function that calls net.http_get is reported by name');
drop function public.conventions_probe_net();

-- The cron path keeps working: exactly the two outbox jobs call
-- net.http_post, and each runs as a role that can execute it.
select is(
  (select coalesce(array_agg(job.jobname || ':' || job.username order by job.jobname), '{}')
     from cron.job as job
    where job.command ~ '\mnet\.http_post'),
  array['osubb-email-digest:postgres', 'osubb-send-push:postgres'],
  'osubb-send-push and osubb-email-digest are the only cron jobs calling net.http_post, and both run as postgres');
select is(
  (select coalesce(array_agg(job.jobname order by job.jobname), '{}')
     from cron.job as job
    where job.command ~ '\mnet\.http_post'
      and not has_function_privilege(job.username,
            'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute')),
  '{}'::text[],
  'every cron job calling net.http_post runs as a role that can execute it');

select is(
  (select count(*) from pg_extension where extname = 'pg_graphql'),
  0::bigint,
  'pg_graphql is not installed: nothing uses GraphQL and it gave schema introspection to anon-key holders');

select * from finish();
rollback;
