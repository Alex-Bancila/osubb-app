-- #379: catalog naming checks after the cosmetic rename migration.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is_empty($$
  select tablename, policyname from pg_policies
  where schemaname = 'public'
    and policyname !~ ('^' || tablename || '_(read|create|update|delete|manage)(_[a-z][a-z0-9_]*)?$')
$$, 'public policies follow table_verb_qualifier naming');

select is_empty($$
  select conrelid::regclass::text, conname from pg_constraint
  where connamespace = 'public'::regnamespace and contype = 'c'
    and conname !~ '_ck$'
$$, 'public CHECK constraints use the _ck suffix');

select * from finish();
rollback;
