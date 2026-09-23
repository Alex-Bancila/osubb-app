-- demo_seed.test.sql — Epic 5.2a: the demo logins, and (since #296) the demo
-- work itself.
-- These assert `supabase/seed.sql`, which runs on `db reset` and on `start`
-- (local and staging only — never production). If you run the suite against a
-- database seeded with `--no-seed`, this file is the one that will complain.
--
-- #296 rebuilt the demo dataset on the normalized Tracker model. The seed
-- cannot call the Task commands — it runs as the table owner with no
-- `auth.uid()` — so it writes every row by hand, and the job of the scenario
-- section below is to prove the commands COULD have produced what it wrote:
-- one `source = 'command'` Evaluation per completed Task, one `task` ledger
-- row naming it, an Assignment ended `completed` at `completed_at`, a
-- Candidate Queue closed before any terminal status, and a creator
-- `private.require_origin_manager` would have accepted. `#296`'s scenario
-- matrix has one assertion per row.
--
-- This file also absorbed the demo-shape half of the retired
-- `task_assignments_backfill.test.sql`: that suite compared the seed against
-- the legacy `task_assignees` participant list #345 deleted and #296's rebuild
-- retired for good.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(70);

-- ==================== One login per role (AC) ====================
select is((select count(*) from profiles where email like '%@demo.osubb'), 8::bigint,
  'eight demo members exist');

-- #160: joined_at is January 1 of joined_year for every demo profile, so a
-- rebuilt database and a backfilled live one agree (issue AC 3).
select ok(
  not exists (select 1 from profiles
               where email like '%@demo.osubb'
                 and joined_at is distinct from make_date(joined_year, 1, 1)),
  'every demo profile''s joined_at is January 1 of its joined_year');

select is(
  (select count(distinct role) from profiles where email like '%@demo.osubb'), 8::bigint,
  'one per role — every rung of the ladder can be demoed');

select is(
  (select count(*) from profiles p
     join roles r on r.id = p.role
    where p.email like '%@demo.osubb' and r.level = 6),
  1::bigint, 'exactly one BC, so "log in as BC" is unambiguous');

-- ==================== They can actually log in ====================
-- Password auth is a demo convenience; real onboarding is passwordless
-- (ADR-0003). What matters here is that the rows GoTrue reads are well-formed.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and encrypted_password is not null),
  8::bigint, 'each demo account has a password hash');

select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and email_confirmed_at is not null),
  8::bigint, 'each demo account is confirmed, so login is not blocked');

-- The trap this test exists for: GoTrue scans these columns as NOT NULL
-- strings. Leave one null and every login fails with a 500 and "converting
-- NULL to string is unsupported" — which reads as a broken app, not a broken
-- fixture. It cost an afternoon once.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb'
      and (confirmation_token is null or recovery_token is null
        or email_change_token_new is null or email_change is null
        or email_change_token_current is null or phone_change is null
        or phone_change_token is null or reauthentication_token is null)),
  0::bigint, 'no demo account has null auth token columns (GoTrue reads them as text)');

