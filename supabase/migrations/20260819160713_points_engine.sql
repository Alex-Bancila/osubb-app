-- 20260819160713_points_engine.sql
-- OSUBB backend — Epic 1.4: points ledger, grading trigger, derived views.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§3.3)
-- Tested by supabase/tests/points_engine.test.sql (Epic 6.2).

-- ==================== Points ledger ====================
-- The single source of truth for a member's points. 'task' rows are managed
-- exclusively by the triggers below (one row per graded task × assignee,
-- updated in place on re-grade). Manual rows ('manual_award', 'sanction')
-- are inserted by BC/Responsabil flows in later epics.
create table points_ledger (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references profiles (id) on delete cascade,
  delta      int  not null,
  reason     text not null,
  task_id    bigint references tasks (id),
  awarded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

comment on column points_ledger.reason is
  'Documented values: ''task'' (trigger-managed), ''manual_award'', ''sanction'' (BC, with reason note — Epic 1.8 adds the note column).';

-- Re-grades update the existing 'task' row instead of inserting a duplicate.
create unique index points_ledger_task_member_uidx
  on points_ledger (task_id, member_id) where (reason = 'task');

-- Member history lookups + future RLS predicates.
create index points_ledger_member_idx on points_ledger (member_id);

-- RLS on from birth: deny-by-default for anon/authenticated until Epic 3.3.
alter table points_ledger enable row level security;

-- ==================== Grading triggers ====================
-- SECURITY DEFINER so ledger writes keep working once Epic 3.3 policies land
-- (members never insert 'task' rows themselves — only via grading).
-- Empty search_path per Supabase guidance; every object fully qualified.

-- Grade / re-grade / difficulty change → upsert one row per assignee.
-- Clearing the grade (rating → null) removes the task's ledger rows.
create or replace function sync_task_ledger() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.rating is null then
    delete from public.points_ledger
     where task_id = new.id and reason = 'task';
  else
    insert into public.points_ledger (member_id, delta, reason, task_id, awarded_by)
    select ta.member_id, new.points, 'task', new.id, auth.uid()
      from public.task_assignees ta
     where ta.task_id = new.id
    on conflict (task_id, member_id) where (reason = 'task')
    do update set delta      = excluded.delta,
                  awarded_by = excluded.awarded_by,
                  created_at = now();
  end if;
  return null;
end;
$$;

create trigger tasks_sync_ledger
  after update of rating, difficulty on tasks
  for each row
  when (old.rating is distinct from new.rating
        or old.points is distinct from new.points)
  execute function sync_task_ledger();

-- Assignee added to / removed from an already-graded task.
create or replace function sync_assignee_ledger() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  task_points int;
begin
  if tg_op = 'INSERT' then
    select t.points into task_points
      from public.tasks t
     where t.id = new.task_id and t.rating is not null;
    if found then
      insert into public.points_ledger (member_id, delta, reason, task_id, awarded_by)
      values (new.member_id, task_points, 'task', new.task_id, auth.uid())
      on conflict (task_id, member_id) where (reason = 'task')
      do update set delta = excluded.delta, created_at = now();
    end if;
    return null;
  end if;
  -- DELETE: the member no longer counts for this task.
  delete from public.points_ledger
   where task_id = old.task_id and member_id = old.member_id and reason = 'task';
  return null;
end;
$$;

create trigger task_assignees_sync_ledger
  after insert or delete on task_assignees
  for each row
  execute function sync_assignee_ledger();

-- ==================== Derived views ====================
-- security_invoker: the caller's RLS applies to the underlying tables —
-- without it the views would run as their owner and bypass RLS entirely.

create view member_points with (security_invoker = on) as
  select p.id as member_id, coalesce(sum(l.delta), 0)::int as points
    from profiles p
    left join points_ledger l on l.member_id = p.id
   group by p.id;

create view leaderboard with (security_invoker = on) as
  select mp.member_id, pr.full_name, pr.role, mp.points,
         rank() over (order by mp.points desc) as rank
    from member_points mp
    join profiles pr on pr.id = mp.member_id
   where pr.status = 'activ';

create view dept_cup with (security_invoker = on) as
  select d.id as dept_id, d.name, coalesce(sum(mp.points), 0)::int as points,
         count(distinct md.member_id) as members
    from departments d
    join member_departments md on md.dept_id = d.id
    join member_points mp on mp.member_id = md.member_id
   where d.kind = 'department'
   group by d.id, d.name
   order by points desc;
