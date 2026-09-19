begin;
select plan(3);

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

select is((select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.teams'::regclass and conname = 'teams_id_dept_key'),
  'UNIQUE (id, dept_id)', 'renamed Team constraint preserves its unique key columns');

select * from finish();
rollback;