-- ==================== Native Group demo shape (#587) ====================
-- The demo roster is written by Group commands, including the reference
-- Departments and Interne Team; no demo Team or Project legacy row is seeded.
select is((select count(*) from (
  select p.email, p.role::text as member_role,
    (select string_agg(g.legacy_dept_id,',' order by g.legacy_dept_id)
       from group_members gm join groups g on g.id=gm.group_id
      where gm.member_id=p.id and g.legacy_dept_id is not null) as depts,
    (select string_agg(coalesce(g.legacy_team_id,g.name),','
                       order by coalesce(g.legacy_team_id,g.name))
       from group_members gm join groups g on g.id=gm.group_id
      where gm.member_id=p.id and g.category='team'
        and g.name <> 'Adunarea Generală') as teams
  from profiles p where p.email like '%@demo.osubb'
  intersect
  select * from (values
    ('recrut@demo.osubb','recrut','edu',null),
    ('voluntar@demo.osubb','voluntar','edu','Echipa Recruți'),
    ('activ@demo.osubb','activ','pr',null),
    ('vot@demo.osubb','vot','secretariat,youth','Echipa Logistică'),
    ('responsabil@demo.osubb','responsabil','edu,hr','Echipa Recruți'),
    ('bce@demo.osubb','bce','diverse','Echipa Aplicație,it'),
    ('bc@demo.osubb','bc','fin','Echipa Logistică'),
    ('moderator@demo.osubb','moderator','diverse','Echipa Aplicație,it')
  ) expected(email,member_role,depts,teams)
) matched), 8::bigint,
  'all eight roles and Department/Team Group placements match the demo personas');
select is((select count(distinct g.legacy_dept_id) from group_members gm
  join groups g on g.id=gm.group_id join profiles p on p.id=gm.member_id
  where p.email like '%@demo.osubb' and g.legacy_dept_id in
    (select id from departments where kind='department')), 5::bigint,
  'all five delivery Departments have a demo member');
select ok(exists (select 1 from group_members gm join groups g on g.id=gm.group_id
  where g.legacy_dept_id='diverse' and gm.member_id='d0000000-0000-0000-0000-000000000006')
  and exists (select 1 from group_members gm join groups g on g.id=gm.group_id
  where g.legacy_dept_id='secretariat' and gm.member_id='d0000000-0000-0000-0000-000000000004'),
  'both coordination Departments have a demo member');
select is((select count(*) from groups where created_by='d0000000-0000-0000-0000-000000000007'
  and category='team'), 4::bigint, 'BC creates three Teams and the General Assembly');
select ok(exists (select 1 from groups where name='Echipa Logistică'
  and created_by='d0000000-0000-0000-0000-000000000007' and parent_id is null),
  'Logistică remains an independent Team');
select is((select min_level from events where title='Training pentru recruți'), 0,
  'recruit training remains visible at Minimum Level zero');
select is((select count(*) from groups where created_by='d0000000-0000-0000-0000-000000000007'),
  6::bigint, 'six native demo Groups exist');
select is((select count(*) from teams where id in ('t-app','t-recruti','t-logistica')),
  0::bigint, 'no demo legacy Team rows remain');
select is((select count(*) from projects where created_by='d0000000-0000-0000-0000-000000000007'),
  0::bigint, 'no demo legacy Project rows remain');
select is((select count(*) from member_departments md join profiles p on p.id=md.member_id
  where p.email like '%@demo.osubb'), 0::bigint,
  'no demo legacy Department roster rows remain');
select is((select gm.group_role from group_members gm join groups g on g.id=gm.group_id
  where g.legacy_dept_id='diverse' and gm.member_id='d0000000-0000-0000-0000-000000000006'),
  'manager', 'BCE manages Diverse explicitly');
select ok(exists (select 1 from group_members gm join groups g on g.id=gm.group_id
  where g.legacy_dept_id='fin' and gm.member_id='d0000000-0000-0000-0000-000000000007'
    and gm.group_role='member')
  and not exists (select 1 from group_members gm join groups g on g.id=gm.group_id
    where g.category='organization' and gm.member_id='d0000000-0000-0000-0000-000000000007'),
  'BC is a Financiar member; Organization membership is automatic');
select is((select string_agg(gm.group_role,',' order by gm.member_id)
  from group_members gm join groups g on g.id=gm.group_id
  where g.name='Echipa Logistică' and g.created_by='d0000000-0000-0000-0000-000000000007'),
  'responsible,responsible', 'both Logistică peers are Group Responsibles');
select is((select string_agg(p.email||'='||gm.group_role,',' order by p.email)
  from group_members gm join groups g on g.id=gm.group_id
  join profiles p on p.id=gm.member_id
  where g.name='Festivalul Studențesc 2026'
    and g.created_by='d0000000-0000-0000-0000-000000000007'),
  'activ@demo.osubb=responsible,responsabil@demo.osubb=manager,voluntar@demo.osubb=member',
  'active Project keeps Manager, Responsible and ordinary member');
select is((select g.status||'|'||string_agg(p.email||'='||gm.group_role,',' order by p.email)
  from groups g join group_members gm on gm.group_id=g.id
  join profiles p on p.id=gm.member_id
  where g.name='Gala Voluntarilor 2025'
    and g.created_by='d0000000-0000-0000-0000-000000000007'
  group by g.status),
  'archived|bce@demo.osubb=responsible,recrut@demo.osubb=member,vot@demo.osubb=manager',
  'archived Project preserves its exact Manager, Responsible and member roster');
select ok(exists (select 1 from groups g where g.name='Adunarea Generală'
  and g.created_by='d0000000-0000-0000-0000-000000000007'
  and g.automatic_membership and g.min_level=3 and not g.competes_in_cup
  and not g.accepts_applications),
  'General Assembly follows Level 3 automatically, without Cup or Applications');
select is((select string_agg(gm.member_id::text||'='||gm.group_role,',' order by gm.member_id)
  from group_members gm join groups g on g.id=gm.group_id
  where g.name='Adunarea Generală'
    and g.created_by='d0000000-0000-0000-0000-000000000007'),
  'd0000000-0000-0000-0000-000000000006=responsible,d0000000-0000-0000-0000-000000000008=responsible',
  'the Assembly roster is exactly Interne''s two Responsibles');
select ok(not exists (select 1 from group_members gm join groups g on g.id=gm.group_id
  where g.name='Festivalul Studențesc 2026'
    and g.created_by='d0000000-0000-0000-0000-000000000007'
    and gm.member_id='d0000000-0000-0000-0000-000000000001'),
  'recruit remains an outsider to the active Project');
select ok(not exists (select 1 from group_members gm join groups g on g.id=gm.group_id
  join profiles p on p.id=gm.member_id join roles r on r.id=p.role
  where r.level < g.min_level), 'every roster row meets its Group Minimum Level');

-- ==================== #296 scenario matrix ====================
-- One assertion per row of the matrix: the Task exists in the state named,
-- and the "Extras" column's invariant holds for it.

-- Direct, in progress — Department Origin, `created` / `executor_assigned` /
-- `started` on the timeline and an Assignment still open.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Contactare lectori'
       and task.status = 'in_progress'
       and task.group_id = pg_temp.dept_group('edu')
       and task.assignment_mode = 'direct' and task.audience = 'local'
       and task.started_at is not null
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.ended_at is null)
       and (select count(distinct activity.kind) from task_activity activity
             where activity.task_id = task.id
               and activity.kind in ('created', 'executor_assigned', 'started')) = 3
  ),
  'direct + in progress: an open Assignment and the created/executor_assigned/started timeline');

