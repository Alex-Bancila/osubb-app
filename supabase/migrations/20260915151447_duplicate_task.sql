-- #341: duplicate_task -- clone a Task into a brand-new todo Task, with a
-- fresh deadline the caller supplies. ADR-0007's motivating case is a
-- recurring or misjudged Task -- one that was called off, went unfulfilled or
-- even finished -- being run again without retyping it; a completed Task is
-- just as legitimate a template as a cancelled one, so the command accepts
-- ANY source status.
--
-- Two things ship together, because the second is unusable without the
-- first:
--
--   1. public.tasks.duplicated_from_task_id, so a clone always names the Task
--      it came from -- forever, and even if the source is later cancelled
--      that pointer never dangles: the FK carries no ON DELETE clause, so it
--      defaults to NO ACTION, which does NOT null the column out on a source
--      delete -- it BLOCKS the delete outright with a foreign_key_violation
--      for as long as any clone still references the source (this FK is not
--      declared deferrable either). Concretely: a source Task that has been
--      duplicated cannot be deleted through the still-live legacy
--      tasks_delete_legacy policy until every clone pointing at it is itself
--      deleted or has its own duplicated_from_task_id cleared first. Whoever
--      retires tasks_delete_legacy in #345 should read this as a warning, not
--      a reassurance: that work needs to either accept this blocking
--      behaviour as-is, or deliberately add an ON DELETE clause / an
--      explicit clear-then-delete step -- do not assume a source-with-clones
--      delete already degrades gracefully, because today it simply fails;
--   2. public.duplicate_task / private.duplicate_task_impl, the only writer
--      of the column.
--
-- public.tasks_with_overdue is recreated here too (Sec "The view" below) --
-- the same `select task.*` expansion problem #339 documented, verified fresh
-- against pg_get_viewdef('public.tasks_with_overdue') on this branch, not
-- copied from #339's file.
--
--
-- The clone is deliberately NOT a deep copy
-- ------------------------------------------
-- Cloned: title, description, dept_id/team_id/project_id (the Origin),
-- audience, assignment_mode, and campaign_id -- but ONLY when that Campaign
-- is still active; private.validate_task_campaign (#314) raises
-- task_campaign_inactive (23514) for a newly-set inactive Campaign, and a
-- clone setting one for the first time counts as "newly set" under that
-- trigger's own tg_op = 'INSERT' branch. Rather than let the trigger reject
-- the whole command over a detail nobody asked about, the activity check is
-- read directly here and a deactivated Campaign is silently dropped -- the
-- clone is still created, just without a Campaign label.
--
-- NOT cloned, and each is a deliberate choice:
--   * kind is always 'task' -- an Umbrella is refused as a source outright
--     (state precondition below), so this is really "always the source's own
--     kind", but spelled out because a future Umbrella-cloning issue must not
--     assume this function already handles it;
--   * status is always 'todo' -- the clone has done none of the source's
--     work, whatever the source's own outcome was;
--   * deadline is the CALLER'S p_deadline, never the source's own (which may
--     be long past, especially for the cancelled/unfulfilled sources this
--     command exists for);
--   * parent_task_id is always NULL, even when the source is a Subtask. A
--     clone of a Subtask is a top-level Task: this command has no Umbrella
--     parameter and no Umbrella-authority step, so there is nothing to
--     validate a new parent against, and silently re-parenting the clone
--     under the SOURCE's Umbrella would put unrequested new work on that
--     Umbrella's rollup without its manager ever having asked for it. If a
--     future issue wants "duplicate as a Subtask of the same Umbrella", that
--     is create_task's Subtask path called with the source's fields as a
--     template, not this command;
--   * created_by is always the actor -- the clone is a new Task somebody just
--     asked for, not a copy of who happened to create the original;
--   * no Executor, no Difficulty, no Rating: the clone starts exactly where
--     create_task's own todo Task starts, direct or public.
--
--
-- Authority and locking
-- ----------------------
-- The manager of the SOURCE, not of any Umbrella: private.require_task_manager
-- resolves a Subtask's Origin from its own dept_id/team_id/project_id columns
-- (inherited from its Umbrella at creation and immutable since), so this is
-- already correct for a Subtask source without any extra step.
--
-- The source is locked plain FOR UPDATE, never FOR NO KEY UPDATE. #339's
-- FOR NO KEY UPDATE rule exists for a command that locks a PARENT and then
-- reaches for a CHILD row too -- the ABBA risk is between that second lock
-- and private.evaluate_task's implicit FK FOR KEY SHARE on the parent. This
-- command takes exactly one lock, on the source, and reaches for nothing
-- else: even in the narrow window before the kind check fires (an Umbrella
-- source is locked before it is refused), there is no second lock for a
-- concurrent evaluate_task to be waited ON by, so no cycle can form -- at
-- worst a concurrent evaluate_task's parent-naming insert blocks for the
-- brief instant this command holds the row, exactly as any two ordinary FOR
-- UPDATE holders on the same row would. FOR UPDATE is also the strength the
-- Umbrella cascade commands settle on for the row itself when nothing reaches
-- past it, and it is what create_task_impl already uses for the Umbrella it
-- locks. Do not "harmonise" this to FOR NO KEY UPDATE -- that would be
-- solving a problem this command does not have.
--
-- If the source is a Subtask, its own `duplicated` activity row is written on
-- the SOURCE, never on its Umbrella: nothing about an Umbrella's rollup
-- changes when one of its Subtasks is used as a template elsewhere, so no
-- Umbrella row is read, locked or written at all.
--
--
-- Step order inside private.duplicate_task_impl (binding)
-- ---------------------------------------------------------
--   1. p_deadline null is PT400 deadline_required, first -- malformed for
--      everyone, exactly like #327's own deadline check for an ordinary Task.
--   2. private.require_task_visible.
--   3. Lock the source FOR UPDATE, with its own `if not found` PT404 guard
--      (a concurrent hard delete is still reachable until #345 retires
--      tasks_delete_legacy).
--   4. private.require_task_manager(p_task_id) under that lock -- the
--      SOURCE's manager, matching #339's reasoning for why cancelling and
--      duplicating are manager acts and evaluating is not: neither awards
--      anybody anything.
--   5. Input validation: none beyond the deadline, already checked at step 1.
--   6. State preconditions: source.kind = 'task' (PT409 task_is_umbrella
--      otherwise) -- ANY status passes. The ADR's motivating case is an
--      unfulfilled or cancelled source, but a completed Task is just as
--      legitimate a template, so nothing here inspects status at all.
--   7. Mutate: insert the clone, log `created` on it, log `duplicated` on the
--      source, re-read and return the clone. No notification -- this command
--      sends none; nobody is owed one for a Task that has not happened yet.
--
--
-- Rows this command may change, exhaustively: public.tasks (one new row) and
-- public.task_activity (two new rows, one per Task). It never touches
-- task_assignments, task_candidates, task_evaluations, points_ledger or
-- notifications.

-- ==================== 1. The column ====================
alter table public.tasks
  add column duplicated_from_task_id bigint references public.tasks (id);

create index tasks_duplicated_from_task_id_idx
  on public.tasks (duplicated_from_task_id)
  where duplicated_from_task_id is not null;

comment on column public.tasks.duplicated_from_task_id is
  'The Task this one was cloned from, forever -- set once at INSERT by private.duplicate_task_impl and never written again. Null for every Task that was not created by public.duplicate_task.';

-- ==================== 2. The view ====================
-- Recreated so `task.*` expands to include duplicated_from_task_id.
-- Definition, storage parameter, grants and comment are #339's, unchanged
-- except for the column riding along with the star -- verified fresh against
-- pg_get_viewdef('public.tasks_with_overdue') on this branch, not copied from
-- an earlier migration's text.
drop view public.tasks_with_overdue;

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

-- ==================== 3. duplicate_task ====================
create function private.duplicate_task_impl(p_task_id bigint, p_deadline timestamptz)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid;
  v_source        public.tasks%rowtype;
  v_clone         public.tasks%rowtype;
  v_campaign_id   bigint;
  v_campaign_active boolean;
begin
  -- 1. Malformed for everyone: a clone with no deadline could never satisfy
  --    an ordinary Task's own deadline_required rule, so it is refused before
  --    the gate, exactly as create_task refuses it for a fresh Task.
  if p_deadline is null then
    raise sqlstate 'PT400' using message = 'deadline_required';
  end if;

  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. Lock the source. Plain FOR UPDATE -- see the header for why this
  --    command never needs FOR NO KEY UPDATE: it takes no second lock on any
  --    other row, so no ABBA cycle with private.evaluate_task can form.
  select * into v_source from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- 4. Authority under lock: the SOURCE's manager (require_task_manager
  --    resolves a Subtask's Origin from its own dept_id/team_id/project_id,
  --    inherited from its Umbrella at creation, so this is already correct
  --    for a Subtask source with no extra step).
  perform private.require_task_manager(p_task_id);

  -- 5. Input validation: none beyond the deadline, already checked at step 1.

  -- 6. State preconditions: only the KIND is checked. Any status -- todo,
  --    in_progress, completed, unfulfilled, cancelled -- is a legitimate
  --    template; the ADR's motivating case is an unfulfilled or cancelled
  --    source, but a completed one is just as real.
  if v_source.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;

  -- 7. Mutate. The Campaign carries over only when it is still active --
  --    private.validate_task_campaign (#314) would otherwise reject a newly
  --    set inactive Campaign outright (task_campaign_inactive, 23514) on
  --    INSERT, and silently dropping the label is the more useful behaviour
  --    for a command whose whole point is to keep working, not to fail on a
  --    detail the caller did not ask about.
  v_campaign_id := null;
  if v_source.campaign_id is not null then
    select campaign.is_active into v_campaign_active
      from public.campaigns as campaign
     where campaign.id = v_source.campaign_id;
    if coalesce(v_campaign_active, false) then
      v_campaign_id := v_source.campaign_id;
    end if;
  end if;

  insert into public.tasks (
    title, description, dept_id, team_id, project_id, campaign_id,
    audience, assignment_mode, kind, status, deadline, created_by,
    parent_task_id, queue_opened_at, duplicated_from_task_id)
  values (
    v_source.title, v_source.description,
    v_source.dept_id, v_source.team_id, v_source.project_id, v_campaign_id,
    v_source.audience, v_source.assignment_mode, 'task', 'todo', p_deadline,
    v_actor, null,
    case when v_source.assignment_mode = 'public' then now() end,
    p_task_id)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));

  -- assignment_id and from/to_status stay NULL on the source's `duplicated`
  -- row: duplicating a Task does not change its own status (Global
  -- Constraints' activity-row rule), and this row is about the queue-level
  -- fact that a clone now exists, not about anyone's own assignment.
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  -- No notification: this command sends none. The clone has no Executor and
  -- no Candidate yet, and the source's own state has not changed.

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$$;

comment on function private.duplicate_task_impl(bigint, timestamptz) is
  'The SOURCE Task''s manager (private.require_task_manager, 42501 task_manage_forbidden) clones it into a brand-new todo Task with the caller''s own deadline; the actor is auth.uid(), never a parameter. A null deadline is PT400 deadline_required, raised before the membership gate. Locks the source plain FOR UPDATE (never FOR NO KEY UPDATE -- this command takes no second lock, so no ABBA cycle with private.evaluate_task can form) with an `if not found` PT404 task_not_found guard. PT409 task_is_umbrella for an Umbrella source; every other status, including completed, is accepted. Clones title, description, the Origin (dept_id/team_id/project_id), audience, assignment_mode and the Campaign -- but only when that Campaign is still active, else the clone carries none. Always sets kind = task, status = todo, created_by = the actor, parent_task_id = null (a clone of a Subtask is top-level: this command has no Umbrella parameter to re-validate a parent against), queue_opened_at = now() only when the clone is public, and duplicated_from_task_id = the source. No Executor, Difficulty or Rating. Logs `created` on the clone (details.duplicated_from_task_id) and `duplicated` on the source (details.clone_task_id, from/to_status null -- the source''s own status never changes). Sends no notification.';

create function public.duplicate_task(p_task_id bigint, p_deadline timestamptz)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.duplicate_task_impl(p_task_id, p_deadline);
$$;

comment on function public.duplicate_task(bigint, timestamptz) is
  'Clone a Task into a brand-new todo Task with a fresh deadline. Callable by the source Task''s manager -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, any active member of an Independent Team for their own Team''s Tasks, or an active Project''s lead or Responsible. Refuses an Umbrella source; any ordinary Task, whatever its own status, is a legitimate template. The clone starts with no Executor, no Candidate, no Difficulty or Rating, and is always top-level even when the source was a Subtask. Its Campaign carries over only if that Campaign is still active. Sends no notification.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.duplicate_task_impl(bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.duplicate_task(bigint, timestamptz)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.duplicate_task_impl(bigint, timestamptz) to authenticated;
grant execute on function public.duplicate_task(bigint, timestamptz) to authenticated;
