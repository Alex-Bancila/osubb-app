-- #1049: the one-time Legacy Import of the Google Sheets Task Tracker (spec 2026-10-13, ruling R53)
--
-- OSUBB's pre-app points system is imported once, as real Tasks dated on the
-- day the work was completed. This file adds:
--
-- 1. public.legacy_task_imports: which sheet row became which Task. It is the
--    import's idempotency key (a re-run skips a registered row) and the only
--    thing the legacy-source trigger accepts.
-- 2. private.reject_legacy_evaluation_source: #317 closed the reserved
--    `legacy_migration` Evaluation source for good and said a later backfill
--    would disable the trigger "deliberately". This one does not disable it:
--    the trigger now lets the source through for a registered Task only, so
--    nothing else can ever write it and no window opens.
-- 3. public.import_legacy_tasks: the bulk command, service role only.
-- 4. public.legacy_task_import_totals: the read the import script compares
--    its file with.
--
-- 3 and 4 are dropped by #1050 once the production run is verified. The
-- registry stays as provenance.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
create table public.legacy_task_imports (
  tracker_id  text    not null,
  sheet_row   integer not null,
  sheet_id    text,
  task_id     bigint  references public.tasks (id) on delete set null,
  imported_by uuid    references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint legacy_task_imports_pkey primary key (tracker_id, sheet_row),
  constraint legacy_task_imports_task_id_key unique (task_id),
  constraint legacy_task_imports_tracker_id_ck check (tracker_id ~ '^[A-Za-z0-9_-]{20,80}$'),
  constraint legacy_task_imports_sheet_row_ck check (sheet_row between 2 and 100000),
  constraint legacy_task_imports_sheet_id_ck check (sheet_id is null or char_length(sheet_id) between 1 and 40)
);

alter table public.legacy_task_imports enable row level security;
revoke all on table public.legacy_task_imports from public, anon, authenticated, service_role;

comment on table public.legacy_task_imports is
  '#1049: one row per row of a legacy Google Sheets Task Tracker that the Legacy Import turned into a Task -- the Drive file id of the tracker, the row number in its Tasks tab (header = 1), the sheet''s own Id (not unique there) and the Task. A Task later deleted for good keeps its row with task_id null, so the key stays claimed and a later call still skips the row. RLS on with no policy and no grant to any role: public.import_legacy_tasks writes it and public.legacy_task_import_totals reads it, both as definer. Excluded from the live change broadcast.';

-- ---------------------------------------------------------------------------
-- 2. The legacy source, closed except for a registered Task
-- ---------------------------------------------------------------------------
create or replace function private.reject_legacy_evaluation_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1
               from public.legacy_task_imports as imported
              where imported.task_id = new.task_id) then
    return new;
  end if;
  raise exception using
    errcode = '23514',
    message = 'task_evaluation_legacy_source_closed';
end;
$$;

revoke all on function private.reject_legacy_evaluation_source()
  from public, anon, authenticated, service_role;

comment on function private.reject_legacy_evaluation_source() is
  '#317, #1049: BEFORE INSERT on public.task_evaluations for source = legacy_migration. Refuses with 23514 task_evaluation_legacy_source_closed unless the Task is registered in public.legacy_task_imports, which only the Legacy Import writes. Definer because the registry is readable by no role.';