-- Public, open queue, no Executor — and nobody queued yet.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Distribuie story-ul de recrutare'
       and task.status = 'todo'
       and task.assignment_mode = 'public' and task.audience = 'org'
       and task.queue_opened_at is not null and task.queue_closed_at is null
       and not exists (select 1 from task_assignments a where a.task_id = task.id)
       and not exists (select 1 from task_candidates c where c.task_id = task.id)
  ),
  'public + open queue: no Executor, no Candidate, queue_opened_at set');

-- The same state again, in a second Department: still empty. No command
-- leaves a pending Candidate with no Executor at all — express_task_interest
-- takes the first-come branch and becomes the Executor itself when there is
-- none — so this mirrors pr-open-queue rather than being "one step on" from
-- it (#296 fix round 1, review finding 1).
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Voluntari pentru standul de recrutare'
       and task.status = 'todo'
       and task.assignment_mode = 'public' and task.audience = 'org'
       and task.queue_opened_at is not null and task.queue_closed_at is null
       and not exists (select 1 from task_assignments a where a.task_id = task.id)
       and not exists (select 1 from task_candidates c where c.task_id = task.id)
  ),
  'public + open queue in a second Department: no Executor, no Candidate, queue_opened_at set');

-- Public with an Executor and two Members queued behind them, each with its
-- own `interest_expressed` row.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Ajutor la standul Educațional'
       and task.status = 'in_progress'
       and task.assignment_mode = 'public' and task.audience = 'local'
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.ended_at is null)
       and (select count(*) from task_candidates c
             where c.task_id = task.id and c.status = 'pending') = 2
       and (select count(*) from task_activity activity
             where activity.task_id = task.id
               and activity.kind = 'interest_expressed') = 2
  ),
  'public + Executor + two pending Candidates, each with an interest_expressed row');

