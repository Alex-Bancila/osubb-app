-- #294: catalog assertions for the Tracker authorization/screen indexes.
-- This suite makes no schema change of its own -- it only asserts that the
-- migration's four indexes exist with the exact definition the migration
-- header justifies, and that no index anywhere in `public` duplicates
-- another one's leading columns (a query over pg_index, not a fixed list,
-- so it keeps catching regressions as the schema grows).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ==================== The four indexes exist ====================

select has_index('public', 'task_evaluations', 'task_evaluations_evaluated_by_idx',
  'task_evaluations_read''s own-row branch (evaluated_by) is indexed');
select has_index('public', 'task_candidates', 'task_candidates_task_member_idx',
  'the any-status own-Candidature branch (task_id, member_id) is indexed');
select has_index('public', 'tasks', 'tasks_audience_open_idx',
  'the Opportunity predicate (audience, partial on open public queues) is indexed');
select has_index('public', 'tasks', 'tasks_deadline_active_idx',
  'the overdue scan (deadline, partial on unfinished status) is indexed');

-- ==================== Exact definitions ====================
-- has_index only proves the name exists; a same-named index with a
-- different (or missing) predicate would still pass it and would not
-- serve the query it was added for, so pin the definition too.

select is(
  pg_get_indexdef('public.task_evaluations_evaluated_by_idx'::regclass),
  'CREATE INDEX task_evaluations_evaluated_by_idx ON public.task_evaluations USING btree (evaluated_by)',
  'task_evaluations_evaluated_by_idx is a plain, non-partial btree on evaluated_by');

select is(
  pg_get_indexdef('public.task_candidates_task_member_idx'::regclass),
  'CREATE INDEX task_candidates_task_member_idx ON public.task_candidates USING btree (task_id, member_id)',
  'task_candidates_task_member_idx is a plain, non-partial btree on (task_id, member_id)');

select is(
  pg_get_indexdef('public.tasks_audience_open_idx'::regclass),
  'CREATE INDEX tasks_audience_open_idx ON public.tasks USING btree (audience) '
  || 'WHERE ((assignment_mode = ''public''::text) AND (queue_closed_at IS NULL))',
  'tasks_audience_open_idx is scoped to open, public-queue Tasks');

select is(
  pg_get_indexdef('public.tasks_deadline_active_idx'::regclass),
  'CREATE INDEX tasks_deadline_active_idx ON public.tasks USING btree (deadline) '
  || 'WHERE (status = ANY (ARRAY[''todo''::task_status, ''in_progress''::task_status, ''in_review''::task_status]))',
  'tasks_deadline_active_idx is scoped to the three unfinished statuses');

-- ==================== No duplicate indexes anywhere in public ====================
-- "Duplicate" here means either of:
--   (a) two indexes on the same table with the identical ordered key-column
--       list, the same uniqueness, and the same partial predicate (or both
--       full) -- a literal, pointless duplicate; or
--   (b) two *non-unique* indexes on the same table, same predicate, where
--       one's key-column list is a strict prefix of the other's -- the
--       classic redundant-index shape a later CREATE INDEX can introduce
--       by accident.
-- Comparing *unique* indexes by prefix alone is deliberately excluded: a
-- composite unique index whose columns are a prefix-superset of the
-- primary key is commonly the required target of a composite foreign key
-- (e.g. teams_id_dept_key over teams_pkey, task_assignments_id_task_id_key
-- over task_assignments_pkey) and is not a redundant duplicate.
select is_empty($$
  with idx as (
    select
      ix.indexrelid,
      ix.indrelid,
      ix.indisunique,
      pg_get_expr(ix.indpred, ix.indrelid) as predicate,
      (
        select array_agg(a.attname order by k.ord)
          from unnest(ix.indkey[0:ix.indnkeyatts - 1]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum
      ) as key_cols
    from pg_index ix
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
  )
  select a.indexrelid::regclass as index_a, b.indexrelid::regclass as index_b
    from idx a
    join idx b
      on a.indrelid = b.indrelid
     and a.indexrelid < b.indexrelid
     and a.indisunique = b.indisunique
     and coalesce(a.predicate, '') = coalesce(b.predicate, '')
     and (
       a.key_cols = b.key_cols
       or (
         not a.indisunique
         and array_length(a.key_cols, 1) <> array_length(b.key_cols, 1)
         and (
           a.key_cols = b.key_cols[1:array_length(a.key_cols, 1)]
           or b.key_cols = a.key_cols[1:array_length(b.key_cols, 1)]
         )
       )
     )
$$, 'no index duplicates another index''s leading columns on the same table');

select * from finish();
rollback;
