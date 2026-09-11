-- These columns record current lifecycle markers. The legacy schema did not
-- record transition instants, so the backfill below deliberately uses the
-- only universal server fact, created_at. Those reconstructed values are
-- deterministic migration markers, not exact historical transition times.
drop view public.tasks_with_overdue;

alter table public.tasks
  add column started_at timestamptz,
  add column submitted_at timestamptz,
  add column completed_at timestamptz,
  add column unfulfilled_at timestamptz,
  add column cancelled_at timestamptz,
  add column queue_opened_at timestamptz,
  add column queue_closed_at timestamptz,
  add column review_round integer not null default 0,
  add column returned_to_progress_at timestamptz;

update public.tasks
   set started_at = case
         when status in ('in_progress', 'in_review') then created_at
       end,
       submitted_at = case when status = 'in_review' then created_at end,
       completed_at = case when status = 'completed' then created_at end,
       unfulfilled_at = case when status = 'unfulfilled' then created_at end,
       cancelled_at = case when status = 'cancelled' then created_at end,
       queue_opened_at = case when assignment_mode = 'public' then created_at end,
       queue_closed_at = case
         when assignment_mode = 'public'
          and status in ('completed', 'unfulfilled', 'cancelled') then created_at
       end;

alter table public.tasks
  add constraint tasks_started_at_state_check check (
    started_at is null or status <> 'todo'
  ),
  add constraint tasks_submitted_at_state_check check (
    (status <> 'in_review' or submitted_at is not null)
    and (submitted_at is null
      or status in ('in_review', 'completed', 'unfulfilled', 'cancelled'))
  ),
  add constraint tasks_completed_at_state_check check (
    (status = 'completed') = (completed_at is not null)
  ),
  add constraint tasks_unfulfilled_at_state_check check (
    (status = 'unfulfilled') = (unfulfilled_at is not null)
  ),
  add constraint tasks_cancelled_at_state_check check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  add constraint tasks_review_return_check check (
    review_round >= 0
    and ((review_round > 0) = (returned_to_progress_at is not null))
  ),
  add constraint tasks_lifecycle_timestamp_order_check check (
    (started_at is null or started_at >= created_at)
    and (submitted_at is null or submitted_at >= created_at)
    and (returned_to_progress_at is null or returned_to_progress_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
    and (unfulfilled_at is null or unfulfilled_at >= created_at)
    and (cancelled_at is null or cancelled_at >= created_at)
    and (started_at is null or submitted_at is null or submitted_at >= started_at)
    and (started_at is null or returned_to_progress_at is null
      or returned_to_progress_at >= started_at)
    and (completed_at is null or started_at is null or completed_at >= started_at)
    and (completed_at is null or submitted_at is null or completed_at >= submitted_at)
    and (completed_at is null or returned_to_progress_at is null
      or completed_at >= returned_to_progress_at)
    and (unfulfilled_at is null or started_at is null or unfulfilled_at >= started_at)
    and (unfulfilled_at is null or submitted_at is null or unfulfilled_at >= submitted_at)
    and (unfulfilled_at is null or returned_to_progress_at is null
      or unfulfilled_at >= returned_to_progress_at)
    and (cancelled_at is null or started_at is null or cancelled_at >= started_at)
    and (cancelled_at is null or submitted_at is null or cancelled_at >= submitted_at)
    and (cancelled_at is null or returned_to_progress_at is null
      or cancelled_at >= returned_to_progress_at)
  ),
  add constraint tasks_queue_timestamp_state_check check (
    (assignment_mode = 'direct'
      and queue_opened_at is null
      and queue_closed_at is null)
    or
    (assignment_mode = 'public'
      and queue_opened_at is not null
      and queue_opened_at >= created_at
      and (queue_closed_at is null or queue_closed_at >= queue_opened_at)
      and (status not in ('completed', 'unfulfilled', 'cancelled')
        or queue_closed_at is not null))
  );

comment on column public.tasks.started_at is
  'Server-written lifecycle marker; legacy values may be reconstructed from created_at.';
comment on column public.tasks.completed_at is
  'Server-written completion marker; legacy values reconstructed from created_at do not prove exact completion time.';
comment on column public.tasks.queue_opened_at is
  'First opening of the Candidate Queue in the current public-mode period.';
comment on column public.tasks.review_round is
  'Number of returns from review; positive values indicate Feedback pending while in progress.';

create view public.tasks_with_overdue
with (security_invoker = on)
as
select
  task.*,
  (
    coalesce(task.deadline < statement_timestamp(), false)
    and task.status in ('todo', 'in_progress', 'in_review')
  ) as is_overdue
from public.tasks as task;

revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;

comment on view public.tasks_with_overdue is
  'RLS-aware Task query surface with overdue derived from the current clock and unfinished lifecycle state.';