-- In review, once returned: review_round 1, both the return and the
-- resubmission on the timeline.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Raport parteneriate pentru festival'
       and task.status = 'in_review'
       and exists (select 1 from groups grp
                    where grp.id = task.group_id and grp.category = 'project'
                      and grp.created_by='d0000000-0000-0000-0000-000000000007')
       and task.review_round = 1
       and task.returned_to_progress_at is not null
       and task.submitted_at is not null
       and exists (select 1 from task_activity activity
                    where activity.task_id = task.id
                      and activity.kind = 'returned_to_progress')
       and (select count(*) from task_activity activity
             where activity.task_id = task.id and activity.kind = 'submitted') = 2
  ),
  'in review after one return: review_round 1, returned_to_progress + two submitted rows');

-- Completed on time, on a Department Team Origin.
select ok(
  exists (
    select 1 from tasks task
      join groups task_group on task_group.id = task.group_id
      join groups parent on parent.id = task_group.parent_id
     where task.title = 'Migrare bază de date'
       and task.status = 'completed'
       and parent.legacy_dept_id is not null
       and task.completed_at <= task.deadline
       and exists (select 1 from task_evaluations e
                    where e.task_id = task.id and e.source = 'command'
                      and e.reversed_at is null and e.outcome = 'completed')
       and exists (select 1 from points_ledger l
                    where l.task_id = task.id and l.reason = 'task')
  ),
  'completed on time on a Department Team: completed_at within the deadline, Evaluation + ledger');

-- Completed late: past the deadline, with the queue closed and every
-- Candidate closed with it.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Materiale curs Excel'
       and task.status = 'completed'
       and task.assignment_mode = 'public'
       and task.completed_at > task.deadline
       and task.queue_closed_at is not null
       and exists (select 1 from task_candidates c
                    where c.task_id = task.id and c.status = 'closed'
                      and c.decided_at is not null and c.decided_by is null)
       and not exists (select 1 from task_candidates c
                        where c.task_id = task.id and c.status = 'pending')
  ),
  'completed late: past its deadline, queue closed and its Candidate closed automatically');

-- Unfulfilled at Rating 1: a negative ledger row and an Assignment that failed.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Fotografii de la evenimentul de deschidere'
       and task.status = 'unfulfilled'
       and task.rating = 1
       and exists (select 1 from task_evaluations e
                    where e.task_id = task.id and e.outcome = 'unfulfilled'
                      and e.points < 0)
       and exists (select 1 from points_ledger l
                    where l.task_id = task.id and l.reason = 'task' and l.delta < 0)
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.end_reason = 'failed'
                      and a.ended_at = task.unfulfilled_at)
  ),
  'unfulfilled at Rating 1: a negative ledger row and an Assignment ended failed');

-- Reopened, then evaluated a second time.
select ok(
  exists (
    select 1 from tasks task
     where task.title = 'Workshop CV pentru boboci'
       and task.status = 'completed'
       and (select count(*) from task_evaluations e
             where e.task_id = task.id and e.reversed_at is not null
               and e.reversed_by is not null and e.reversal_reason ~ '[^[:space:]]') = 1
       and (select count(*) from task_evaluations e
             where e.task_id = task.id and e.source = 'command'
               and e.reversed_at is null) = 1
       and (select count(*) from points_ledger l
             where l.task_id = task.id and l.reason = 'task_reversal') = 1
       and (select count(*) from task_assignments a where a.task_id = task.id) = 2
       and exists (select 1 from task_activity activity
                    where activity.task_id = task.id and activity.kind = 'reopened')
  ),
  'reopened then re-evaluated: a reversed Evaluation, a task_reversal row and a second Evaluation');

-- Cancelled with a reason, on an Independent Team.
select ok(
  exists (
    select 1 from tasks task
      join groups task_group on task_group.id = task.group_id
     where task.title = 'Inventar materiale pentru depozit'
       and task.status = 'cancelled'
       and task_group.name = 'Echipa Logistică'
       and task_group.created_by='d0000000-0000-0000-0000-000000000007'
       and task.cancel_reason ~ '[^[:space:]]'
       and task.queue_closed_at is not null
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.end_reason = 'cancelled'
                      and a.ended_at = task.cancelled_at)
       and exists (select 1 from task_candidates c
                    where c.task_id = task.id and c.status = 'selected'
                      and c.decided_by is not null and c.assignment_id is not null)
       and not exists (select 1 from task_candidates c
                        where c.task_id = task.id and c.status = 'pending')
  ),
  'cancelled with a reason on an Independent Team: Assignment cancelled, queue closed');

