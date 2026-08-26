-- One atomic winner for the public task queue. Ordinary members cannot update
-- tasks directly, so this narrow command is SECURITY DEFINER and performs its
-- own token and live-profile authorization before touching any row.
create or replace function public.claim_open_task(p_task_id bigint)
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
         from public.profiles p
        where p.id = v_member_id
          and p.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'not_active_member';
  end if;

  -- The UPDATE takes the task row lock. Concurrent callers wait, then
  -- re-evaluate the predicate; after the winner commits, status is no longer
  -- `open`, so every later caller follows the conflict branch below.
  update public.tasks t
     set status = 'todo'
   where t.id = p_task_id
     and t.status = 'open'
     and not exists (
       select 1
         from public.task_assignees ta
        where ta.task_id = t.id
     )
  returning t.* into v_claimed;

  if not found then
    if not exists (select 1 from public.tasks t where t.id = p_task_id) then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
    raise sqlstate 'PT409' using message = 'task_not_open';
  end if;

  insert into public.task_assignees (task_id, member_id)
  values (p_task_id, v_member_id);

  return v_claimed;
end;
$$;

-- The command is the only volunteer claim path. Managers retain their
-- separate assignee_manage policy for explicit assignments.
drop policy if exists assignee_claim_open on public.task_assignees;

revoke execute on function public.claim_open_task(bigint) from public, anon;
grant execute on function public.claim_open_task(bigint) to authenticated;

comment on function public.claim_open_task(bigint) is
  'Atomically changes one unassigned open task to todo and assigns auth.uid().';
