-- Task lists that stay fast (spec 2026-10-14).
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
  -- Lower case with the combining marks removed after NFD, as the page's
  -- searchableTitle folds a title: "sedinta" finds "Ședință" and "ŞEDINŢĂ".
  select lower(regexp_replace(normalize(coalesce(p_text, ''), NFD), '[̀-ͯ]', '', 'g'));
$$;

comment on function private.fold_search(text) is
  'The case- and diacritic-insensitive key the Task list search compares: NFD, combining marks removed, lower case. Empty for null.';

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