-- Umbrella with three Subtasks in three different terminal/live states, and a
-- `subtask_completed` row on the Umbrella for each one that became terminal.
select ok(
  exists (
    select 1 from tasks umbrella
     where umbrella.title = 'Programul Educațional de toamnă'
       and umbrella.kind = 'umbrella'
       and umbrella.status = 'todo'
       and umbrella.audience is null and umbrella.assignment_mode is null
       and not exists (select 1 from task_assignments a where a.task_id = umbrella.id)
       and (select count(*) from tasks sub where sub.parent_task_id = umbrella.id) = 3
       and (select count(distinct sub.status) from tasks sub
             where sub.parent_task_id = umbrella.id) = 3
       and (select count(*) from task_activity activity
             where activity.task_id = umbrella.id
               and activity.kind = 'subtask_completed') = 2
  ),
  'umbrella with three differently-stated Subtasks and one subtask_completed row per terminal one');

-- Duplicated from the unfulfilled Task: same title (that is what
-- `duplicate_task` writes), a fresh `todo`, and a `duplicated` row on the source.
select ok(
  exists (
    select 1
      from tasks clone
      join tasks source on source.id = clone.duplicated_from_task_id
     where clone.status = 'todo'
       and source.status = 'unfulfilled'
       and clone.title = source.title
       and clone.group_id = source.group_id
       and clone.campaign_id is not distinct from source.campaign_id
       and not exists (select 1 from task_assignments a where a.task_id = clone.id)
       and exists (select 1 from task_activity activity
                    where activity.task_id = source.id
                      and activity.kind = 'duplicated'
                      and (activity.details ->> 'clone_task_id')::bigint = clone.id)
  ),
  'the duplicate copies the unfulfilled source and leaves a `duplicated` row on it');

-- One active Campaign per real Department, each carrying at least one Task.
select ok(
  not exists (
    select 1 from departments dept
     where dept.kind = 'department'
       and not exists (
         select 1 from campaigns campaign
          where campaign.group_id = (select grp.id from groups grp where grp.legacy_dept_id = dept.id)
            and campaign.is_active
            and exists (select 1 from tasks task where task.campaign_id = campaign.id))
  ),
  'every real Department has an active Campaign with at least one Task on it');

-- Completed-work requests: approved, pending and rejected all present.
select ok(
  exists (
    select 1
      from completed_work_requests request
      join tasks task on task.id = request.task_id
     where request.status = 'approved'
       and request.decided_by is not null
       and request.decided_at is not null
       and request.decision_note ~ '[^[:space:]]'
       and task.status = 'completed'
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.member_id = request.requester_id)
       and exists (select 1 from points_ledger l
                    where l.task_id = task.id and l.reason = 'task'
                      and l.member_id = request.requester_id)
  ),
  'the approved completed-work request links back to the Task it created, credited to its requester');

select ok(
  exists (
    select 1 from completed_work_requests request
     where request.status = 'pending'
       and request.decided_by is null and request.decided_at is null
       and request.decision_note is null and request.task_id is null
  ),
  'a pending completed-work request carries no decision at all');

select ok(
  exists (
    select 1 from completed_work_requests request
     where request.status = 'rejected'
       and request.decided_by is not null and request.decided_at is not null
       and request.decision_note ~ '[^[:space:]]'
       and request.task_id is null
  ),
  'a rejected completed-work request carries its note and creates no Task');

-- ==================== The commands could have produced this ====================
-- Every completed OR unfulfilled Task must look exactly like
-- `private.evaluate_task` left it (#296 fix round 1, review finding 6 —
-- restoring the general coverage the retired task_assignments_backfill
-- suite had, rather than leaving `unfulfilled` covered only by the named
-- pr-unfulfilled matrix assertion above). The reopened Task's FIRST
-- Assignment also ended `completed`, but at a completion the reopen later
-- reversed — which is why the Assignment clause keys on
-- `ended_at = coalesce(completed_at, unfulfilled_at)` rather than on the
-- reason alone.
select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
     where creator.email like '%@demo.osubb'
       and task.status in ('completed', 'unfulfilled')
       and task.kind = 'task'
       and (
         (select count(*) from task_evaluations e
           where e.task_id = task.id and e.source = 'command' and e.reversed_at is null) <> 1
         or (select count(*) from points_ledger l
               join task_evaluations e on e.id = l.evaluation_id
              where l.reason = 'task' and e.task_id = task.id and e.reversed_at is null
                and (task.status <> 'unfulfilled' or l.delta < 0)) <> 1
         or (select count(*) from task_assignments a
              where a.task_id = task.id
                and a.end_reason = case task.status when 'completed' then 'completed' else 'failed' end
                and a.ended_at = coalesce(task.completed_at, task.unfulfilled_at)) <> 1
       )
  ),
  'every completed or unfulfilled demo Task carries one open Evaluation, one task ledger row (negative when unfulfilled) and an Assignment ended at the matching terminal timestamp');

