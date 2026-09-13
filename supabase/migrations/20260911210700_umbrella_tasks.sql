-- #315: add tasks.kind ('task'|'umbrella') and tasks.parent_task_id, with the
-- invariants for Umbrella Tasks and Subtasks (ADR-0007 Sec "Umbrella Tasks
-- and Subtasks", amended 2026-09-10): one level deep; a Subtask inherits its
-- Umbrella's Origin immutably; the Umbrella itself has no Executor, queue,
-- Difficulty, Rating, or points. Also recreates `public.tasks_with_overdue`
-- (dobrerares' #427, `select task.*, ... from public.tasks as task`) with his
-- exact definition, grants and comment: Postgres expands `*` at the moment a
-- view is created, so a `tasks` column added afterward -- kind/parent_task_id
-- here -- stays invisible through the view until it is dropped and
-- recreated.
--
-- `audience` (#285) and `assignment_mode` (#286) drop their `not null` but
-- keep their defaults ('local' / 'direct'): dobrerares' tests and
-- `supabase/seed.sql` insert ordinary Tasks without naming either column and
-- rely on the default landing them in a valid shape. Because the defaults
-- survive, an Umbrella insert that only omits audience/assignment_mode would
-- still receive 'local'/'direct' and fail `tasks_umbrella_shape_ck` -- an
-- Umbrella insert must pass explicit nulls for audience, assignment_mode,
-- difficulty and rating. `create_task` (#327) will do this; until then,
-- `tasks_umbrella.test.sql` constructs Umbrella fixtures the same way.
--
-- Overdue presentation: `tasks_with_overdue.is_overdue` is left unchanged
-- (`deadline < statement_timestamp() and status in ('todo', 'in_progress',
-- 'in_review')`), so an Umbrella past its deadline while still `todo` /
-- `in_progress` shows as overdue even though it has no Executor to chase.
-- Whether the Tracker UI should surface that differently is a presentation
-- question left for #164, not a schema decision here.
--
-- Interaction with #312 (20260911210300_tasks_nullable_difficulty.sql):
-- `tasks_evaluation_inputs_ck` predates `kind` and requires difficulty and
-- rating whenever status is completed/unfulfilled, with no exemption --
-- which, combined with `tasks_umbrella_shape_ck` below forcing both columns
-- null for an Umbrella, made an Umbrella impossible to ever complete or mark
-- unfulfilled. #315 introduces the conflict (by adding `kind` and the shape
-- constraint) and resolves it here by replacing `tasks_evaluation_inputs_ck`
-- with a version that exempts Umbrellas.

drop view public.tasks_with_overdue;

alter table public.tasks
  add column kind text not null default 'task',
  add column parent_task_id bigint references public.tasks (id);

alter table public.tasks
  add constraint tasks_kind_ck check (kind in ('task', 'umbrella'));

create index tasks_parent_idx on public.tasks (parent_task_id);

comment on column public.tasks.kind is
  'Ordinary Task or Umbrella Task (ADR-0007 Umbrella Tasks and Subtasks). An Umbrella groups Subtasks one level deep through parent_task_id and carries no Executor, queue, Difficulty, Rating, or points.';

comment on column public.tasks.parent_task_id is
  'Set only on a Subtask, referencing its Umbrella (kind = ''umbrella''). One level deep: a Subtask''s parent may not itself have a parent_task_id. A Subtask inherits the Umbrella''s Origin (dept_id/team_id/project_id) immutably. Enforced by tasks_umbrella_shape_ck / tasks_task_shape_ck / private.validate_task_hierarchy().';

-- #285 / #286: relax the `not null` so an Umbrella can hold explicit nulls;
-- the column defaults ('local' / 'direct') are untouched and keep every
-- existing ordinary Task, and every ordinary Task inserted without naming
-- these columns going forward, in a valid `tasks_task_shape_ck` shape.
alter table public.tasks
  alter column audience drop not null,
  alter column assignment_mode drop not null;

alter table public.tasks
  add constraint tasks_umbrella_shape_ck check (
    kind = 'task' or (
      parent_task_id is null
      and audience is null
      and assignment_mode is null
      and difficulty is null
      and rating is null
    )
  );

alter table public.tasks
  add constraint tasks_task_shape_ck check (
    kind = 'umbrella' or (audience is not null and assignment_mode is not null)
  );

-- Exempt an Umbrella from #312's tasks_evaluation_inputs_ck: an Umbrella's
-- completion is a rollup of its Subtasks (the `umbrella_completed` activity
-- kind, 20260911210200_task_activity.sql, exists for exactly that
-- transition), not an Evaluation, so it carries no Difficulty, Rating, or
-- points of its own. tasks_umbrella_shape_ck above already forces both
-- columns null for an Umbrella; nothing is lost by exempting it here.
alter table public.tasks
  drop constraint tasks_evaluation_inputs_ck,
  add constraint tasks_evaluation_inputs_ck check (
    kind = 'umbrella'
    or case
         when status in ('completed', 'unfulfilled')
           then difficulty is not null and rating is not null
         else rating is null
       end
  );

comment on constraint tasks_evaluation_inputs_ck on public.tasks is
  'Difficulty and Rating arrive together at Evaluation (status completed/unfulfilled) for an ordinary Task; Difficulty may already be set earlier, Rating never is (ADR-0007). An Umbrella is exempt -- its completion is a rollup of its Subtasks, not an Evaluation, and tasks_umbrella_shape_ck already forces both columns null.';

-- `security definer`: like `private.validate_task_campaign()`
-- (20260911210600_task_campaign.sql), this trigger enforces a data-integrity
-- invariant, not an authorization decision, and it must see the
-- authoritative parent/child rows regardless of who is writing
-- `public.tasks` under RLS. `task_read` hides Tasks outside the caller's
-- Department/Team/Project/assignment unless they are level>=4; run as
-- invoker, this trigger could see zero matching children for a hierarchy the
-- caller cannot read and silently miss a violation (e.g. an Umbrella's
-- existing Subtask in a Department the caller is not a member of).
-- `public.tasks` still carries the legacy `task_write` policy that lets any
-- level>=4 actor write the table directly -- the atomic Task commands that
-- will actually create Umbrellas/Subtasks (#327-#345) are not built yet.
-- Direct inserts in tests run as `postgres`, which already bypasses RLS as
-- table owner either way.
create function private.validate_task_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_children   boolean;
  v_parent_kind    text;
  v_parent_parent  bigint;
  v_parent_dept    text;
  v_parent_team    text;
  v_parent_project bigint;
begin
  -- Does this row (pre-update) already have Subtasks? Only meaningful on
  -- UPDATE -- a just-inserted row cannot yet be anyone's parent.
  if tg_op = 'UPDATE' then
    select exists (
      select 1 from public.tasks as child
       where child.parent_task_id = old.id
    ) into v_has_children;
  else
    v_has_children := false;
  end if;

  -- A Task (Umbrella or not) that already has Subtasks cannot itself become
  -- a Subtask -- that would make its own children Sub-subtasks (too deep).
  if v_has_children and new.parent_task_id is not null then
    raise exception using
      errcode = '23514',
      message = 'task_hierarchy_too_deep';
  end if;

  -- An Umbrella with existing Subtasks cannot change kind away from
  -- 'umbrella': the Subtasks would be left pointing at a non-Umbrella parent.
  if v_has_children and new.kind is distinct from 'umbrella' then
    raise exception using
      errcode = '23514',
      message = 'umbrella_has_subtasks';
  end if;

  -- An Umbrella with existing Subtasks cannot change its own Origin: the
  -- Subtasks' inherited Origin would silently fall out of sync (no cascade
  -- exists yet). Same reason as a Subtask's own origin being immutable below.
  if v_has_children and (
       new.dept_id is distinct from old.dept_id
    or new.team_id is distinct from old.team_id
    or new.project_id is distinct from old.project_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;

  -- An existing Subtask's parent and inherited Origin never change once set.
  if tg_op = 'UPDATE' and old.parent_task_id is not null and (
       new.parent_task_id is distinct from old.parent_task_id
    or new.dept_id is distinct from old.dept_id
    or new.team_id is distinct from old.team_id
    or new.project_id is distinct from old.project_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;

  if new.parent_task_id is not null then
    select parent.kind, parent.parent_task_id, parent.dept_id,
           parent.team_id, parent.project_id
      into v_parent_kind, v_parent_parent, v_parent_dept,
           v_parent_team, v_parent_project
      from public.tasks as parent
     where parent.id = new.parent_task_id
     for share;

    if v_parent_kind is distinct from 'umbrella' then
      raise exception using
        errcode = '23514',
        message = 'task_parent_not_umbrella';
    end if;

    -- One level deep: the parent itself must not be a Subtask. (Belt and
    -- suspenders -- tasks_umbrella_shape_ck already forces every Umbrella's
    -- parent_task_id to be null, so v_parent_parent should never be
    -- non-null here; kept for defense in depth.)
    if v_parent_parent is not null then
      raise exception using
        errcode = '23514',
        message = 'task_hierarchy_too_deep';
    end if;

    -- A newly linked Subtask must inherit the Umbrella's Origin exactly --
    -- whether it is linked at INSERT time or first linked later via
    -- `update ... set parent_task_id = <umbrella>` on a row that had no
    -- parent before (`old.parent_task_id is null`). A row that was already a
    -- Subtask changing its parent is already rejected by the immutability
    -- guard above, so "old.parent_task_id is null" here means exactly "not
    -- yet a Subtask". `tg_op = 'INSERT'` is checked first so the `or`
    -- short-circuits before `old` is referenced -- OLD is unassigned on
    -- INSERT and referencing it would raise "record ""old"" is not assigned
    -- yet".
    if (tg_op = 'INSERT' or old.parent_task_id is null) and (
         new.dept_id is distinct from v_parent_dept
      or new.team_id is distinct from v_parent_team
      or new.project_id is distinct from v_parent_project
    ) then
      raise exception using
        errcode = '23514',
        message = 'subtask_origin_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_task_hierarchy()
  from public, anon, authenticated, service_role;

create trigger tasks_validate_hierarchy
before insert or update of parent_task_id, dept_id, team_id, project_id, kind
on public.tasks
for each row execute function private.validate_task_hierarchy();

-- Recreate the derived overdue surface unchanged except for the new columns
-- riding along with `task.*` -- definition, grants and comment copied
-- verbatim from 20260911210600_task_campaign.sql / dobrerares' #427.
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
