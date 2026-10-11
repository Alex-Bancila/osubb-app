-- Task copies (spec 2026-10-11, Part B; Alex: "I want to be able to create a
-- custom number of duplicate tasks ... when a direct task is created n number
-- of times, a new popup should appear that requires the executors"). One
-- atomic command: public.create_tasks takes what create_task takes, a list of
-- Executors instead of one, and a count; private.create_tasks_impl loops the
-- existing create body once per copy inside the one transaction, so all n
-- copies exist or none. Every rule of create_task holds per copy: the gate,
-- Group authority, shape and audience, the Executor's Minimum Level, the
-- Umbrella parent lock (FOR NO KEY UPDATE, re-taken harmlessly per copy), the
-- task_create daily cap (one slot per copy) and one "Task nou" notification per
-- assigned Executor. public.create_task is untouched.

create function private.create_tasks_impl(
  p_title text, p_description text, p_deadline timestamp with time zone,
  p_audience text, p_assignment_mode text, p_executor_ids uuid[],
  p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint,
  p_links jsonb, p_copies integer)
returns setof public.tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_executors uuid[] := coalesce(p_executor_ids, '{}'::uuid[]);
  v_given     integer := coalesce(array_length(v_executors, 1), 0);
  v_task      public.tasks%rowtype;
  i           integer;
begin
  -- 1. Malformed for every caller (conventions section 2: before the gate).
  if p_copies is null or p_copies < 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_copies > 20 then
    raise sqlstate 'PT400' using message = 'too_many_copies';
  end if;
  if p_kind = 'umbrella' and p_copies > 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_assignment_mode = 'public' and v_given > 0 then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;
  if p_assignment_mode = 'direct' and v_given > 0 and v_given <> p_copies then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;

  -- 2. One create per copy, in creation order, in this one transaction. A
  --    null entry (or no list at all) leaves that copy unassigned, as a
  --    direct Task may start today. The legacy link pair is never sent.
  for i in 1..p_copies loop
    v_task := private.create_task_impl(
      p_title, p_description, p_deadline, p_audience, p_assignment_mode,
      case when v_given > 0 then v_executors[i] end,
      p_campaign_id, p_parent_task_id, p_kind, p_group_id,
      null, null, p_links);
    return next v_task;
  end loop;
  return;
end;
$$;

comment on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) is
  'Body of public.create_tasks: p_copies identical Tasks (or Subtasks of one Umbrella; an Umbrella itself allows one copy) in one transaction, each through private.create_task_impl, so every create_task rule holds per copy and one refusal rolls back all. Step 1: PT400 invalid_copies (null, below 1, or above 1 for an Umbrella), too_many_copies (above 20), invalid_executors (any executors on a public Task; a direct list whose length is not p_copies). A direct copy''s Executor is p_executor_ids[i]; a null entry or no list leaves it unassigned. Each copy spends one task_create slot and notifies its Executor once ("Task nou").';

create function public.create_tasks(
  p_title text, p_description text, p_deadline timestamp with time zone,
  p_audience text, p_assignment_mode text,
  p_executor_ids uuid[] default null,
  p_campaign_id bigint default null, p_parent_task_id bigint default null,
  p_kind text default 'task', p_group_id bigint default null,
  p_links jsonb default '[]'::jsonb,
  p_copies integer default 1)
returns setof public.tasks
language sql
set search_path to ''
as $$
  select * from private.create_tasks_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                          p_executor_ids, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                          p_links, p_copies);
$$;

comment on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) is
  'Creates p_copies (1..20) identical Tasks -- or Subtasks of the Umbrella p_parent_task_id -- atomically, returning the rows in creation order; the arguments are create_task''s with p_executor_ids (one entry per direct copy, null entries allowed) in place of p_executor_id and no legacy link pair. Reasons of its own: PT400 invalid_copies, too_many_copies, invalid_executors; every other reason is create_task''s, per copy.';

revoke execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) to authenticated;
grant execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) to authenticated;