-- Review finding 2: private.open_task_assignment writes its executor_assigned
-- row unconditionally — only the notification is suppressed for
-- `via = 'reopen'` — so every Assignment, including a reopened Task's
-- second one, must be announced by exactly that row.
select ok(
  not exists (
    select 1 from task_assignments a
      join tasks task on task.id = a.task_id
      join profiles creator on creator.id = task.created_by
     where creator.email like '%@demo.osubb'
       and not exists (select 1 from task_activity ev
                        where ev.assignment_id = a.id and ev.kind = 'executor_assigned')),
  'every demo Assignment is announced by exactly the executor_assigned row open_task_assignment writes');

select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
     where creator.email like '%@demo.osubb'
       and task.status in ('completed', 'unfulfilled', 'cancelled')
       and exists (select 1 from task_assignments a
                    where a.task_id = task.id and a.ended_at is null)
  ),
  'no terminal demo Task keeps an active Executor');

select ok(
  not exists (
    select 1
      from task_assignments a
      join tasks task on task.id = a.task_id
      join profiles creator on creator.id = task.created_by
      left join task_evaluations e on e.assignment_id = a.id
     where creator.email like '%@demo.osubb'
       and a.ended_at is not null
       and case a.end_reason
             when 'completed' then e.outcome is distinct from 'completed'
             when 'failed'    then e.outcome is distinct from 'unfulfilled'
                                  or a.ended_at is distinct from task.unfulfilled_at
             when 'cancelled' then task.status is distinct from 'cancelled'
                                  or a.ended_at is distinct from task.cancelled_at
             when 'gave_up'   then false
             when 'replaced'  then false
             else true
           end
  ),
  'every ended demo Assignment closes for a reason its Task can account for — and none is a legacy_migration');

select ok(
  not exists (
    select 1
      from task_candidates candidate
      join task_assignments a
        on a.task_id = candidate.task_id and a.ended_at is null
     where candidate.status = 'pending'
       and candidate.member_id = a.member_id
  ),
  'no demo Member is at once the active Executor and a pending Candidate of the same Task');

select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
     where creator.email like '%@demo.osubb'
       and (
         -- An Umbrella has no mode and therefore no Queue at all.
         (task.kind = 'umbrella'
          and (task.assignment_mode is not null
            or task.queue_opened_at is not null
            or task.queue_closed_at is not null))
         or (task.kind = 'task'
             and (task.assignment_mode = 'public')
                 is distinct from (task.queue_opened_at is not null))
         or (task.assignment_mode = 'public'
             and task.status in ('completed', 'unfulfilled', 'cancelled')
             and task.queue_closed_at is null)
         or (task.queue_closed_at is not null
             and exists (select 1 from task_candidates c
                          where c.task_id = task.id and c.status = 'pending'))
       )
  ),
  'queue timestamps follow the mode, every terminal public Task closed its queue, and no closed queue keeps a pending Candidate');

-- The Group authority model, re-derived here rather than called: the demo
-- cannot prove `private.require_group_work_manager` directly (it reads auth.uid()),
-- but it can prove every creator below BC holds a live Group Manager or Group
-- Responsible role on the path of the Task's active Group (#579: the Group is
-- the only Origin, so the predicate reads nothing else).
select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
      join roles creator_role on creator_role.id = creator.role
     where creator.email like '%@demo.osubb'
       and creator_role.level < 6
       and not (
         coalesce(private.group_role_of(task.group_id, creator.id) in ('manager', 'responsible'), false)
         and exists (select 1 from groups grp where grp.id = task.group_id and grp.status = 'active')
       )
  ),
  'every demo Task names a creator private.require_group_work_manager would have accepted');

