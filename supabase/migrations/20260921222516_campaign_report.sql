-- #625: Campaign reporting reads -- points earned and volunteers who worked
-- on a Campaign (ADR-0007 Campaigns, amended 2026-09-21: "a Campaign is a
-- label for reporting -- the points it earned and the volunteers who worked
-- on it -- and never filters who may execute a Task"). Two read-only
-- surfaces, both gated identically:
--
--   private.campaign_report_impl(p_campaign_id) -> public.campaign_report(p_campaign_id)
--     One row per volunteer who ever held the Executor Assignment on a Task
--     of this Campaign (public.task_assignments, Assignment History --
--     every Executor who was ever assigned, not only whoever ended up
--     credited): member_id, full_name, tasks_completed, points.
--
--   private.campaign_totals_impl(p_campaign_id) -> public.campaign_totals(p_campaign_id)
--     tasks_total, tasks_completed, points_total for the whole Campaign.
--
-- Points are never recomputed from Difficulty/Rating -- both read straight
-- off the ledger rows private.evaluate_task writes
-- (20260915075256_evaluate_task_and_complete_review.sql), reason in
-- ('task', 'task_reversal'), summed per Task the same way
-- private.leadership_leaderboard_impl and private.department_cup_rows
-- already sum them (20260919191515_leadership_on_groups.sql): a
-- `task_reversal` row nets against the `task` row it undoes, so a
-- reopened-and-re-evaluated Task still counts once, at its current net
-- value, never twice and never at its stale pre-reversal amount.
--
-- Rulings (#625, this migration):
--
--   1. Authority is exactly `private.can_manage_group_work(campaign.group_id)`
--      -- it already admits BC/Moderator everywhere (`actor_level() >= 6`)
--      and a live Manager/Responsible of the Campaign's own Group or an
--      ancestor (20260919183347_group_authority_kit.sql), so no second,
--      separate BC/Moderator check is needed beside it.
--
--   2. Existence is checked BEFORE authority -- the opposite order from the
--      Campaign write commands' "cheap gate" (#343,
--      20260919185516_commands_write_group_id.sql): `campaigns_read`
--      already lets every live active member see every Campaign row
--      (20260911093000_campaigns_schema.sql), so a Campaign's existence is
--      not a secret this read could leak beyond what the table policy
--      already hands out. An unauthorized caller therefore learns `PT404
--      campaign_not_found` for an unknown id and `42501
--      campaign_report_forbidden` for a real Campaign they may not manage
--      -- the ordering the issue asks for. A claimless caller, or one whose
--      Profile is not live and active, never reaches the Campaign lookup at
--      all: both functions gate on `public.auth_is_member()` plus a live
--      active Profile first (the same cheap membership gate the write
--      commands use), so id-guessing before even proving membership answers
--      the same 42501 every time, never a PT404.
--
--   3. "Executed a Task" reads `public.task_assignments` (Assignment
--      History) directly, not the ledger: a volunteer who held the
--      Executor Assignment on a Campaign Task and then gave up, or whose
--      Task ended unfulfilled or cancelled, or is not yet evaluated, still
--      appears in `campaign_report` -- with `tasks_completed = 0` and
--      `points = 0` when the ledger holds nothing for them yet. Excluding
--      them would make this report answer "who got credit", which
--      `leadership_leaderboard` already does; this report answers "who
--      worked on it", ADR-0007's own framing for a Campaign label.
--
--   4. Subtasks are included only when the Subtask's OWN row carries
--      `campaign_id = p_campaign_id` -- both functions filter
--      `tasks.campaign_id` directly and never walk `parent_task_id` to
--      infer a Subtask's Campaign from its Umbrella's (or the reverse). An
--      Umbrella never has an Executor or a ledger row of its own
--      (ADR-0007), so this is a no-op for Umbrellas either way; it only
--      matters for the Subtasks underneath one, and the rule is: infer
--      nothing, read only what the row itself carries.
--
-- Shape follows the newest set-returning read
-- (20260919191515_leadership_on_groups.sql): `security definer`, `stable`,
-- `set search_path = ''`, an `authenticated`-only execute grant on both the
-- `_impl` and the `security invoker` public wrapper (docs/backend/
-- conventions.md Sec2/Sec4 -- a read body gets the same grant shape as a
-- command body; `supabase/tests/tracker_grants.test.sql`'s `impl` category).
-- Unlike `leadership_leaderboard_impl`/`department_cup_rows`, which fold
-- their BCE+ gate into the query itself and answer an unauthorized caller
-- with zero rows, this pair raises -- the issue is explicit that an
-- unauthorized caller on a real Campaign gets `42501`, not a silently empty
-- report.
--
-- The two `_impl` bodies share one preamble byte for byte (membership,
-- existence, authority), so it lives once in
-- `private.require_campaign_report_access`, a `require_*` helper in the
-- usual sense (docs/backend/conventions.md Sec5): it raises or returns the
-- Campaign's `group_id`, gets no execute grant of its own (nothing outside
-- these two bodies may call it, and it adds no public surface), and both
-- `_impl`s call it with `perform`, not an assignment -- the returned
-- `group_id` is only needed for the authority check the helper already made,
-- so binding it to a local variable that is never read again would trip
-- plpgsql's unused-variable lint (conventions.md Sec4's own warning about
-- this exact trap).

