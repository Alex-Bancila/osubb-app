-- #1052: Task lists that stay fast (spec 2026-10-14).
--
-- private.can_manage_task and private.can_read_task answer for one Task, and
-- a list asked them once per row: with the Legacy Import's 5 300 finished
-- Tasks, De gestionat took 48 s and the filter options of Clasament about two
-- minutes. These readers decide a list's authority once per Group, keep the
-- per-Task rules as the fallback, and return a ready page in one request.
-- No table, policy or existing function changes.

-- ==================== 1. The search key ====================

create function private.fold_search(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Lower case with the diacritics removed after NFD, as the page's
  -- searchableTitle folds a title (JavaScript's \p{Diacritic}): the combining
  -- marks, so "sedinta" finds the s-comma and the s-cedilla spellings alike,
  -- and the spacing marks a title can carry (^ ` and U+00A8, AF, B4, B7, B8,
  -- the modifier letters). The class is written in escapes on purpose: raw
  -- combining characters in a source file do not survive every editor.
  select lower(regexp_replace(
           normalize(coalesce(p_text, ''), NFD),
           '[\u005E\u0060\u00A8\u00AF\u00B4\u00B7\u00B8\u02B0-\u036F]',
           '', 'g'));
$$;

comment on function private.fold_search(text) is
  'The case- and diacritic-insensitive key the Task list search compares: NFD, combining and spacing diacritics removed, lower case. Empty for null.';

revoke execute on function private.fold_search(text) from public, anon, authenticated, service_role;

-- ==================== 2. The scope: a list's authority ====================

create function private.task_list_scope(p_list text)
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
         end;
$$;

comment on function private.task_list_scope(text) is
  'The Tasks of a leadership list for the caller, authority decided once per Group: ''managed'' is exactly public.my_managed_task_ids() (private.can_manage_task, which implies tasks_read), ''all'' is exactly what tasks_read returns from level 5 up and nothing below. A Group is judged by the existing helpers; private.can_manage_task and private.can_read_task remain the per-Task fallback for the rows a Group cannot decide (a Responsible looking at an executed Task; a Private Group''s Task read through one''s own Assignment or Candidature). No rows without org claims or a live activ Profile, or for any other list.';

revoke execute on function private.task_list_scope(text) from public, anon, authenticated, service_role;

-- ==================== 3. task_list: a page of ready rows ====================

create function private.require_task_list_args(
  p_list text,
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
  if p_list is null or p_list not in ('managed', 'all') then
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

comment on function private.require_task_list_args(text, text, text, integer, integer) is
  'The malformed-call refusals of public.task_list, all PT400: invalid_list (not managed or all), invalid_state (not completed, unfulfilled, cancelled or late), invalid_sort (not deadline or title), invalid_page (p_limit outside 1..500 or p_offset below 0).';

revoke execute on function private.require_task_list_args(text, text, text, integer, integer)
  from public, anon, authenticated, service_role;

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
  total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_task_list_args(p_list, p_state, p_sort, p_limit, p_offset);
  select private.require_date_range(p_from, p_to);

  with muted as (
    -- R43: the Groups the caller unselected that private.group_muted_for
    -- still honours, for the preferred view only.
    select unselected.group_id
      from public.member_group_unselected as unselected
     where coalesce(p_preferred, false)
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
    -- part. The id ends every tie, so a page boundary never wobbles.
    select matched.*,
           count(*) over () as total,
           row_number() over (
             order by matched.finished,
                      (case when p_sort = 'title' then matched.title end) collate pg_catalog."ro-x-icu",
                      (case when not matched.finished then matched.deadline end) asc nulls last,
                      (case when matched.finished then matched.deadline end) desc nulls last,
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
            where held.task_id = page.id), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', evaluation.id, 'difficulty', evaluation.difficulty,
                    'rating', evaluation.rating, 'points', evaluation.points,
                    'reversed_at', evaluation.reversed_at)
                    order by evaluation.id)
             from public.task_evaluations as evaluation
            where evaluation.task_id = page.id), '[]'::jsonb),
         -- The latest `submitted` history row: the Submission Note (#685).
         coalesce((
           select jsonb_build_array(jsonb_build_object(
                    'id', event.id, 'kind', event.kind, 'note', event.note,
                    'details', event.details, 'occurred_at', event.occurred_at))
             from public.task_activity as event
            where event.task_id = page.id
              and event.kind = 'submitted'
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
         page.total
    from page
   order by page.place;
$$;

comment on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) is
  'Body of public.task_list. The rows are private.task_list_scope(p_list), narrowed by the Work Filter on the Task itself (Group subtree, Campaign, deadline in [p_from, p_to)), a finished state, the folded title search and -- p_preferred, R43 -- the Groups the caller keeps selected; ordered open first then finished newest first; cut by p_limit and p_offset with the unpaged count in total. Each row carries its whole Assignment History, its Evaluations, its latest submission and its Executor, which is what the read policies of those tables give the only callers either list has (a Task Manager; level 5 and above).';

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
  'A page of a leadership Task list, ready to draw, in one request. p_list: managed (the Tasks the caller manages, exactly my_managed_task_ids()) or all (every Task the caller reads, from level 5 up). p_finished: true the finished Tasks, false the open ones, null both. The Work Filter reads the Task: p_group_id that Group and every Group below it, p_campaign_id exact, the deadline in [p_from, p_to). p_state: completed, unfulfilled, cancelled, or late (completed after its deadline). p_search: the title contains it, case and diacritics ignored. p_preferred (R43): without the Groups the caller unselected. Order: open first by deadline ascending, then finished by deadline descending, undated last; p_sort title leads with the title inside each part. p_limit 1..500 and p_offset cut the page; total is the count before the cut. PT400 invalid_list, invalid_state, invalid_sort, invalid_page, invalid_date_range. No rows without org claims or a live activ Profile.';

revoke execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  to authenticated;
grant execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  to authenticated;

-- ==================== 4. task_list_summary: what a list holds ====================

create function private.task_list_summary_impl(p_list text)
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
  select private.require_task_list_args(p_list, null, 'deadline', 1, 0);

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
  'Body of public.task_list_summary: private.task_list_scope(p_list) counted by the Task''s Group, Campaign, status, whether it was completed after its deadline, and whether it carries a deadline.';

create function public.task_list_summary(p_list text)
returns table(
  group_id bigint,
  campaign_id bigint,
  status public.task_status,
  late boolean,
  dated boolean,
  tasks bigint)
language sql
stable
set search_path = ''
as $$
  select * from private.task_list_summary_impl(p_list);
$$;

comment on function public.task_list_summary(text) is
  'What a leadership Task list (managed or all, as public.task_list) holds, without reading a Task: its Tasks counted by Group, Campaign, status, late (completed after the deadline) and dated (a deadline is set). The page takes from it the Groups and Campaigns the Work Filter offers (Rule W), the states Stare offers and how many finished Tasks there are. PT400 invalid_list. No rows without org claims or a live activ Profile.';

revoke execute on function private.task_list_summary_impl(text) from public, anon, authenticated, service_role;
revoke execute on function public.task_list_summary(text) from public, anon, authenticated, service_role;
grant execute on function private.task_list_summary_impl(text) to authenticated;
grant execute on function public.task_list_summary(text) to authenticated;

-- ==================== 5. leadership_filter_work: where Task Points were earned ====================

create function private.leadership_filter_work_impl()
returns table(group_id bigint, campaign_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct task.group_id, task.campaign_id
    from private.task_list_scope('all') as scope
    join public.tasks as task on task.id = scope.task_id
   where task.kind = 'task'
     -- An Evaluation, through its Assignment: a reopened Task keeps its
     -- Evaluation and its reversal on the board, so it counts too.
     and exists (
       select 1
         from public.task_assignments as held
         join public.task_evaluations as evaluation on evaluation.assignment_id = held.id
        where held.task_id = task.id)
   order by 1, 2;
$$;

comment on function private.leadership_filter_work_impl() is
  'Body of public.leadership_filter_work: the distinct Group and Campaign of every Task of kind task in private.task_list_scope(''all'') that has an Evaluation through one of its Assignments.';

create function public.leadership_filter_work()
returns table(group_id bigint, campaign_id bigint)
language sql
stable
set search_path = ''
as $$
  select * from private.leadership_filter_work_impl();
$$;

comment on function public.leadership_filter_work() is
  'The Group and Campaign of every evaluated Task the caller reads, each pair once: the Work Filter choices of Clasament and Tracker membru (Rule W, #845), which carry Task Points. From level 5 up; no rows below, without org claims or without a live activ Profile.';

revoke execute on function private.leadership_filter_work_impl() from public, anon, authenticated, service_role;
revoke execute on function public.leadership_filter_work() from public, anon, authenticated, service_role;
grant execute on function private.leadership_filter_work_impl() to authenticated;
grant execute on function public.leadership_filter_work() to authenticated;

-- ==================== 6. can_manage_task: one Task ====================

create function public.can_manage_task(p_task_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- The twin of public.can_evaluate_task (#189): the Task through its own
  -- RLS, and private.can_manage_task as the only gate. No new authority.
  select coalesce(public.auth_is_member(), false) and exists (
    select 1 from public.tasks as task
     where task.id = p_task_id
       and private.can_manage_task(task.id)
  );
$$;

comment on function public.can_manage_task(bigint) is
  'Read-only capability for one Task''s manager controls and for where a Task link lands; commands revalidate authority under lock.';

revoke execute on function public.can_manage_task(bigint) from public, anon, authenticated, service_role;
grant execute on function public.can_manage_task(bigint) to authenticated;
