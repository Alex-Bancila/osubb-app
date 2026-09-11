-- The legacy join table records no assignment time or ordering. Refuse to
-- combine it with existing history for the same Tasks, because doing so could
-- duplicate or contradict evidence. The ordered IDs make remediation exact.
do $migration$
declare
  v_overlapping_task_ids text;
begin
  lock table public.tasks in share mode;
  lock table public.task_assignees, public.task_assignments
    in share row exclusive mode;

  select string_agg(task_id::text, ', ' order by task_id)
    into v_overlapping_task_ids
    from (
      select distinct legacy.task_id
        from public.task_assignees as legacy
        join public.task_assignments as history
          on history.task_id = legacy.task_id
    ) as overlap;

  if v_overlapping_task_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'legacy_assignment_history_overlap',
      detail = 'Tasks with both legacy assignees and Assignment history: '
        || v_overlapping_task_ids;
  end if;

-- UUID order is the only reproducible ordering fact in task_assignees. For an
-- unfinished Task, its lowest member UUID becomes the active Executor and all
-- other participants remain as history ended at the reconstructed start. For
-- a terminal Task, every participant remains ended history at the matching
-- lifecycle outcome. assigned_at uses Task.created_at because the legacy
-- schema cannot prove the real assignment instant; assigned_by stays unknown.
  with ranked_legacy as (
  select
    legacy.task_id,
    legacy.member_id,
    task.status,
    task.created_at,
    task.completed_at,
    task.unfulfilled_at,
    task.cancelled_at,
    row_number() over (
      partition by legacy.task_id order by legacy.member_id
    ) as member_order
  from public.task_assignees as legacy
  join public.tasks as task on task.id = legacy.task_id
)
insert into public.task_assignments
  (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason, end_note)
select
  legacy.task_id,
  legacy.member_id,
  legacy.created_at,
  null,
  case
    when legacy.status = 'completed' then legacy.completed_at
    when legacy.status = 'unfulfilled' then legacy.unfulfilled_at
    when legacy.status = 'cancelled' then legacy.cancelled_at
    when legacy.member_order > 1 then legacy.created_at
  end,
  case
    when legacy.status = 'completed' then 'completed'
    when legacy.status = 'unfulfilled' then 'failed'
    when legacy.status = 'cancelled' then 'cancelled'
    when legacy.member_order > 1 then 'legacy_migration'
  end,
  case
    when legacy.status in ('todo', 'in_progress', 'in_review')
     and legacy.member_order > 1
      then 'Deterministic migration: another legacy participant was selected as Executor by member UUID order.'
  end
  from ranked_legacy as legacy;
end
$migration$;

comment on table public.task_assignments is
  'Append-only Executor history. Legacy assigned_at values reconstructed from Task.created_at are deterministic markers, not exact assignment times.';
