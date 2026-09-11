begin;
\set osubb_test_suite true
\ir _helpers.sql

select plan(11);

create temp table demo_legacy_assignments_290 as
select legacy.*
  from public.task_assignees legacy
  join public.tasks task on task.id = legacy.task_id
  join public.profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb';

create temp table demo_assignment_history_290 as
select history.*
  from public.task_assignments history
  join public.tasks task on task.id = history.task_id
  join public.profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb';

select is(
  (select count(*) from demo_assignment_history_290),
  (select count(*) from demo_legacy_assignments_290),
  'fresh demo data dual-writes one Assignment per legacy participant');
select ok(
  not exists (
    select 1
      from demo_legacy_assignments_290 legacy
      left join demo_assignment_history_290 history
        on history.task_id = legacy.task_id
       and history.member_id = legacy.member_id
     where history.id is null
  ), 'every legacy Task/member pair is preserved in Assignment history');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      left join demo_legacy_assignments_290 legacy
        on legacy.task_id = history.task_id
       and legacy.member_id = history.member_id
     where legacy.task_id is null
  ), 'fresh demo history contains no invented participant');
select ok(
  not exists (select 1 from demo_assignment_history_290 where assigned_by is not null),
  'legacy Assignment actors remain unknown');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      join public.tasks task on task.id = history.task_id
     where history.assigned_at is distinct from task.created_at
  ), 'legacy Assignment starts use the documented reconstructed Task creation time');
select ok(
  not exists (
    select task.id
      from public.tasks task
      join demo_legacy_assignments_290 legacy on legacy.task_id = task.id
     where task.status in ('todo', 'in_progress', 'in_review')
     group by task.id
    having count(*) filter (where exists (
      select 1 from demo_assignment_history_290 history
       where history.task_id = task.id
         and history.member_id = legacy.member_id
         and history.ended_at is null)) <> 1
  ), 'each unfinished legacy-bearing Task has exactly one active Executor');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      join public.tasks task on task.id = history.task_id
     where task.status in ('todo', 'in_progress', 'in_review')
       and history.ended_at is null
       and history.member_id <> (
         select legacy.member_id
           from demo_legacy_assignments_290 legacy
          where legacy.task_id = task.id
          order by legacy.member_id limit 1)
  ), 'the lowest legacy member UUID is the deterministic active Executor');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      join public.tasks task on task.id = history.task_id
     where task.status in ('todo', 'in_progress', 'in_review')
       and history.ended_at is not null
       and (history.ended_at is distinct from task.created_at
         or history.end_reason <> 'legacy_migration'
         or history.end_note is null)
  ), 'other unfinished participants remain documented migration history');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      join public.tasks task on task.id = history.task_id
     where task.status in ('completed', 'unfulfilled', 'cancelled')
       and history.ended_at is null
  ), 'terminal Tasks have no active legacy Executor');
select ok(
  not exists (
    select 1
      from demo_assignment_history_290 history
      join public.tasks task on task.id = history.task_id
     where task.status in ('completed', 'unfulfilled', 'cancelled')
       and (
         history.ended_at is distinct from case task.status
           when 'completed' then task.completed_at
           when 'unfulfilled' then task.unfulfilled_at
           when 'cancelled' then task.cancelled_at
         end
         or history.end_reason is distinct from case task.status
           when 'completed' then 'completed'
           when 'unfulfilled' then 'failed'
           when 'cancelled' then 'cancelled'
         end)
  ), 'terminal participants end at the matching lifecycle outcome');
select ok(
  (select count(*) from demo_assignment_history_290 history
    join public.tasks task on task.id = history.task_id
   where task.title = 'Migrare bază de date') = 2
  and
  (select count(*) from public.points_ledger ledger
    join public.tasks task on task.id = ledger.task_id
   where task.title = 'Migrare bază de date' and ledger.delta = 15) = 2,
  'multi-assignee completed work keeps both histories and both point credits');

select * from finish();
rollback;
