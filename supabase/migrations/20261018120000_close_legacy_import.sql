-- #1050: close the Legacy Import (ruling R53).
--
-- The one production run went in on 2026-10-17: 5 411 rows of the legacy
-- Google Sheets Task Tracker became terminal Tasks with legacy_migration
-- Evaluations worth 29 392 Task Points for 219 Members, and the import
-- script's read-back matched its file for every Group and Member (recorded on
-- #1049). This file closes the source for good:
--
-- 1. public.import_legacy_tasks and public.legacy_task_import_totals are
--    dropped, so no holder of the secret key can run the import again.
-- 2. private.reject_legacy_evaluation_source refuses every legacy_migration
--    Evaluation again, as #317 did. Its one exception -- a Task registered in
--    public.legacy_task_imports -- was the import's door; with 5 411 Tasks
--    registered it would let a second legacy Evaluation onto any of them.
-- 3. public.legacy_task_imports stays, untouched, as the record of which
--    sheet row became which Task; no function writes it any more.

-- ---------------------------------------------------------------------------
-- 1. The command and its read-back
-- ---------------------------------------------------------------------------
drop function public.import_legacy_tasks(uuid, jsonb, boolean);
drop function public.legacy_task_import_totals();

-- ---------------------------------------------------------------------------
-- 2. The legacy source, closed for every Task
-- ---------------------------------------------------------------------------
-- It no longer reads the registry, so it no longer needs to run as definer.
create or replace function private.reject_legacy_evaluation_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'task_evaluation_legacy_source_closed';
end;
$$;

comment on function private.reject_legacy_evaluation_source() is
  '#317, #1049, #1050: BEFORE INSERT on public.task_evaluations for source = legacy_migration. Refuses every such Evaluation with 23514 task_evaluation_legacy_source_closed: the Legacy Import ran once (2026-10-17) and its command is dropped, so no Task -- registered in public.legacy_task_imports or not -- takes a legacy Evaluation again.';

-- ---------------------------------------------------------------------------
-- 3. The registry, a record
-- ---------------------------------------------------------------------------
comment on table public.legacy_task_imports is
  '#1049, #1050: one row per row of a legacy Google Sheets Task Tracker that the Legacy Import turned into a Task -- the Drive file id of the tracker, the row number in its Tasks tab (header = 1), the sheet''s own Id (not unique there) and the Task. Written once, by the production run of 2026-10-17; since #1050 no function writes or reads it. A Task later deleted for good keeps its row with task_id null. RLS on with one restrictive deny-all policy for the client roles and no grant to any role. Excluded from the live change broadcast.';