select is(
  (select count(*) from task_evaluations e
     join tasks task on task.id = e.task_id
     join profiles creator on creator.id = task.created_by
    where creator.email like '%@demo.osubb'
      and (e.source <> 'command' or e.evaluated_by is null)),
  0::bigint,
  'every demo Evaluation is a command Evaluation with a named evaluator — no legacy-shaped credit survives #345');

-- `assignment_id` is stamped only on rows about the Executor's own work;
-- `task_activity_read`'s own-assignment branch depends on that rule.
select ok(
  not exists (
    select 1
      from task_activity activity
      join tasks task on task.id = activity.task_id
      join profiles creator on creator.id = task.created_by
     where creator.email like '%@demo.osubb'
       and (activity.assignment_id is not null) <> (activity.kind in (
             'executor_assigned', 'candidate_selected', 'started', 'submitted',
             'returned_to_progress', 'evaluated', 'unfulfilled', 'reopened',
             'gave_up'))
  ),
  'demo activity rows stamp assignment_id exactly on the Executor''s-own-work kinds');

-- ==================== Points reconcile ====================
-- #317: points come from Evaluations, not from a trigger on `tasks`. Every
-- task ledger row must name the Evaluation that produced it, carry exactly
-- that Evaluation's points, and credit that Evaluation's own Assignment
-- member. If someone starts hand-writing 'task' ledger rows in the seed, this
-- drifts from the formula and the number on screen stops meaning anything.
select is(
  (select count(*) from points_ledger ledger
     left join task_evaluations evaluation on evaluation.id = ledger.evaluation_id
    where ledger.reason = 'task'
      and (evaluation.id is null
           or ledger.delta <> evaluation.points
           or evaluation.points <> evaluation.difficulty * rating_mult(evaluation.rating))),
  0::bigint,
  'every task ledger row names its Evaluation and carries that Evaluation''s scoring-guide points');

select is(
  (select count(*) from points_ledger ledger
     left join task_evaluations evaluation on evaluation.id = ledger.evaluation_id
     left join task_assignments assignment on assignment.id = evaluation.assignment_id
    where ledger.reason in ('task', 'task_reversal')
      and (evaluation.id is null
           or assignment.member_id is distinct from ledger.member_id
           or evaluation.task_id is distinct from ledger.task_id)),
  0::bigint,
  'every task / task_reversal row names an Evaluation on that member''s own Assignment for that Task');

select is(
  (select count(*) from points_ledger ledger
     join task_evaluations evaluation on evaluation.id = ledger.evaluation_id
    where ledger.reason = 'task_reversal'
      and (evaluation.reversed_at is null or ledger.delta <> -evaluation.points)),
  0::bigint,
  'every task_reversal row undoes exactly the reversed Evaluation it names');

