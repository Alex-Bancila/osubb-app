-- R57 (Alex, 2026-10-14; spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md):
-- a public Task's Minimum Level -- the lowest Level that sees it as an
-- Opportunity or through Shared Work Visibility and may join its Candidate
-- Queue. It never gates a Group Role on the path, BCE and above, or one's own
-- Assignments and Candidatures, and it never widens who the Audience reaches.
-- Every existing Task gets 0, so nothing anyone sees changes until a Role is
-- chosen. Bodies restated here are main's latest with only the R57 lines added.

-- ==================== 1 · the column ====================
alter table public.tasks
  add column min_level integer not null default 0,
  add constraint tasks_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6)),
  add constraint tasks_min_level_public_ck
    check (min_level = 0 or (kind = 'task' and assignment_mode = 'public'));
comment on column public.tasks.min_level is
  'R57: the lowest Level that sees this public Task as an Opportunity or through Shared Work Visibility and may join its Candidate Queue -- 0 Recrut, 1 Voluntar, 2 Voluntar Activ, 3 Voluntar cu Drept de Vot, 5 BCE, 6 BC. Never widens the Audience. 0 for a direct Task and an Umbrella. Written only by the Task commands.';

-- ==================== 2 · who reads a Task ====================
create or replace function private.can_read_task(p_task_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- R2 own Assignment/Candidature (ever) -- kept outside the Private Group gate:
  -- a Task Manager may name an Executor who is not a member, and a Member's own
  -- work stays theirs to read. Every other rule reads only a Group the caller
  -- can see (#756, private.can_see_group): R1 level >= 5; R6-org an open public
  -- Opportunity whose Audience is org, for every active Member whatever the
  -- Group's Minimum Level (#794, ruling R26); then, subject to the Group's
  -- Minimum Level unless the caller holds a Group Role on the path: R3 a Group
  -- Role on the path (status-agnostic: an archived Project's former lead keeps
  -- reading its history); R4 Shared Work Visibility of a Group on the path the
  -- caller belongs to; R6-own an open public Opportunity of a Group the caller
  -- is a member of (private.is_group_member, the test the join applies), any
  -- Audience. R7 judged on the Task and its Umbrella. R57: R6-org, R6-own and R4
  -- also need the caller at or above the Task's own Minimum Level, judged on
  -- the Task itself (target), also when it is read through its Umbrella.
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
         join public.roles as caller_role on caller_role.id = caller.role
         join public.tasks as target on target.id = p_task_id
         join public.tasks as task on task.id = target.id or task.id = target.parent_task_id
         join public.groups as grp on grp.id = task.group_id
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and (
            exists (select 1 from public.task_assignments as assignment
                     where assignment.task_id = task.id and assignment.member_id = caller.id)
            or exists (select 1 from public.task_candidates as candidature
                        where candidature.task_id = task.id and candidature.member_id = caller.id)
            or (
              private.can_see_group(grp.id, caller.id)
              and (
                caller_role.level >= 5
                or (task.kind = 'task'
                    and task.audience = 'org'
                    and task.assignment_mode = 'public'
                    and task.queue_closed_at is null
                    and task.status not in ('completed', 'unfulfilled', 'cancelled')
                    and caller_role.level >= target.min_level)
                or (
                  (caller_role.level >= grp.min_level
                   or exists (select 1 from public.group_members as held
                               where held.member_id = caller.id
                                 and held.group_role in ('manager', 'responsible')
                                 and grp.path @> array[held.group_id]))
                  and (
                    exists (select 1 from public.group_members as held
                             where held.member_id = caller.id
                               and held.group_role in ('manager', 'responsible')
                               and grp.path @> array[held.group_id])
                    or (caller_role.level >= target.min_level and exists (select 1 from public.groups as shared
                                where grp.path @> array[shared.id]
                                  and shared.shared_work_visibility
                                  and (exists (select 1 from public.group_members as gm
                                                where gm.group_id = shared.id and gm.member_id = caller.id)
                                       or (shared.automatic_membership and caller_role.level >= shared.min_level))))
                    or (task.kind = 'task'
                        and task.assignment_mode = 'public'
                        and task.queue_closed_at is null
                        and task.status not in ('completed', 'unfulfilled', 'cancelled')
                        and private.is_group_member(grp.id, caller.id)
                        and caller_role.level >= target.min_level)
                  )
                )
              )
            )
          ));
$function$;

comment on function private.can_read_task(bigint) is
  'ADR-0007 as amended 2026-09-25 (ruling R26, #794) and 2026-10-14 (ruling R57) on ADR-0009 R1-R7: own Assignments and Candidatures (ever); then, for a Group the caller can see (private.can_see_group): BCE/BC/Moderator; every open organization-wide Opportunity (Audience org, public, queue open, not terminal) for every active Member at or above the Task''s own Minimum Level, whatever the Group''s; and, subject to the Group''s Minimum Level unless the caller holds a Group Role on the path: Group Managers and Responsibles on the path, Shared Work Visibility and the open Opportunities of a Group the caller is a member of (private.is_group_member), any Audience -- these two also at or above the Task''s Minimum Level. The Task''s Minimum Level is judged on the Task itself, also when it is read through its Umbrella. A local Opportunity of a Group the caller is not in is invisible. Direct Tasks, Umbrellas, closed queues and terminal Tasks stay hidden from non-participants whatever their Audience.';

-- #1064's sets: R4 leaves 'whole' for its own 'shared' set, so 'whole' keeps
-- R1 and R3, which a Task's Minimum Level never gates.
create or replace function private.task_read_groups(p_kind text)
 RETURNS bigint[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with caller as (
    select caller.id, caller_role.level
      from public.profiles as caller
      join public.roles as caller_role on caller_role.id = caller.role
     where caller.id = (select auth.uid())
       and caller.status = 'activ'
       and coalesce(public.auth_is_member(), false)
  ),
  judged as (
    select grp.id,
           private.can_see_group(grp.id, caller.id) as seen,
           caller.level >= 5 as global_reader,
           caller.level >= grp.min_level as at_level,
           exists (select 1
                     from public.group_members as held
                    where held.member_id = caller.id
                      and held.group_role in ('manager', 'responsible')
                      and grp.path @> array[held.group_id]) as role_on_path,
           exists (select 1
                     from public.groups as shared
                    where grp.path @> array[shared.id]
                      and shared.shared_work_visibility
                      and (exists (select 1
                                     from public.group_members as gm
                                    where gm.group_id = shared.id
                                      and gm.member_id = caller.id)
                           or (shared.automatic_membership
                               and caller.level >= shared.min_level))) as shared_on_path,
           private.is_group_member(grp.id, caller.id) as member
      from public.groups as grp
     cross join caller
  )
  select coalesce(array_agg(judged.id order by judged.id), '{}'::bigint[])
    from judged
   where judged.seen
     and case p_kind
           -- R1 level 5 and up; R3 a Group Role on the path. Neither is
           -- gated by a Task's own Minimum Level (R57).
           when 'whole' then judged.global_reader or judged.role_on_path
           -- R4 Shared Work Visibility on the path, at the Minimum Level unless
           -- a Group Role is held; tasks_read adds the Task's own Minimum
           -- Level (R57).
           when 'shared' then (judged.at_level or judged.role_on_path) and judged.shared_on_path
           -- R6-own: an open public Opportunity of a Group one is a member of.
           when 'open' then (judged.at_level or judged.role_on_path) and judged.member
           -- R6-org: an open public org-Audience Opportunity of any Group one sees.
           when 'org' then true
           else false
         end;
$function$;

comment on function private.task_read_groups(text) is
  'Fast reads part 1 (spec 2026-10-14 member reads), split by R57: the Group half of the Task read rule as sets, judged per Group by the expressions private.can_read_task applies to a Task''s Group, all within private.can_see_group. ''whole'': every Task of the Group is read (R1 level >= 5, or R3 a Group Role on its path). ''shared'': its Tasks are read through R4 Shared Work Visibility on the path (a roster row or Automatic Membership), at the Group''s Minimum Level unless a Group Role is held -- tasks_read adds the Task''s own Minimum Level. ''open'': its open public Opportunities, any Audience (R6-own: a member, at the Minimum Level or holding a Group Role on the path). ''org'': its open public org-Audience Opportunities (R6-org). Empty without organization claims or a live activ Profile, and for any other kind. Read by tasks_read through (select ...), once per statement.';

alter policy tasks_read on public.tasks
  using (
    (select public.auth_is_member())
    and (   id = any ((select private.own_task_ids())::bigint[])
         or parent_task_id = any ((select private.own_task_ids())::bigint[])
         or group_id = any ((select private.task_read_groups('whole'))::bigint[])
         or (    min_level <= (select private.caller_level())
             and (   group_id = any ((select private.task_read_groups('shared'))::bigint[])
                  or (    kind = 'task'
                      and assignment_mode = 'public'
                      and queue_closed_at is null
                      and status not in ('completed', 'unfulfilled', 'cancelled')
                      and (   group_id = any ((select private.task_read_groups('open'))::bigint[])
                           or (    audience = 'org'
                               and group_id = any ((select private.task_read_groups('org'))::bigint[]))))))));
comment on policy tasks_read on public.tasks is
  'The Task read rule (private.can_read_task) decided once per statement: R2/R7 through private.own_task_ids(), R1/R3 through task_read_groups(''whole''), and -- at or above the Task''s own Minimum Level (R57) -- R4 through ''shared'', R6-own and R6-org through ''open'' and ''org'' on an open public Opportunity. supabase/tests/task_read_sets.test.sql holds it to private.can_read_task for every caller.';

-- An Opportunity's card names its Group only for a caller who may see it.
create or replace function private.has_open_org_opportunity(p_group_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The same open state as can_read_task's org arm: an ordinary public Task,
  -- queue open, not terminal, Audience org -- owned by an active public Group.
  select exists (
    select 1
      from public.groups as grp
      join public.tasks as task on task.group_id = grp.id
     where grp.id = p_group_id
       and grp.status = 'active'
       and not grp.is_private
       and task.kind = 'task'
       and task.audience = 'org'
       and task.assignment_mode = 'public'
       and task.queue_closed_at is null
       and task.status not in ('completed', 'unfulfilled', 'cancelled')
       -- R57: only an Opportunity the caller may see names its Group.
       and task.min_level <= private.caller_level()
  );
$function$;

comment on function private.has_open_org_opportunity(bigint) is
  'The groups_read limb of #794 (ruling R26), gated by R57: true while an active, non-private Group owns an open organization-wide Opportunity (kind task, Audience org, public, queue open, not terminal) at or below the caller''s live Level (the Task''s own Minimum Level, private.caller_level()) -- the rows private.can_read_task shows every active Member at or above the Task''s Minimum Level, whatever the Group''s. It lets such an Opportunity''s card name and colour its Group for a Member below the Group''s Minimum Level; it stays behind groups_read''s auth_is_member() and can_see_group gates. Policy predicate: authenticated may execute it.';
