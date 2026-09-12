-- Replace transitional Task statuses with the six lifecycle states accepted
-- in ADR-0007. Audience and Assignment Mode already preserve the two facts
-- that legacy `open` overloaded into one status.
drop policy task_read on public.tasks;
drop function public.claim_open_task(bigint);

update public.tasks as task
   set status = 'progress'
 where task.status = 'overdue'
   and exists (
     select 1
       from public.task_assignees as assignment
      where assignment.task_id = task.id
   );

alter table public.tasks alter column status drop default;
alter type public.task_status rename to task_status_legacy;
create type public.task_status as enum (
  'todo',
  'in_progress',
  'in_review',
  'completed',
  'unfulfilled',
  'cancelled'
);

alter table public.tasks
  alter column status type public.task_status
  using (
    case status::text
      when 'todo' then 'todo'
      when 'progress' then 'in_progress'
      when 'done' then 'completed'
      when 'overdue' then 'todo'
      when 'open' then 'todo'
    end
  )::public.task_status;

alter table public.tasks alter column status set default 'todo';
drop type public.task_status_legacy;

create function private.task_is_unassigned(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.task_assignees as assignment
     where assignment.task_id = p_task_id
  )
$$;

revoke all on function private.task_is_unassigned(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.task_is_unassigned(bigint) to authenticated;

-- During the compatibility window, organization-wide public todo Tasks are
-- the old claimable opportunities. Local public Tasks remain visible only
-- through their Origin; Candidate Queue commands replace this path later.
create policy task_read on public.tasks for select to authenticated using (
  public.auth_is_member() and (
       public.auth_level() >= 4
    or (
      status = 'todo'
      and assignment_mode = 'public'
      and audience = 'org'
      and private.task_is_unassigned(id)
    )
    or public.auth_in_dept(dept_id)
    or (team_id is not null and public.auth_in_team(team_id))
    or public.is_assigned(id)
  )
);

create function public.claim_open_task(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := (select auth.uid());
  v_claimed public.tasks%rowtype;
begin
  if v_member_id is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_member_id
          and profile.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'not_active_member';
  end if;

  select task.*
    into v_claimed
    from public.tasks as task
   where task.id = p_task_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  if v_claimed.status <> 'todo'
     or v_claimed.assignment_mode <> 'public'
     or v_claimed.audience <> 'org'
     or not private.task_is_unassigned(p_task_id) then
    raise sqlstate 'PT409' using message = 'task_not_open';
  end if;

  insert into public.task_assignees (task_id, member_id)
  values (p_task_id, v_member_id);

  return v_claimed;
end;
$$;

revoke execute on function public.claim_open_task(bigint) from public, anon;
grant execute on function public.claim_open_task(bigint) to authenticated;

comment on function public.claim_open_task(bigint) is
  'Legacy compatibility command: atomically assigns one unassigned organization-wide public todo Task to auth.uid() while preserving its public mode.';
