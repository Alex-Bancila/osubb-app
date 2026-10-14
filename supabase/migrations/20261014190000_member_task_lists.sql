-- Fast reads everywhere, part 2 (docs/superpowers/specs/2026-10-14-member-reads-design.md):
-- the Member's lists in the list reader of #1052.
--
-- Taskurile mele read every Assignment of the Member with its Task, then the
-- parent titles, then the Executors: three requests one after another, all
-- of it whole. Disponibile read the Member's Groups and Candidatures, then
-- the open Tasks, then the Tasks of pending Candidatures, then the
-- Executors. Both become lists of public.task_list:
--   mine      -- the Tasks whose newest Assignment of the caller did not end
--               in gave_up, replaced, task_updated or group_changed;
--   available -- the open public Tasks of kind task the caller reads with a
--               queue still open, and every public Task of kind task the
--               caller is a pending Candidate on (no finished part).
-- Each row gains my_candidature: the status of the caller's newest
-- Candidature on the Task, or null. For mine and available the embedded
-- Assignments, Evaluations and Submission are what the read policies of
-- those tables give the caller (their own rows; every row from level 5 up or
-- on a Task they manage; a Submission also through Shared Work Visibility);
-- the leadership lists keep embedding every row, which their callers read.
-- Grupuri preferate (R43) never narrows a Member's own lists.

-- ==================== 1. The scope: two more lists ====================

create or replace function private.task_list_scope(p_list text)
returns table(task_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  -- One row for a caller with org claims and a live activ Profile; none
  -- otherwise, which empties everything below (no rows, never an error).
  with caller as materialized (
    select (select auth.uid()) as id, level.value as level
      from (select private.actor_level() as value) as level
     where coalesce(public.auth_is_member(), false)
       and level.value is not null
  ),
  -- Each Group judged once, by the helpers the per-Task rules call.
  --   managed: `listed` is can_manage_group_work; `whole` is the part of
  --     private.can_manage_task that does not read the Executor (level 6 up,
  --     a Group Manager on the path, or no Manager anywhere on it).
  --   all: `listed` is rule R1 of private.can_read_task (level 5 up and a
  --     Group the caller can see); nothing below level 5.
  judged as materialized (
    select grp.id,
           case p_list
             when 'managed' then private.can_manage_group_work(grp.id)
             when 'all' then caller.level >= 5 and private.can_see_group(grp.id, caller.id)
             else false
           end as listed,
           case
             when p_list <> 'managed' then true
             when caller.level >= 6 then true
             else private.group_role_of(grp.id, caller.id) = 'manager'
                  or not private.has_group_manager(grp.id)
           end as whole
      from caller
     cross join public.groups as grp
     where p_list in ('managed', 'all')
  )
  select task.id
    from judged
    join public.tasks as task on task.group_id = judged.id
   where case p_list
           -- A Task of a listed Group is managed when the Group is whole or
           -- nobody executes it (what can_manage_task answers there); any
           -- other Task of a listed Group is asked of can_manage_task itself.
           when 'managed' then
             judged.listed
             and (judged.whole
                  or not exists (select 1 from public.task_assignments as held
                                  where held.task_id = task.id and held.ended_at is null)
                  or private.can_manage_task(task.id))
           -- Outside a listed Group a Task is still read through the caller's
           -- own Assignment or Candidature: can_read_task decides.
           when 'all' then
             (select caller.level from caller) >= 5
             and (judged.listed or private.can_read_task(task.id))
           else false
         end
  union all
  -- mine: the newest own Assignment of each Task decides; leaving it (given
  -- up, replaced, taken off by an edit or a change of Group) drops the Task.
  -- An own Assignment is always readable (R2).
  select own.task_id
    from (select distinct on (assignment.task_id) assignment.task_id, assignment.end_reason
            from caller
            join public.task_assignments as assignment on assignment.member_id = caller.id
           where p_list = 'mine'
           order by assignment.task_id, assignment.assigned_at desc, assignment.id desc) as own
   where coalesce(own.end_reason, '') not in ('gave_up', 'replaced', 'task_updated', 'group_changed')
  union all
  -- available: an open public Opportunity tasks_read gives the caller (the
  -- same sets, the same test), and the Tasks of their pending Candidatures,
  -- read through R2 whatever their queue.
  select open_work.id
    from (select task.id
            from caller
           cross join public.tasks as task
           where p_list = 'available'
             and task.kind = 'task'
             and task.assignment_mode = 'public'
             and task.queue_closed_at is null
             and task.status in ('todo', 'in_progress', 'in_review')
             and (   task.id = any ((select private.own_task_ids())::bigint[])
                  or task.parent_task_id = any ((select private.own_task_ids())::bigint[])
                  or task.group_id = any ((select private.task_read_groups('whole'))::bigint[])
                  or task.group_id = any ((select private.task_read_groups('open'))::bigint[])
                  or (    task.audience = 'org'
                      and task.group_id = any ((select private.task_read_groups('org'))::bigint[])))
          union
          select task.id
            from caller
            join public.task_candidates as candidature on candidature.member_id = caller.id
            join public.tasks as task on task.id = candidature.task_id
           where p_list = 'available'
             and candidature.status = 'pending'
             and task.kind = 'task'
             and task.assignment_mode = 'public') as open_work;
$$;

comment on function private.task_list_scope(text) is
  'The Tasks of a Task list for the caller. Leadership lists, authority decided once per Group: ''managed'' is exactly public.my_managed_task_ids() (private.can_manage_task, which implies tasks_read), ''all'' is exactly what tasks_read returns from level 5 up and nothing below; private.can_manage_task and private.can_read_task remain the per-Task fallback for the rows a Group cannot decide. The Member''s lists (spec 2026-10-14 member reads): ''mine'' is every Task whose newest Assignment of the caller did not end in gave_up, replaced, task_updated or group_changed; ''available'' is every open public Task of kind task with an open queue that tasks_read gives the caller (private.own_task_ids and private.task_read_groups, as the policy reads them), plus every public Task of kind task the caller is a pending Candidate on. No rows without org claims or a live activ Profile, or for any other list.';

-- ==================== 2. The argument check knows the new lists ====================

drop function private.require_task_list_args(text, text, text, integer, integer);
create function private.require_task_list_args(
  p_list text,
  p_finished boolean,
  p_state text,
  p_sort text,
  p_limit integer,
  p_offset integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_list is null
     or p_list not in ('managed', 'all', 'mine', 'available')
     or (p_list = 'available' and coalesce(p_finished, false)) then
    raise sqlstate 'PT400' using message = 'invalid_list';
  end if;
  if p_state is not null and p_state not in ('completed', 'unfulfilled', 'cancelled', 'late') then
    raise sqlstate 'PT400' using message = 'invalid_state';
  end if;
  if p_sort is null or p_sort not in ('deadline', 'title') then
    raise sqlstate 'PT400' using message = 'invalid_sort';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 or p_offset is null or p_offset < 0 then
    raise sqlstate 'PT400' using message = 'invalid_page';
  end if;
end;
$$;

comment on function private.require_task_list_args(text, boolean, text, text, integer, integer) is
  'The malformed-call refusals of public.task_list and public.task_list_summary, all PT400: invalid_list (not managed, all, mine or available; or available with p_finished true -- it has no finished part), invalid_state (not completed, unfulfilled, cancelled or late), invalid_sort (not deadline or title), invalid_page (p_limit outside 1..500 or p_offset below 0).';

revoke execute on function private.require_task_list_args(text, boolean, text, text, integer, integer)
  from public, anon, authenticated, service_role;

-- ==================== 3. task_list: my_candidature, and embeds by the policies ====================

drop function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer);
drop function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer);