create function private.require_campaign_report_access(p_campaign_id bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group_id bigint;
begin
  if not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = (select auth.uid())
          and profile.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_report_forbidden';
  end if;

  select campaign.group_id
    into v_group_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  if not coalesce(private.can_manage_group_work(v_group_id), false) then
    raise exception using
      errcode = '42501',
      message = 'campaign_report_forbidden';
  end if;

  return v_group_id;
end;
$$;

comment on function private.require_campaign_report_access(bigint) is
  'Shared preamble for the Campaign reporting reads: PT404 campaign_not_found for an unknown Campaign (checked before authority -- ruling 2), 42501 campaign_report_forbidden for a claimless/inactive caller or one private.can_manage_group_work refuses. Returns the Campaign''s group_id; callable only by private.campaign_report_impl/private.campaign_totals_impl, which run as its owner -- no execute grant of its own.';

create function private.campaign_report_impl(p_campaign_id bigint)
returns table (
  member_id       uuid,
  full_name       text,
  tasks_completed int,
  points          int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_campaign_report_access(p_campaign_id);

  return query
  with campaign_tasks as (
    select task.id, task.status
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- Every Member who ever held the Executor Assignment on a Campaign Task
  -- (ruling 3) -- Assignment History, not the ledger, so a give-up or an
  -- unfulfilled/cancelled outcome still leaves the volunteer on the report.
  executors as (
    select distinct assignment.member_id
      from public.task_assignments as assignment
      join campaign_tasks as ct on ct.id = assignment.task_id
  ),
  -- Net ledger rows per (member, Task): reason in ('task', 'task_reversal')
  -- is the same filter private.leadership_leaderboard_impl and
  -- private.department_cup_rows use, so a reopened-and-re-evaluated Task's
  -- reversal nets against its original credit automatically.
  ledger_rows as (
    select entry.member_id, entry.task_id, entry.delta
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
     where entry.reason in ('task', 'task_reversal')
  ),
  -- One row per (member, Task): the member's NET ledger contribution to that
  -- Task -- both points and tasks_completed are derived from this single
  -- number, never from ledger row counts (fix round 1, controller review).
  -- Without this, a Task that was completed by A, reopened, and reassigned
  -- to B (A: +N then -N, B: +M) left A with a `task` row on a `completed`
  -- Task, so A's net-zero history still counted the Task as completed for
  -- A as well as for B -- two "completions" off one Task.
  member_task_net as (
    select ledger_rows.member_id, ledger_rows.task_id,
           sum(ledger_rows.delta)::int as net_points
      from ledger_rows
     group by ledger_rows.member_id, ledger_rows.task_id
  ),
  points_by_member as (
    select member_task_net.member_id, sum(member_task_net.net_points)::int as points
      from member_task_net
     group by member_task_net.member_id
  ),
  -- A completed Task counts toward tasks_completed only where the member's
  -- OWN net on it is positive -- a fully reversed cycle (net zero, or
  -- negative from a penalty rating) is not "their" completion, whoever else
  -- went on to actually finish the Task.
  completed_by_member as (
    select member_task_net.member_id,
           count(*)::int as tasks_completed
      from member_task_net
      join campaign_tasks as ct
        on ct.id = member_task_net.task_id and ct.status = 'completed'
     where member_task_net.net_points > 0
     group by member_task_net.member_id
  )
  select executors.member_id,
         profile.full_name,
         coalesce(completed_by_member.tasks_completed, 0),
         coalesce(points_by_member.points, 0)
    from executors
    join public.profiles as profile on profile.id = executors.member_id
    left join points_by_member on points_by_member.member_id = executors.member_id
    left join completed_by_member on completed_by_member.member_id = executors.member_id
   order by coalesce(points_by_member.points, 0) desc, profile.full_name asc;
end;
$$;

comment on function private.campaign_report_impl(bigint) is
  'One row per volunteer who ever held the Executor Assignment on a Task of this Campaign (Assignment History, not the ledger -- ruling 3). points is each member''s net points_ledger sum over the Campaign''s Tasks; tasks_completed counts only a completed Task on which that member''s OWN net for it is positive (fix round 1: a fully-reversed-then-reassigned Task does not count as a completion for the member it was taken away from). PT404 campaign_not_found for an unknown Campaign, checked before authority (ruling 2); 42501 campaign_report_forbidden for a claimless/inactive caller or one private.can_manage_group_work refuses.';

create function public.campaign_report(p_campaign_id bigint)
returns table (
  member_id       uuid,
  full_name       text,
  tasks_completed int,
  points          int
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.campaign_report_impl(p_campaign_id);
$$;

comment on function public.campaign_report(bigint) is
  'Per-volunteer Campaign report (member_id, full_name, tasks_completed, points); callable only by whoever manages work in the Campaign''s Group, or BC/Moderator (private.can_manage_group_work). PT404 campaign_not_found for an unknown Campaign; 42501 campaign_report_forbidden otherwise.';

create function private.campaign_totals_impl(p_campaign_id bigint)
returns table (
  tasks_total     int,
  tasks_completed int,
  points_total    int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_campaign_report_access(p_campaign_id);

  return query
  with campaign_tasks as (
    select task.id, task.status
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  ledger_total as (
    select coalesce(sum(entry.delta), 0)::int as points_total
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
     where entry.reason in ('task', 'task_reversal')
  )
  select
    (select count(*) from campaign_tasks)::int,
    (select count(*) from campaign_tasks where status = 'completed')::int,
    (select ledger_total.points_total from ledger_total);
end;
$$;

comment on function private.campaign_totals_impl(bigint) is
  'tasks_total/tasks_completed/points_total for one Campaign -- every Task (any kind) carrying campaign_id = p_campaign_id, points summed off the points_ledger rows private.evaluate_task writes exactly as private.campaign_report_impl does. Same PT404/42501 preamble as private.campaign_report_impl -- both share private.require_campaign_report_access.';

create function public.campaign_totals(p_campaign_id bigint)
returns table (
  tasks_total     int,
  tasks_completed int,
  points_total    int
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.campaign_totals_impl(p_campaign_id);
$$;

comment on function public.campaign_totals(bigint) is
  'Whole-Campaign totals (tasks_total, tasks_completed, points_total); same authority and error shape as public.campaign_report.';

revoke execute on function private.require_campaign_report_access(bigint)
  from public, anon, authenticated, service_role;

revoke execute on function private.campaign_report_impl(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.campaign_report_impl(bigint) to authenticated;

revoke execute on function public.campaign_report(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_report(bigint) to authenticated;

revoke execute on function private.campaign_totals_impl(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.campaign_totals_impl(bigint) to authenticated;

revoke execute on function public.campaign_totals(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_totals(bigint) to authenticated;
