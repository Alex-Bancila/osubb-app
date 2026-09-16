-- #345: retire the legacy Task write paths, `task_assignees` and `task_requests`.
-- ADR-0007 (house rule 13): a Task is created, queued for, taken, worked,
-- reviewed, evaluated, reopened, cancelled and paid out only through the
-- atomic commands #327-#344 shipped. After this migration nothing but those
-- commands may write a Task row, and the multi-assignee join table and the
-- award/new-task request table are gone for good.
--
-- What goes, and what replaced it
-- -------------------------------
--   * `tasks_create_legacy` / `tasks_update_legacy` / `tasks_delete_legacy`
--     (`auth_level() >= 4`, split out of `task_write` by #318) -> the
--     seventeen `public.<verb>_<noun>` commands. `tasks_read` stays: reading
--     a Task is still a policy question, writing one no longer is.
--   * `assignee_manage` / `assignee_read` on `public.task_assignees` ->
--     `task_assignments` (#286) plus `task_assignments_read` (#294).
--     `assignee_manage` was `for all`, so it also answered SELECT — the leak
--     Stack C's review logged as I1. It dies with the table.
--   * `public.claim_open_task(bigint)` (#295's atomic volunteer claim) ->
--     `public.express_task_interest` / `public.select_task_candidate` /
--     `public.assign_task_executor` (#330, #333, #342).
--   * `private.task_is_unassigned(bigint)` -> nothing. It existed only to
--     answer "does this Task have a legacy assignee row?" for
--     `claim_open_task` and for the `task_read` policy #318 replaced; with
--     both gone it is a `security definer` function, granted to
--     `authenticated`, whose body names a table that no longer exists.
--     Dropping it is part of retiring the same path, not extra scope.
--   * `public.task_requests` and its `request_create` / `request_decide` /
--     `request_read` policies, plus the `public.request_kind` /
--     `public.request_status` enums -> `public.completed_work_requests`
--     (#319) and the three request commands (#344). ADR-0007: "A
--     Completed-work Request ... replaces both award requests and new-task
--     requests."
--
-- No drop below carries `cascade`. Postgres refuses to drop a table or a
-- type a view or a function still depends on, and that refusal is the point:
-- a dependent found that way gets fixed here, explicitly, rather than being
-- silently destroyed by a cascade.
--
-- Data safety on a live database
-- ------------------------------
-- `task_assignees` holds real rows on staging. #290
-- (`20260911106000_backfill_task_assignments.sql`) already copied every one
-- of them into `task_assignments`, so this migration does NOT re-copy — a
-- second backfill would duplicate history and trip
-- `task_assignments_one_active_per_task_uidx`. What it does instead is
-- verify the copy before destroying the source: the `do` block below counts
-- `task_assignees` rows with no matching `task_assignments (task_id,
-- member_id)` and aborts the whole migration if it finds any. On a database
-- whose history we cannot see, that check is the difference between a
-- retirement and a data loss.

do $$
declare
  v_orphans bigint;
  v_sample  text;
begin
  select count(*)
    into v_orphans
    from public.task_assignees legacy
   where not exists (
     select 1
       from public.task_assignments assignment
      where assignment.task_id = legacy.task_id
        and assignment.member_id = legacy.member_id
   );

  if v_orphans > 0 then
    select string_agg(format('(task %s, member %s)', sample.task_id, sample.member_id), ', '
                      order by sample.task_id, sample.member_id)
      into v_sample
      from (
        select legacy.task_id, legacy.member_id
          from public.task_assignees legacy
         where not exists (
           select 1
             from public.task_assignments assignment
            where assignment.task_id = legacy.task_id
              and assignment.member_id = legacy.member_id
         )
         order by legacy.task_id, legacy.member_id
         limit 20
      ) sample;

    raise exception using
      message = 'legacy_assignees_not_backfilled',
      detail = format(
        '%s task_assignees row(s) have no matching task_assignments (task_id, member_id). %s: %s',
        v_orphans,
        case when v_orphans > 20 then 'First 20' else 'They are' end,
        v_sample),
      hint = 'Stop the deployment. Add a reviewed forward repair migration, ordered before 20260915193604, that reconstructs the missing public.task_assignments rows; then redeploy from migrations. Do not edit hosted rows by hand. Dropping public.task_assignees now would destroy assignment history that exists nowhere else.';
  end if;
end
$$;

-- ==================== 1. the legacy direct-write policies on tasks ====================

drop policy tasks_create_legacy on public.tasks;
drop policy tasks_update_legacy on public.tasks;
drop policy tasks_delete_legacy on public.tasks;

-- ==================== 2. task_assignees and its claim command ====================

drop policy assignee_manage on public.task_assignees;
drop policy assignee_read on public.task_assignees;

-- Dropped before the table: the function's body names `task_assignees`, and
-- leaving a broken definer command behind is worse than an extra statement.
drop function public.claim_open_task(bigint);
drop function private.task_is_unassigned(bigint);

drop table public.task_assignees;

-- ==================== 3. task_requests and its enums ====================

drop policy request_create on public.task_requests;
drop policy request_decide on public.task_requests;
drop policy request_read on public.task_requests;

drop table public.task_requests;

drop type public.request_kind;
drop type public.request_status;

-- ==================== 4. belt and braces: no direct DML on the Task surface ====================
-- Every one of these tables already has a command that owns its writes, and
-- most already carry this revoke from the migration that introduced their
-- command (conventions §2). Repeating it here is idempotent and makes the
-- posture readable in one place: after #345 `authenticated` may SELECT the
-- Task surface and nothing else. `service_role` is deliberately untouched —
-- narrowing it is #295's audit, not this migration's.

revoke insert, update, delete on table
  public.tasks,
  public.task_assignments,
  public.task_candidates,
  public.task_activity,
  public.task_evaluations,
  public.campaigns,
  public.completed_work_requests
from authenticated;