create function private.task_list_impl(
  p_list text,
  p_finished boolean,
  p_group_id bigint,
  p_campaign_id bigint,
  p_from timestamptz,
  p_to timestamptz,
  p_state text,
  p_search text,
  p_preferred boolean,
  p_sort text,
  p_limit integer,
  p_offset integer)
returns table(
  id bigint,
  group_id bigint,
  title text,
  description text,
  status public.task_status,
  deadline timestamptz,
  completed_at timestamptz,
  review_round integer,
  assignment_mode text,
  audience text,
  kind text,
  parent_task_id bigint,
  campaign_id bigint,
  duplicated_from_task_id bigint,
  queue_closed_at timestamptz,
  links jsonb,
  assignments jsonb,
  evaluations jsonb,
  submission jsonb,
  executor jsonb,
  my_candidature text,
  total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_task_list_args(p_list, p_finished, p_state, p_sort, p_limit, p_offset);
  select private.require_date_range(p_from, p_to);

  with reader as materialized (
    -- Who embeds what. A leadership list's caller reads every row of these
    -- tables; for the Member's lists the read policies decide: own rows,
    -- every row from level 5 up (private.is_global_task_reader), or on a Task
    -- the caller manages (private.can_manage_task, as the managed scope).
    select (select auth.uid()) as id,
           p_list in ('managed', 'all')
           or coalesce((select private.actor_level()) >= 5, false) as whole
  ),
  managed as materialized (
    select scope.task_id
      from private.task_list_scope('managed') as scope
     where p_list in ('mine', 'available')
       and not (select reader.whole from reader)
  ),
  muted as (
    -- R43: the Groups the caller unselected that private.group_muted_for
    -- still honours, for the preferred view of a leadership list only; it
    -- never narrows the Member's own lists.
    select unselected.group_id
      from public.member_group_unselected as unselected
     where coalesce(p_preferred, false)
       and p_list in ('managed', 'all')
       and unselected.member_id = (select auth.uid())
       and private.group_muted_for(unselected.group_id, unselected.member_id)
  ),
  needle as (
    select private.fold_search(btrim(coalesce(p_search, ''))) as value
  ),
  matched as (
    select task.id, task.group_id, task.title, task.description, task.status, task.deadline,
           task.completed_at, task.review_round, task.assignment_mode, task.audience, task.kind,
           task.parent_task_id, task.campaign_id, task.duplicated_from_task_id,
           task.queue_closed_at, task.links,
           task.status in ('completed', 'unfulfilled', 'cancelled') as finished
      from private.task_list_scope(p_list) as scope
      join public.tasks as task on task.id = scope.task_id
      join public.groups as task_group on task_group.id = task.group_id
     cross join needle
     where (p_finished is null
            or (task.status in ('completed', 'unfulfilled', 'cancelled')) = p_finished)
       -- The Work Filter (#677): the Group subtree, the exact Campaign, and
       -- the deadline in [p_from, p_to), so an undated Task is outside any range.
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and (p_from is null or task.deadline >= p_from)
       and (p_to is null or task.deadline < p_to)
       and (p_state is null
            or case p_state
                 when 'late' then task.status = 'completed' and task.completed_at > task.deadline
                 else task.status::text = p_state
               end)
       and (needle.value = '' or strpos(private.fold_search(task.title), needle.value) > 0)
       and task.group_id not in (select muted.group_id from muted)
  ),
  placed as (
    -- Open Tasks first, soonest deadline first; then finished ones, newest
    -- deadline first; undated last in both. A title sort leads inside each
    -- part; the Member's lists also break an equal deadline by the title,
    -- as their pages did. The id ends every tie, so a page boundary never
    -- wobbles.
    select matched.*,
           count(*) over () as total,
           row_number() over (
             order by matched.finished,
                      (case when p_sort = 'title' then matched.title end) collate pg_catalog."ro-x-icu",
                      (case when not matched.finished then matched.deadline end) asc nulls last,
                      (case when matched.finished then matched.deadline end) desc nulls last,
                      (case when not matched.finished and p_list in ('mine', 'available')
                            then matched.title end) collate pg_catalog."ro-x-icu",
                      (case when matched.finished then -matched.id else matched.id end)) as place
      from matched
  ),
  page as (
    select placed.* from placed order by placed.place limit p_limit offset p_offset
  )
  select page.id, page.group_id, page.title, page.description, page.status, page.deadline,
         page.completed_at, page.review_round, page.assignment_mode, page.audience, page.kind,
         page.parent_task_id, page.campaign_id, page.duplicated_from_task_id,
         page.queue_closed_at, page.links,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', held.id, 'member_id', held.member_id, 'ended_at', held.ended_at)
                    order by held.id)
             from public.task_assignments as held
            where held.task_id = page.id
              and (   (select reader.whole from reader)
                   or held.member_id = (select reader.id from reader)
                   or page.id in (select managed.task_id from managed))), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', evaluation.id, 'difficulty', evaluation.difficulty,
                    'rating', evaluation.rating, 'points', evaluation.points,
                    'reversed_at', evaluation.reversed_at)
                    order by evaluation.id)
             from public.task_evaluations as evaluation
            where evaluation.task_id = page.id
              and (   (select reader.whole from reader)
                   or evaluation.evaluated_by = (select reader.id from reader)
                   or exists (select 1 from public.task_assignments as own
                               where own.id = evaluation.assignment_id
                                 and own.member_id = (select reader.id from reader))
                   or page.id in (select managed.task_id from managed))), '[]'::jsonb),
         -- The latest `submitted` history row the caller reads: the
         -- Submission Note (#685).
         coalesce((
           select jsonb_build_array(jsonb_build_object(
                    'id', event.id, 'kind', event.kind, 'note', event.note,
                    'details', event.details, 'occurred_at', event.occurred_at))
             from public.task_activity as event
            where event.task_id = page.id
              and event.kind = 'submitted'
              and (   (select reader.whole from reader)
                   or event.actor_id = (select reader.id from reader)
                   or exists (select 1 from public.task_assignments as own
                               where own.id = event.assignment_id
                                 and own.member_id = (select reader.id from reader))
                   or page.id in (select managed.task_id from managed)
                   or private.is_task_team_member(page.id))
            order by event.id desc
            limit 1), '[]'::jsonb),
         -- The Executor, by the rule of private.visible_task_executors (#499,
         -- #861): the open Assignment of an open Task, or the latest Assignment
         -- the Evaluation of a completed or unfulfilled Task ended; none otherwise.
         (select jsonb_build_object(
                   'member_id', executor.member_id, 'full_name', profile.full_name,
                   'nickname', profile.nickname, 'is_current', executor.is_current)
            from (select held.member_id, held.ended_at is null as is_current
                    from public.task_assignments as held
                   where held.task_id = page.id
                     and ((held.ended_at is null
                           and page.status not in ('completed', 'unfulfilled', 'cancelled'))
                          or (page.status in ('completed', 'unfulfilled')
                              and held.end_reason in ('completed', 'failed')))
                   order by held.ended_at desc nulls first, held.id desc
                   limit 1) as executor
            left join public.profiles as profile on profile.id = executor.member_id),
         (select candidature.status
            from public.task_candidates as candidature
           where candidature.task_id = page.id
             and candidature.member_id = (select reader.id from reader)
           order by candidature.id desc
           limit 1),
         page.total
    from page
   order by page.place;
$$;

comment on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) is
  'Body of public.task_list. The rows are private.task_list_scope(p_list), narrowed by the Work Filter on the Task itself (Group subtree, Campaign, deadline in [p_from, p_to)), a finished state, the folded title search and -- p_preferred, R43, leadership lists only -- the Groups the caller keeps selected; ordered open first then finished newest first (the Member''s lists break an equal deadline of an open Task by its title); cut by p_limit and p_offset with the unpaged count in total. Each row carries its Assignment History, its Evaluations, its latest submission and its Executor -- whole for the leadership lists, whose callers read every row; for mine and available exactly the rows the read policies of those tables give the caller -- and my_candidature, the status of the caller''s newest Candidature on it.';

create function public.task_list(
  p_list text,
  p_finished boolean default null,
  p_group_id bigint default null,
  p_campaign_id bigint default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_state text default null,
  p_search text default null,
  p_preferred boolean default false,
  p_sort text default 'deadline',
  p_limit integer default 500,
  p_offset integer default 0)
returns table(
  id bigint,
  group_id bigint,
  title text,
  description text,
  status public.task_status,
  deadline timestamptz,
  completed_at timestamptz,
  review_round integer,
  assignment_mode text,
  audience text,
  kind text,
  parent_task_id bigint,
  campaign_id bigint,
  duplicated_from_task_id bigint,
  queue_closed_at timestamptz,
  links jsonb,
  assignments jsonb,
  evaluations jsonb,
  submission jsonb,
  executor jsonb,
  my_candidature text,
  total bigint)
language sql
stable
set search_path = ''
as $$
  select *
    from private.task_list_impl(
           p_list, p_finished, p_group_id, p_campaign_id, p_from, p_to,
           p_state, p_search, p_preferred, p_sort, p_limit, p_offset);
$$;

comment on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) is
  'A page of a Task list, ready to draw, in one request. p_list: managed (the Tasks the caller manages, exactly my_managed_task_ids()), all (every Task the caller reads, from level 5 up), mine (Taskurile mele: the Tasks the caller holds or held to the end) or available (Disponibile: the open public Opportunities the caller reads and the Tasks of their pending Candidatures; no finished part). p_finished: true the finished Tasks, false the open ones, null both. The Work Filter reads the Task: p_group_id that Group and every Group below it, p_campaign_id exact, the deadline in [p_from, p_to). p_state: completed, unfulfilled, cancelled, or late (completed after its deadline). p_search: the title contains it, case and diacritics ignored. p_preferred (R43): without the Groups the caller unselected, for managed and all. Order: open first by deadline ascending (mine and available then by title), then finished by deadline descending, undated last; p_sort title leads with the title inside each part. p_limit 1..500 and p_offset cut the page; total is the count before the cut. my_candidature: the caller''s newest Candidature status on the Task, or null. PT400 invalid_list, invalid_state, invalid_sort, invalid_page, invalid_date_range. No rows without org claims or a live activ Profile.';

revoke execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  to authenticated;
grant execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  to authenticated;

-- ==================== 4. task_list_summary: the new argument check ====================

create or replace function private.task_list_summary_impl(p_list text)
returns table(
  group_id bigint,
  campaign_id bigint,
  status public.task_status,
  late boolean,
  dated boolean,
  tasks bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_task_list_args(p_list, null, null, 'deadline', 1, 0);

  select task.group_id,
         task.campaign_id,
         task.status,
         coalesce(task.status = 'completed' and task.completed_at > task.deadline, false),
         task.deadline is not null,
         count(*)
    from private.task_list_scope(p_list) as scope
    join public.tasks as task on task.id = scope.task_id
   group by 1, 2, 3, 4, 5
   order by 1, 2, 3, 4, 5;
$$;

comment on function private.task_list_summary_impl(text) is
  'Body of public.task_list_summary: private.task_list_scope(p_list) -- managed, all, mine or available -- counted by the Task''s Group, Campaign, status, whether it was completed after its deadline, and whether it carries a deadline.';
