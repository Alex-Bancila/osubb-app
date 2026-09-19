-- Refs #504: run the Group mirror fixpoint once after the mirror triggers exist, so legacy writes that landed between the #508 and #509 deploys are mirrored.
--
-- `private.sync_groups_from_legacy()` is idempotent: every sync it calls upserts with an
-- `is distinct from` guard, so re-running it against a mirror that is already correct
-- writes nothing. #508's own idempotency assertions (`groups_backfill.test.sql`) and
-- #509's fixpoint assertion (`groups_sync.test.sql`) both prove this, so this call is
-- always safe, whether or not the S1 window it repairs ever produced a drifted row.
select private.sync_groups_from_legacy();

-- Nit: `private.cascade_group_path`'s own comment never carried the one-re-parent-per-
-- statement contract (only conventions.md §10 and the #509 PR did) — restate the
-- existing purpose and add it here so `\df+ private.cascade_group_path` shows the whole
-- story.
comment on function private.cascade_group_path() is
  'Rewrites every descendant''s ancestor prefix when a Group is re-parented. Touches only `path`, so the column-scoped hierarchy trigger does not re-fire and there is no recursion (#507). Re-parent one row per statement: a multi-row re-parent in one statement can strand a grandchild prefix.';
