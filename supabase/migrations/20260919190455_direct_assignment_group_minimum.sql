-- #350: enforce direct Executor eligibility at the command boundary.
-- CREATE OR REPLACE preserves the audited signature and grants.
create or replace function private.assign_task_executor_impl(p_task_id bigint, p_member_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: re-validated against live rows, holding the
  --    manager's own profile and the membership row their authority rests
  --    on FOR SHARE (require_origin_manager's discipline).
  perform private.require_task_manager(p_task_id);
  -- State conflicts retain precedence over selected-Member validation.
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.assignment_mode is distinct from 'direct' then
    raise sqlstate 'PT409' using message = 'task_not_direct';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if exists (select 1 from public.task_assignments as assignment
              where assignment.task_id = p_task_id and assignment.ended_at is null) then
    raise sqlstate 'PT409' using message = 'task_already_assigned';
  end if;
  -- ADR-0009: UI filtering is only a convenience. Hold the selected Member's
  -- live profile so deactivation or demotion cannot race this eligibility check.
  perform 1 from public.profiles as candidate
    where candidate.id = p_member_id and candidate.status = 'activ'
    for share of candidate;
  if not found then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  -- Re-read after any lock wait; the initial profile/role snapshot is not authority.
  if coalesce(private.actor_level(p_member_id), -1) <
     (select origin.min_level from public.groups as origin where origin.id = v_task.group_id) then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  perform private.open_task_assignment(p_task_id, p_member_id, v_actor, 'assign');
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.assign_task_executor_impl(bigint, uuid) is
  'Assigns an active Member at or above the Origin Group Minimum Level, under Task, manager-authority and target-profile locks. Retains public signature, ACL and state-conflict precedence; PT400 invalid_executor also covers below-Minimum-Level targets (#350, ADR-0009).';
