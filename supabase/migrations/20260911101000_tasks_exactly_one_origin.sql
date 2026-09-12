-- There is no lossless way to infer ownership for a legacy Task with no
-- origin. Stop the deployment and report the rows so an operator can assign
-- their real Origin through a reviewed additive data migration before
-- retrying this migration. Check before changing any rows.
do $migration$
declare
  v_originless_ids text;
begin
  select string_agg(task.id::text, ', ' order by task.id)
    into v_originless_ids
    from public.tasks as task
   where num_nonnulls(task.dept_id, task.team_id) = 0;

  if v_originless_ids is not null then
    raise exception using
      errcode = '23514',
      message = format(
        'Tasks require an explicit Origin before migration; originless Task IDs: %s',
        v_originless_ids
      );
  end if;
end
$migration$;

-- A Task belongs to exactly one Department, Project, or Team. Legacy Team
-- rows redundantly stored the Team's parent Department; the Team is the more
-- precise ownership fact, so keep it and clear the redundant Department.
alter table public.tasks
  add column project_id bigint references public.projects (id);

update public.tasks
   set dept_id = null
 where team_id is not null
   and dept_id is not null;

alter table public.tasks
  add constraint tasks_exactly_one_origin_check
  check (num_nonnulls(dept_id, team_id, project_id) = 1);

create index tasks_project_idx on public.tasks (project_id);

comment on column public.tasks.project_id is
  'Project Task Origin; exactly one of dept_id, team_id, or project_id is set.';
