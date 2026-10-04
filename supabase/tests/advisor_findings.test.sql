-- advisor_findings.test.sql — #1006: the Supabase Security and Performance
-- Advisors report nothing actionable. The advisor itself runs in CI
-- (`supabase db advisors --type security --fail-on warn`); these sweeps pin the
-- performance and INFO findings it does not gate, each over the whole public and
-- private schemas so a new table or foreign key that reintroduces a finding is
-- named here on the day it lands. Each sweep is shown not to be hollow with a
-- probe that must be reported by name. Runs in one transaction and rolls back.
--
-- profiles_contact's replacement (the ERROR) has its own suite,
-- member_contacts.test.sql; the security_invoker view sweep is in
-- conventions.test.sql.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ==================== function_search_path_mutable ====================

select ok((select proconfig from pg_proc where oid = 'public.rating_mult(integer)'::regprocedure) @> array['search_path=""'],
  'rating_mult pins an empty search_path');
select is(pg_get_function_result('public.rating_mult(integer)'::regprocedure), 'integer',
  'rating_mult keeps its signature');
select is(public.rating_mult(5), 3, 'rating_mult keeps its body (5 -> 3)');
select is(public.rating_mult(1), -1, 'rating_mult keeps its body (1 -> -1)');

-- Every function in public/private, definer or not, pins search_path -- the
-- advisor's lint checks them all, while conventions.test.sql only checks
-- security definer ones. pgTAP and the test helpers live outside these schemas.
create function pg_temp.functions_without_search_path() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
$$;
select is(pg_temp.functions_without_search_path(), '{}'::text[],
  'every function in public and private sets search_path');

-- ==================== unindexed_foreign_keys ====================

-- A foreign key is covered when some index on its table starts with exactly
-- its columns, in any order -- the advisor's own rule.
create function pg_temp.unindexed_foreign_keys() returns text[]
language sql as $$
  select coalesce(array_agg(fk.conname::text order by fk.conname), '{}')
    from pg_constraint fk
    join pg_class t on t.oid = fk.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where fk.contype = 'f'
     and n.nspname in ('public', 'private')
     and not exists (
       select 1 from pg_index i
        where i.indrelid = fk.conrelid
          and (select array_agg(k order by k)
                 from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(fk.conkey)]) k)
            = (select array_agg(k order by k) from unnest(fk.conkey) k));
$$;
select is(pg_temp.unindexed_foreign_keys(), '{}'::text[],
  'every foreign key in public and private has a covering index');
select has_index('public', 'task_evaluations', 'task_evaluations_assignment_id_task_id_idx',
  array['assignment_id', 'task_id'], 'the composite Evaluation -> Assignment key has its two-column index');
select has_index('public', 'points_ledger', 'points_ledger_task_id_idx', array['task_id'],
  'points_ledger.task_id is indexed');
select has_index('public', 'tasks', 'tasks_created_by_idx', array['created_by'],
  'tasks.created_by is indexed');
-- Not hollow: dropping one of the new indexes is reported by name.
drop index public.tasks_created_by_idx;
select is(pg_temp.unindexed_foreign_keys(), array['tasks_created_by_fkey'],
  'a foreign key that loses its index is reported by name');

-- ==================== no_primary_key ====================

create function pg_temp.tables_without_primary_key() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || c.relname order by 1), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ('public', 'private')
     and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p');
$$;
select is(pg_temp.tables_without_primary_key(), '{}'::text[],
  'every table in public and private has a primary key');
select col_is_pk('private', 'invitation_requests', 'id', 'invitation_requests has an identity primary key');
select lives_ok(
  $$ insert into private.invitation_requests (email_hash, ip_hash)
     values (repeat('a', 64), repeat('b', 32)) $$,
  'the request-invitation writer''s column list still inserts (the key is generated)');

-- ==================== rls_enabled_no_policy ====================

create function pg_temp.rls_tables_without_policy() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || c.relname order by 1), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and c.relrowsecurity
     and n.nspname in ('public', 'private')
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
$$;
select is(pg_temp.rls_tables_without_policy(), '{}'::text[],
  'every table in public and private with RLS on has at least one policy');
select is(
  (select array_agg(format('%s.%s:%s:%s:%s:%s', schemaname, tablename, permissive, cmd, qual, with_check) order by 1)
     from pg_policies
    where policyname like '%\_manage\_no\_client'),
  array[
    'private.email_digests:RESTRICTIVE:ALL:false:false',
    'private.invitation_requests:RESTRICTIVE:ALL:false:false',
    'private.resend_webhook_deliveries:RESTRICTIVE:ALL:false:false',
    'public.member_imports:RESTRICTIVE:ALL:false:false',
    'public.push_deliveries:RESTRICTIVE:ALL:false:false'
  ],
  'the five service- and definer-only tables each carry one restrictive deny-all policy');
-- Per policy, not the union: a policy that loses either role fails here.
select is(
  (select array_agg(format('%s.%s:%s', schemaname, tablename,
                           array_to_string(array(select r from unnest(roles) r order by r), ','))
                    order by 1)
     from pg_policies
    where policyname like '%\_manage\_no\_client'),
  array[
    'private.email_digests:anon,authenticated',
    'private.invitation_requests:anon,authenticated',
    'private.resend_webhook_deliveries:anon,authenticated',
    'public.member_imports:anon,authenticated',
    'public.push_deliveries:anon,authenticated'
  ],
  'each deny policy names both client roles, anon and authenticated');
-- Not hollow: an RLS table with no policy is reported by name.
create table public.advisor_probe_no_policy (id bigint primary key);
alter table public.advisor_probe_no_policy enable row level security;
select is(pg_temp.rls_tables_without_policy(), array['public.advisor_probe_no_policy'],
  'an RLS table without a policy is reported by name');
drop table public.advisor_probe_no_policy;

select * from finish();
rollback;
