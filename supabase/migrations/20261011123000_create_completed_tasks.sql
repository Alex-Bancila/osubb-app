-- Finished Tasks x n (spec 2026-10-11, Part E; Alex: "add finished task for n
-- number of times for n number of people, but make sure to be able to select
-- the same person more than once"). One atomic command over the existing
-- private.create_completed_task_impl: one Executor per copy, repeats allowed,
-- every rule (authority, eligibility, Evaluation, points, the one "Task
-- evaluat", the task_create cap) per copy; one refusal rolls back all.

create function private.create_completed_tasks_impl(
  p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text,
  p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text,
  p_links jsonb, p_copies integer)
returns setof public.tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_given integer := coalesce(array_length(p_executor_ids, 1), 0);
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for every caller, before the gate.
  if p_copies is null or p_copies < 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_copies > 100 then
    raise sqlstate 'PT400' using message = 'too_many_copies';
  end if;
  -- A finished Task always names its Executor: exactly one entry per copy, none empty.
  if v_given <> p_copies or exists (select 1 from unnest(p_executor_ids) as entry where entry is null) then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;
  -- 2. One finished Task per copy, in order, in this one transaction.
  for i in 1..p_copies loop
    v_task := private.create_completed_task_impl(
      p_executor_ids[i], p_group_id, p_title, p_description,
      null, null, p_campaign_id, p_difficulty, p_rating, p_note, p_links);
    return next v_task;
  end loop;
  return;
end;
$$;

comment on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) is
  'Body of public.create_completed_tasks: p_copies finished Tasks, one per entry of p_executor_ids (the same Member may repeat), each through private.create_completed_task_impl in one transaction, so every create_completed_task rule holds per copy and one refusal rolls back all. Step 1: PT400 invalid_copies (null, below 1), too_many_copies (above 100), invalid_executors (no list, a length other than p_copies, or an empty entry).';

create function public.create_completed_tasks(
  p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text,
  p_campaign_id bigint default null, p_difficulty integer default null,
  p_rating integer default null, p_note text default null,
  p_links jsonb default '[]'::jsonb, p_copies integer default 1)
returns setof public.tasks
language sql
set search_path to ''
as $$
  select * from private.create_completed_tasks_impl(p_executor_ids, p_group_id, p_title, p_description,
                                                    p_campaign_id, p_difficulty, p_rating, p_note, p_links, p_copies);
$$;

comment on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) is
  'Adds p_copies (1..100) finished Tasks at once -- one per volunteer in p_executor_ids, repeats allowed -- atomically, returning the rows in order; the arguments are create_completed_task''s with a list in place of p_executor_id and no legacy link pair. Reasons of its own: PT400 invalid_copies, too_many_copies, invalid_executors; every other reason is create_completed_task''s, per copy.';

revoke execute on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) to authenticated;
grant execute on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) to authenticated;