-- ==================== The four points views still agree (#317 AC) ====================
-- member_points is the base sum; leaderboard and dept_cup are derived from
-- it, and my_points is one member's own row of it. Together the next two
-- assertions are the #296 reconciliation: for every member,
-- sum(points_ledger.delta) is what member_points holds and what leaderboard
-- shows.
select is(
  (select count(*) from member_points mp
     where mp.points is distinct from coalesce(
       (select sum(l.delta)::int from points_ledger l where l.member_id = mp.member_id), 0)),
  0::bigint, 'member_points equals the raw ledger sum for every member');

select is(
  (select count(*) from leaderboard lb
     join member_points mp on mp.member_id = lb.member_id
    where lb.points is distinct from mp.points),
  0::bigint, 'leaderboard reports member_points unchanged');

-- #259 changed what the Cup means. It is no longer "sum the whole ledgers of
-- whoever is in this Department today" but "sum the Task Points whose Task
-- Origin is this Department, or one of its Department Teams" -- so a member's
-- sanction, and a Project or Independent-Team award, are outside it entirely.
-- The view is also BCE+ only now: the owner sees no rows at all, so the
-- expected figures are computed here, as the owner, and compared from inside a
-- leadership session (the same shape as demo_totals below).
create temp table demo_cup_expected as
  select cup.id as group_id,
         coalesce((
           select sum(entry.delta)::int
             from points_ledger entry
             join tasks task on task.id = entry.task_id
             join groups task_group on task_group.id = task.group_id
            where entry.reason in ('task', 'task_reversal')
              and task_group.path @> array[cup.id]
         ), 0) as points
    from groups cup
   where cup.competes_in_cup;
grant select on demo_cup_expected to authenticated;

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000006');
select results_eq(
  $$ select group_id, points from public.dept_cup order by group_id $$,
  $$ select group_id, points from demo_cup_expected order by group_id $$,
  'dept_cup totals the seeded Task Points whose Task Group is that competing Group or one below it');
reset role;

-- my_points is the ordinary member's own-total endpoint, and member_points is
-- leadership-only, so the two can never be compared from one session:
-- capture the leadership totals here, as the owner, and compare from inside
-- each member's own session below.
create temp table demo_totals as
  select member_id, points from member_points;
grant select on demo_totals to authenticated;

-- Andrei holds task credit only; Vlad holds credit and a sanction, which is
-- the combination the endpoint has to get right.
select pg_temp.test_login('d0000000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'recrut', 'member_level', 0,
  'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select results_eq(
  $$ select points from public.my_points $$,
  $$ select points from demo_totals
      where member_id = 'd0000000-0000-0000-0000-000000000001' $$,
  'my_points returns the same total member_points holds for that member');
reset role;

select pg_temp.test_login('d0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'activ', 'member_level', 2,
  'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select results_eq(
  $$ select points from public.my_points $$,
  $$ select points from demo_totals
      where member_id = 'd0000000-0000-0000-0000-000000000003' $$,
  'a member with both task credit and a sanction sees the same net total');
reset role;

select ok(
  exists (select 1 from points_ledger where reason = 'sanction'),
  'a sanction is present as a separate governance adjustment');

-- A penalty in the data is deliberate: a demo where nobody ever lost points
-- hides half of the scoring guide.
select ok(
  exists (select 1 from points_ledger where reason = 'task' and delta < 0),
  'at least one task was graded 1, so the leaderboard shows a real penalty');

-- ==================== The demo has to look alive ====================
-- These are about the *demo*, not the engine: a leaderboard where everyone
-- has the same score, or a tracker with one status, demos badly. The points
-- engine itself is covered by points_engine.test.sql.
select ok((select count(*) from tasks) >= 15,
  'enough tasks to fill a tracker');

select is((select count(distinct status) from tasks), 6::bigint,
  'the seeded Tasks cover all six lifecycle states');

select ok((select count(*) from tasks
            where status = 'todo' and audience = 'org'
              and assignment_mode = 'public'
              and queue_closed_at is null) >= 2,
  'at least two organization-wide Opportunities are open for the "Deschise" tab');

-- ==================== Calendar, feed, notifications ====================
-- The calendar only demos well if switching accounts changes what you see.
-- ADR-0008 makes that a Minimum Level story now, not a scope-branch one:
-- one gated Event (the AG, min_level 3) plus a spread of scopes so the
-- frontend's relevance grouping (primary vs gray) still has something to
-- show.
select ok((select count(*) from events) >= 6,
  'the calendar has something in it');

select ok(
  exists (select 1 from events e join groups g on g.id = e.group_id where g.is_organization)
  and exists (select 1 from events e join groups g on g.id = e.group_id where g.category = 'department')
  and exists (select 1 from events e join groups g on g.id = e.group_id where g.category = 'team'),
  'org, department and team events all exist — switching demo accounts changes the calendar');

select is((select min_level from events where title = 'Adunarea Generală de toamnă'), 3,
  'the AG is the one gated demo Event — min_level 3, AG / Voting Member+ (ADR-0008)');

select ok(
  exists (select 1 from event_attendance where status = 'declined')
  and exists (select 1 from event_attendance where status = 'going'),
  'RSVPs go both ways, so the toggle has two visible states');

-- The feed's loudest state and the v1 forms story both need to be visible.
select ok(
  exists (select 1 from announcements where priority = 'critical' and pinned),
  'a critical pinned announcement exists (the feed''s loudest state)');

select ok(
  exists (select 1 from announcements where form_url is not null),
  'one announcement links a form — the v1 forms story is a Google Form link');

select * from finish();
rollback;
