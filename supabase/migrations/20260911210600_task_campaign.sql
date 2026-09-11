-- #314: attach a Department Campaign to a Task and enforce origin
-- consistency. ADR-0007 Sec Campaigns: "A Task may carry at most one
-- Campaign, and only when its Origin is that Department or one of that
-- Department's Department Teams." Also recreates `public.tasks_with_overdue`
-- (dobrerares' #427, `select task.*, ... from public.tasks as task`) with his
-- exact definition, grants and comment: Postgres expands `*` at the moment a
-- view is created, so a `tasks` column added afterward -- campaign_id here --
-- stays invisible through the view until it is dropped and recreated.

drop view public.tasks_with_overdue;

alter table public.tasks
  add column campaign_id bigint references public.campaigns (id);

create index tasks_campaign_idx on public.tasks (campaign_id);

comment on column public.tasks.campaign_id is
  'Optional Department Campaign label. Must equal the Task''s Department Origin, or the parent Department of its Department-Team Origin; null for Project and Independent-Team Tasks (ADR-0007 Campaigns). Enforced by tasks_validate_campaign / private.validate_task_campaign().';

-- `security definer`: this trigger enforces a data-integrity invariant, not
-- an authorization decision, and it must see the true Campaign/Team facts
-- regardless of who is writing `public.tasks`. `campaigns_read` exposes
-- every Campaign row to any active member, but `teams_read` is scoped
-- (`private.can_read_team` / `private.can_administer_team_structure`), and
-- `public.tasks` still carries the legacy `task_write` policy that lets any
-- level>=4 actor write the table directly -- the atomic Task commands that
-- will actually set campaign_id (#327-#345) are not built yet. Run as
-- invoker, this trigger could see zero rows for a Team its caller is not
-- authorized to read and silently misvalidate the origin check; `security
-- definer` reads the authoritative rows instead, the same reasoning as
-- `private.validate_project_manager_state()`
-- (20260909003930_project_manager_invariants.sql). Direct inserts in tests
-- run as `postgres`, which already bypasses RLS as table owner either way.
create function private.validate_task_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_dept   text;
  v_campaign_active boolean;
  v_team_dept       text;
begin
  if new.campaign_id is null then
    return new;
  end if;

  select campaign.department_id, campaign.is_active
    into v_campaign_dept, v_campaign_active
    from public.campaigns as campaign
   where campaign.id = new.campaign_id;

  if new.project_id is not null then
    raise exception using
      errcode = '23514',
      message = 'task_campaign_origin_mismatch';
  end if;

  if new.team_id is not null then
    select team.dept_id
      into v_team_dept
      from public.teams as team
     where team.id = new.team_id;

    -- A null Team dept_id is an Independent Team: no Campaign ever matches.
    if v_team_dept is null or v_team_dept is distinct from v_campaign_dept then
      raise exception using
        errcode = '23514',
        message = 'task_campaign_origin_mismatch';
    end if;
  elsif new.dept_id is distinct from v_campaign_dept then
    raise exception using
      errcode = '23514',
      message = 'task_campaign_origin_mismatch';
  end if;

  -- Only a newly set or changed Campaign must be active. An origin edit that
  -- leaves campaign_id untouched re-validates the origin match above but
  -- never re-checks activity, so a Task keeps a Campaign that is deactivated
  -- later (ADR-0007; on INSERT, old.campaign_id is null, so this is also
  -- true for every first assignment of a Campaign).
  if new.campaign_id is distinct from old.campaign_id
     and not v_campaign_active then
    raise exception using
      errcode = '23514',
      message = 'task_campaign_inactive';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_task_campaign()
  from public, anon, authenticated, service_role;

create trigger tasks_validate_campaign
before insert or update of campaign_id, dept_id, team_id, project_id
on public.tasks
for each row execute function private.validate_task_campaign();

-- Recreate the derived overdue surface unchanged except for the new column
-- riding along with `task.*` -- definition, grants and comment copied
-- verbatim from 20260911104000_tasks_lifecycle_timestamps.sql.
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
