-- seed.sql — local/staging demo data.
--
-- Runs automatically on `supabase db reset` and `supabase start`. It is NOT a
-- migration and `supabase db push` does not carry it, so a hosted project only
-- gets this data when someone applies the file deliberately: staging is seeded
-- by the manual "Seed staging demo data" workflow, which runs exactly this file
-- with psql. See docs/backend/seeding-staging.md.
--
-- Reference lookups (roles, departments, rating_guide, difficulty_guide,
-- role levels, scoring guides, and notif_suppression) are seeded by MIGRATIONS so they exist
-- in every environment, production included. Do not duplicate them here.
--
-- Everything below is demo data and it never reaches production — production
-- deploys migrations only, and the seed workflow refuses any project that is
-- not staging.
--
-- Passwords exist only because clicking through a demo with eight magic links
-- is miserable. Real onboarding is invite-only and passwordless (ADR-0003);
-- these accounts are @demo.osubb, an address nobody can receive mail at.
--
-- ⚠️ Must be applied in a single transaction (`psql -1` / `--single-transaction`,
-- or `supabase db reset`, which already wraps it). The demo-cohort cleanup
-- below briefly disables the append-only guards on `task_evaluations` and
-- `task_activity` for a few statements each; that is safe only because a
-- mid-file failure rolls the whole file back with them, rather than leaving
-- a live database with those guards off. Every documented apply path
-- already runs this way — seed-staging.yml, scripts/check-seed-rerunnable.sh,
-- and `supabase db reset` — see docs/backend/seeding-staging.md.

-- ==================== Clear the previous demo data ====================
-- `db reset` drops the database before running this file, so locally these
-- deletes find nothing and cost nothing. They exist for staging, which is a
-- live database: applying the seed there must be safe to do twice, and the
-- second run must leave the same demo data behind rather than a duplicate of
-- it or an error.
--
-- Scope is exactly the demo cohort — the eight @demo.osubb accounts and the
-- rows they own. A real person invited to staging for testing keeps their
-- profile, their tasks and their points.
--
-- Order matters. `created_by`, `awarded_by`, Project `leader_id`,
-- `from_member` and
-- `decided_by` are plain references with no `on delete` clause, so Postgres
-- refuses to remove a member while any of them still points at that member:
-- the children go first. Everything else — memberships, team memberships,
-- RSVPs, announcement reads, notifications, push tokens — cascades
-- from `profiles`, which itself cascades from the single `auth.users` delete
-- at the end.
--
-- #296 note on the order: the plan's cleanup order ended "… → tasks →
-- requests", which the schema does not allow.
-- `completed_work_requests_task_id_fkey` has no `on delete` clause, so a
-- request whose approval created a demo Task pins that Task; the requests go
-- BEFORE the Tasks. `campaigns` go after them for the mirror-image reason —
-- `tasks_campaign_id_fkey` pins a Campaign while any Task still carries it.
-- Final order: ledger → evaluations → activity → candidates → assignments →
-- requests → tasks → campaigns → events → announcements → projects → teams →
-- auth.users.

-- A real tester may create a Project and temporarily choose a demo account as
-- its lead. That Project is not demo-owned, so deleting it would be data loss;
-- preserving it while deleting its lead would violate the foreign key. Abort
-- the transaction with a precise message and let a human reassign the lead.
do $$
begin
  if exists (
    select 1
      from projects project
      join profiles leader on leader.id = project.leader_id
      join profiles creator on creator.id = project.created_by
     where leader.email like '%@demo.osubb'
       and creator.email not like '%@demo.osubb'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'seed_refuses_cross_owned_demo_project',
      detail = 'Reassign every non-demo-owned Project away from demo leads before re-seeding.';
  end if;
end;
$$;

-- Ledger and Assignment history before Tasks: neither Task reference
-- cascades. Delete only history for demo-owned Tasks, leaving independent
-- tester-owned history for non-demo Members untouched.
delete from points_ledger l
 where exists (select 1 from profiles p
                where p.email like '%@demo.osubb'
                  and p.id in (l.member_id, l.awarded_by))
    or exists (select 1 from tasks t
                 join profiles p on p.id = t.created_by
                where t.id = l.task_id and p.email like '%@demo.osubb');

-- #317/#292: `task_evaluations` and `task_activity` are append-only by
-- trigger, not merely by grants — `private.guard_task_evaluation_change()`
-- and `private.reject_task_activity_change()` reject every DELETE, including
-- one run by the table owner. Both tables reference the demo Tasks and
-- Assignments deleted just below, so re-seeding a live staging database
-- would fail on the foreign keys unless this demo-cohort history goes first.
-- The seed runs as the table owner (docs/backend/seeding-staging.md: "Connect
-- as postgres"), so it may disable those two triggers around its own
-- cleanup. It is done explicitly, for exactly these two statements, and
-- re-enabled immediately: nothing else in this file runs while history is
-- unguarded, and the scope is still only Tasks a demo account created. This
-- is safe only because the whole file runs in one transaction (see the
-- header) — a mid-file failure here rolls back with the triggers still
-- disabled, instead of leaving them off on a live database.
alter table task_evaluations disable trigger task_evaluations_guard_change;
alter table task_activity disable trigger task_activity_reject_change;

delete from task_evaluations evaluation
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = evaluation.task_id
      and creator.email like '%@demo.osubb'
 );

delete from task_activity activity
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = activity.task_id
      and creator.email like '%@demo.osubb'
 );

alter table task_activity enable trigger task_activity_reject_change;
alter table task_evaluations enable trigger task_evaluations_guard_change;

delete from task_candidates candidate
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = candidate.task_id
      and creator.email like '%@demo.osubb'
 );

delete from task_assignments assignment
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = assignment.task_id
      and creator.email like '%@demo.osubb'
 );

-- Completed-work requests before Tasks: an approved request names the Task
-- its approval created (`task_id`, no `on delete` clause). `decided_by` is
-- covered too, the way the ledger covers `awarded_by` — a demo decider on a
-- non-demo request would otherwise pin the demo profile.
delete from completed_work_requests request
 where exists (select 1 from profiles p
                where p.email like '%@demo.osubb'
                  and p.id in (request.requester_id, request.decided_by))
    or exists (select 1 from tasks t
                 join profiles p on p.id = t.created_by
                where t.id = request.task_id and p.email like '%@demo.osubb');

-- One statement for the whole Task graph. Umbrella → Subtask
-- (`parent_task_id`) and source → clone (`duplicated_from_task_id`) are
-- self-references, and both sides are inside this delete: referential-integrity
-- triggers are AFTER ROW triggers that fire once the statement has finished,
-- so parent and child may go together.
delete from tasks t
 using profiles p where t.created_by = p.id and p.email like '%@demo.osubb';

-- Campaigns after the Tasks that label them. A non-demo Task carrying a demo
-- Campaign aborts here, the same way a non-demo Task on a demo Team does —
-- see docs/backend/seeding-staging.md's troubleshooting table.
delete from campaigns c
 using profiles p where c.created_by = p.id and p.email like '%@demo.osubb';

delete from events e
 using profiles p where e.created_by = p.id and p.email like '%@demo.osubb';

delete from announcements a
 using profiles p where a.created_by = p.id and p.email like '%@demo.osubb';

-- Project memberships cascade from their Project. A Project is demo-owned
-- only when its creator belongs to the demo cohort; names are not ownership.
delete from projects project
 where exists (
   select 1 from profiles creator
    where creator.id = project.created_by
      and creator.email like '%@demo.osubb'
 );

-- Teams after tasks and events, which reference them.
delete from teams t
 where t.id in ('t-app', 't-recruti', 't-logistica');

delete from auth.users where email like '%@demo.osubb';

-- ==================== One login per role ====================
-- Password for all of them: parola123
--
-- ⚠️ Writing auth.users by hand has one non-obvious requirement: GoTrue reads
-- the token columns as NOT NULL strings, so they must be '' and not left null.
-- A null confirmation_token makes every login fail with a 500 and
-- "converting NULL to string is unsupported" — which looks like a broken app,
-- not a broken fixture.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', m.id, 'authenticated', 'authenticated',
       m.email, extensions.crypt('parola123', extensions.gen_salt('bf')), now(),
       now(), now(), '{"provider":"email","providers":["email"]}', '{}',
       '', '', '', '', '', '', '', ''
  from (values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'recrut@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'voluntar@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'activ@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000004'::uuid, 'vot@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000005'::uuid, 'responsabil@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000006'::uuid, 'bce@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000007'::uuid, 'bc@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000008'::uuid, 'moderator@demo.osubb')
  ) as m (id, email);

-- Names are ordinary Romanian names on purpose: a demo full of "Test User 1"
-- reads as a prototype, and BC are looking at this on September 15.
insert into profiles (id, full_name, email, role, joined_year, avatar_color) values
  ('d0000000-0000-0000-0000-000000000001', 'Andrei Mureșan',   'recrut@demo.osubb',      'recrut',      2026, '#ED2025'),
  ('d0000000-0000-0000-0000-000000000002', 'Ioana Popescu',    'voluntar@demo.osubb',    'voluntar',    2025, '#284C93'),
  ('d0000000-0000-0000-0000-000000000003', 'Vlad Constantin',  'activ@demo.osubb',       'activ',       2025, '#7500A0'),
  ('d0000000-0000-0000-0000-000000000004', 'Maria Dobre',      'vot@demo.osubb',         'vot',         2024, '#007F33'),
  ('d0000000-0000-0000-0000-000000000005', 'Raluca Ionescu',   'responsabil@demo.osubb', 'responsabil', 2024, '#F2A700'),
  ('d0000000-0000-0000-0000-000000000006', 'Alex Băncilă',     'bce@demo.osubb',         'bce',         2023, '#ED2025'),
  ('d0000000-0000-0000-0000-000000000007', 'Cristina Șerban',  'bc@demo.osubb',          'bc',          2023, '#FF3B3B'),
  ('d0000000-0000-0000-0000-000000000008', 'Moderator OSUBB',  'moderator@demo.osubb',   'moderator',   2023, '#241F1E');

-- Departments: spread across the five real ones so the department cup has
-- something to compare, and two members sit in two (that combination is what
-- the visibility rules are hardest on).
--
-- #296 remap: `bce@` and `moderator@` belong to the coordination structure
-- **Diverse** (and Team `it` below), not to a delivery Department. That is
-- the AC, and it has a visible consequence the demo is meant to show:
-- private.can_manage_origin gives Department authority to BC/Moderator
-- (level ≥ 6) and to a **local BCE of that Department** only, so with no BCE
-- inside edu/pr/youth/fin/hr, every Department Task below is created and
-- evaluated by `bc@` or `moderator@`. The other three authority branches are
-- each demonstrated by exactly one Origin: the Department Team `it` (its
-- parent Department is Diverse, so `bce@` manages it), the Independent Team
-- `t-logistica` (every active member manages it), and the active Project
-- (its lead and its Responsible).
insert into member_departments (member_id, dept_id) values
  ('d0000000-0000-0000-0000-000000000001', 'edu'),
  ('d0000000-0000-0000-0000-000000000002', 'edu'),
  ('d0000000-0000-0000-0000-000000000003', 'pr'),
  ('d0000000-0000-0000-0000-000000000004', 'youth'),
  ('d0000000-0000-0000-0000-000000000005', 'edu'),
  ('d0000000-0000-0000-0000-000000000006', 'diverse'),
  ('d0000000-0000-0000-0000-000000000007', 'org'),
  ('d0000000-0000-0000-0000-000000000008', 'diverse'),
  -- Financiar and Resurse Umane get a member each so all five real
  -- departments appear in the cup. `dept_cup` inner-joins through
  -- member_departments, so a department with nobody in it disappears from the
  -- standings entirely (issue #134) — which would be a strange thing for BC
  -- to notice mid-demo.
  ('d0000000-0000-0000-0000-000000000007', 'fin'),
  ('d0000000-0000-0000-0000-000000000005', 'hr'),
  -- Secretariat is the other coordination structure #310 created. It carries
  -- no Tasks of its own; it exists here so the directory and the Department
  -- picker show both coordination structures populated.
  ('d0000000-0000-0000-0000-000000000004', 'secretariat');

-- Representative Team kinds: two Department Teams and one Independent Team.
-- t-recruti keeps existing as a plain Department Team — demo accounts
-- reference it — even though #372 retired the recruits flag it used to
-- carry; Calendar visibility for recruits is Minimum Level now (ADR-0008),
-- demonstrated below by the events that stay at min_level 0.
insert into teams (id, name, dept_id, is_interne) values
  ('t-app',     'Echipa Aplicație', 'diverse', false),
  ('t-recruti', 'Echipa Recruți',   'edu',     false),
  ('t-logistica','Echipa Logistică', null,     false);

-- `it` is reference data from #310 (a Department Team under Diverse), not a
-- demo Team, so it is never deleted above — only these memberships are, and
-- they cascade from `profiles`. It is where the #296 remap puts `bce@` and
-- `moderator@`, and it is the Origin of the "completed on time" Task below.
insert into team_members (team_id, member_id) values
  ('t-app',     'd0000000-0000-0000-0000-000000000006'),
  ('t-app',     'd0000000-0000-0000-0000-000000000008'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000002'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000005'),
  ('t-logistica','d0000000-0000-0000-0000-000000000004'),
  ('t-logistica','d0000000-0000-0000-0000-000000000007'),
  ('it',        'd0000000-0000-0000-0000-000000000006'),
  ('it',        'd0000000-0000-0000-0000-000000000008');

-- ==================== Representative Projects ====================
-- Projects are independent from departments. These two fixtures cover the
-- active and archived lifecycles as well as lead, Responsible, ordinary
-- member, and outsider authorization scenarios. The database assigns their
-- ids; tests and dependent seed rows locate them by stable content instead.
insert into projects (name, status, leader_id, created_by) values
  ('Festivalul Studențesc 2026', 'active',
   'd0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000007'),
  ('Gala Voluntarilor 2025', 'archived',
   'd0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000007');

-- The leader membership is inserted automatically by the Project invariant
-- trigger. Add only the non-leader roles here. Vlad deliberately has the
-- ordinary OSUBB role `activ` while being a Project Responsible: Project
-- authority is independent from the organization-wide `responsabil` role.
insert into project_members (project_id, member_id, project_role)
select project.id, fixture.member_id, fixture.project_role
  from (values
    ('Festivalul Studențesc 2026',
     'd0000000-0000-0000-0000-000000000003'::uuid, 'responsible'),
    ('Festivalul Studențesc 2026',
     'd0000000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('Gala Voluntarilor 2025',
     'd0000000-0000-0000-0000-000000000006'::uuid, 'responsible'),
    ('Gala Voluntarilor 2025',
     'd0000000-0000-0000-0000-000000000001'::uuid, 'member')
  ) as fixture (project_name, member_id, project_role)
  join projects project
    on project.name = fixture.project_name
   and project.created_by = 'd0000000-0000-0000-0000-000000000007';

-- ==================== Demo work: campaigns, Tasks, evaluations, points ====================
-- #296 rebuilds this section on the normalized Tracker model (ADR-0007).
--
-- The seed CANNOT call the Task commands: it runs as the table owner with no
-- `auth.uid()`, and every command reads its actor from there. So each scenario
-- below is written out row by row, in exactly the shape the command that owns
-- it would have produced — the same Assignment history, the same Candidate
-- Queue decisions, the same activity `kind`/`details`, the same Evaluation and
-- ledger pair. `supabase/tests/demo_seed.test.sql` asserts that shape back:
-- it is what makes this demo data provable rather than plausible.
--
-- Nothing here hard-codes a points number. Every Evaluation's `points` and
-- every ledger `delta` is `difficulty * public.rating_mult(rating)`, the one
-- formula `private.evaluate_task` uses, so the demo illustrates the scoring
-- guide instead of a snapshot of it.
--
-- Scenario matrix (one Task key per row unless noted):
--
--   direct, in progress ............ edu-in-progress
--   public, open queue, no Executor  pr-open-queue, hr-open-queue (both 0 candidates)
--   public, Executor + 2 pending ... edu-public-queue
--   in review, once returned ....... project-in-review
--   completed on time .............. it-completed          (Department Team)
--   completed late ................. edu-completed-late    (queue closed)
--   unfulfilled .................... pr-unfulfilled        (negative ledger row)
--   reopened then re-evaluated ..... edu-reopened          (reversal + 2nd Evaluation)
--   cancelled with reason .......... team-cancelled        (Independent Team)
--   umbrella with mixed Subtasks ... edu-umbrella + edu-subtask-{done,progress,cancelled}
--   duplicated from the unfulfilled  pr-duplicate
--   campaign-labelled .............. one active Campaign per real Department
--   completed-work requests ........ approved / pending / rejected

-- Deadlines are relative to `now()` and land on Bucharest 23:59 of the target
-- day, the way a human picks one. Negative days are deadlines already past.
create or replace function pg_temp.demo_deadline(p_days integer)
returns timestamptz
language sql
stable
as $$
  select ((((now() at time zone 'Europe/Bucharest')::date + p_days)::timestamp
          + time '23:59') at time zone 'Europe/Bucharest')
$$;

-- ---------------- Campaigns ----------------
-- One active Campaign per real Department (issue AC). `tasks_validate_campaign`
-- (#314) accepts a Campaign only on a Task of the same Department — or of a
-- Department Team whose parent Department matches — and only while it is
-- active, so these are created before any Task that carries one.
insert into campaigns (department_id, name, is_active, created_by, created_at) values
  ('edu',   'Școala de Toamnă 2026',            true, 'd0000000-0000-0000-0000-000000000007', now() - interval '45 days'),
  ('pr',    'Campania de imagine — semestrul I', true, 'd0000000-0000-0000-0000-000000000007', now() - interval '40 days'),
  ('youth', 'Tabăra de Toamnă 2026',            true, 'd0000000-0000-0000-0000-000000000007', now() - interval '38 days'),
  ('fin',   'Bugetare 2026–2027',               true, 'd0000000-0000-0000-0000-000000000008', now() - interval '30 days'),
  ('hr',    'Recrutarea de toamnă 2026',        true, 'd0000000-0000-0000-0000-000000000008', now() - interval '25 days');

create or replace function pg_temp.demo_campaign_id(p_dept text)
returns bigint
language sql
stable
as $$
  select campaign.id
    from public.campaigns as campaign
    join public.profiles as creator on creator.id = campaign.created_by
   where campaign.department_id = p_dept
     and creator.email like '%@demo.osubb'
$$;

-- ---------------- Completed-work requests, as submitted ----------------
-- Requests are written before the Tasks because an approval names the Task it
-- created (`task_id`), while the approved Task's own `created` activity row
-- names the request it came from (`details.from_request_id`). Both rows are
-- inserted pending here and decided further down, which is also the order the
-- commands (#344) run in.
insert into completed_work_requests
  (requester_id, dept_id, team_id, project_id, description, status, created_at)
select fixture.requester_id, fixture.dept_id, fixture.team_id, project.id,
       fixture.description, 'pending', fixture.created_at
  from (values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'edu', null::text, null::text,
     'Am pregătit standul OSUBB la târgul de voluntariat și am strâns formularele de înscriere.',
     now() - interval '5 days'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, null, null, 'Festivalul Studențesc 2026',
     'Am realizat afișele pentru concertul de deschidere al festivalului.',
     now() - interval '2 days'),
    ('d0000000-0000-0000-0000-000000000004'::uuid, null, 't-logistica', null,
     'Am dus materialele echipei la depozit după eveniment.',
     now() - interval '6 days')
  ) as fixture (requester_id, dept_id, team_id, project_name, description, created_at)
  left join projects project
    on project.name = fixture.project_name
   and project.created_by = 'd0000000-0000-0000-0000-000000000007';

-- ---------------- Tasks ----------------
-- Stage 1 inserts every Task in the shape `create_task` leaves it: `todo`, no
-- Difficulty, no Rating, `queue_opened_at` set exactly when the mode is
-- public. Stage 2 moves each one to its final state in a single UPDATE, so no
-- row ever sits in a shape `tasks_evaluation_inputs_ck`,
-- `tasks_queue_timestamp_state_check` or `tasks_cancel_reason_ck` forbids.
--
-- Origins and creators are not decorative. `private.require_origin_manager`
-- would have had to accept each `created_by` below: BC/Moderator for a
-- Department (no demo BCE sits in a delivery Department after the #296
-- remap), `bce@` for the Department Team `it` through its parent Department
-- Diverse, the Project lead for the Project, and any active member for the
-- Independent Team.
drop table if exists pg_temp.demo_task_seed;
create temp table demo_task_seed (
  key             text primary key,
  title           text not null,
  description     text,
  type            text,
  dept_id         text,
  team_id         text,
  project_name    text,
  kind            text not null,
  audience        text,
  assignment_mode text,
  campaign_dept   text,
  parent_key      text,
  deadline        timestamptz,
  created_by      uuid not null,
  created_at      timestamptz not null
);

insert into demo_task_seed values
  -- Direct, in progress. The notification block at the end of this file
  -- refers to this Task by title; keep the two in step.
  ('edu-in-progress', 'Contactare lectori',
   'Confirmări pentru semestrul viitor.', 'logistic', 'edu', null, null,
   'task', 'local', 'direct', 'edu', null,
   pg_temp.demo_deadline(5), 'd0000000-0000-0000-0000-000000000007', now() - interval '9 days'),

  -- Public, open queue, nobody in it: the emptiest state the "Deschise" tab has.
  ('pr-open-queue', 'Distribuie story-ul de recrutare',
   'Distribuie story-ul de recrutare pe conturile personale.', 'promo', 'pr', null, null,
   'task', 'org', 'public', null, null,
   pg_temp.demo_deadline(3), 'd0000000-0000-0000-0000-000000000007', now() - interval '2 days'),

  -- Public, open queue, nobody in it either: a second empty queue in a
  -- different Department. No command leaves a `pending` Candidate with no
  -- Executor (express_task_interest takes the first-come branch when there
  -- is none), so this mirrors pr-open-queue rather than pairing with it.
  ('hr-open-queue', 'Voluntari pentru standul de recrutare',
   'Două ore la stand, în campus.', 'logistic', 'hr', null, null,
   'task', 'org', 'public', null, null,
   pg_temp.demo_deadline(11), 'd0000000-0000-0000-0000-000000000008', now() - interval '4 days'),

  -- Public with a first-come Executor and two Members queued behind them.
  ('edu-public-queue', 'Ajutor la standul Educațional',
   'Program de tutoriat pentru boboci, două ture.', 'logistic', 'edu', null, null,
   'task', 'local', 'public', null, null,
   pg_temp.demo_deadline(9), 'd0000000-0000-0000-0000-000000000007', now() - interval '6 days'),

  -- Project origin, in review after one round of feedback.
  ('project-in-review', 'Raport parteneriate pentru festival',
   'Centralizarea partenerilor și a sumelor confirmate.', 'admin', null, null, 'Festivalul Studențesc 2026',
   'task', 'local', 'direct', null, null,
   pg_temp.demo_deadline(4), 'd0000000-0000-0000-0000-000000000005', now() - interval '14 days'),

  -- Department Team origin (`it` sits under Diverse), completed before its deadline.
  ('it-completed', 'Migrare bază de date',
   'Migrare completă cu teste automate.', 'tehnic', null, 'it', null,
   'task', 'local', 'direct', null, null,
   pg_temp.demo_deadline(-2), 'd0000000-0000-0000-0000-000000000006', now() - interval '20 days'),

  -- Completed after its deadline, with the Queue closed automatically by the
  -- Evaluation and the one waiting Candidate closed with it.
  ('edu-completed-late', 'Materiale curs Excel',
   'Slide-uri și exerciții pentru cursul de Excel.', 'content', 'edu', null, null,
   'task', 'local', 'public', null, null,
   pg_temp.demo_deadline(-12), 'd0000000-0000-0000-0000-000000000007', now() - interval '30 days'),

  -- Unfulfilled: Rating 1 is a penalty, not a zero. This is the row that
  -- proves the leaderboard can go down.
  ('pr-unfulfilled', 'Fotografii de la evenimentul de deschidere',
   'Poze de la evenimentul de deschidere.', 'content', 'pr', null, null,
   'task', 'local', 'direct', 'pr', null,
   pg_temp.demo_deadline(-10), 'd0000000-0000-0000-0000-000000000007', now() - interval '25 days'),

  -- Evaluated, reopened, re-evaluated: two Assignments, a reversed Evaluation,
  -- a `task_reversal` ledger row and a second Evaluation.
  ('edu-reopened', 'Workshop CV pentru boboci',
   'Sesiune practică de redactare CV.', 'proiect', 'edu', null, null,
   'task', 'local', 'direct', 'edu', null,
   pg_temp.demo_deadline(-20), 'd0000000-0000-0000-0000-000000000007', now() - interval '40 days'),

  -- Independent Team origin, cancelled with a reason.
  ('team-cancelled', 'Inventar materiale pentru depozit',
   'Inventarierea materialelor rămase după eveniment.', 'logistic', null, 't-logistica', null,
   'task', 'org', 'public', null, null,
   pg_temp.demo_deadline(2), 'd0000000-0000-0000-0000-000000000007', now() - interval '15 days'),

  -- Umbrella: no audience, no mode, no Executor, no Queue.
  ('edu-umbrella', 'Programul Educațional de toamnă',
   'Umbrelă pentru activitățile educaționale ale semestrului.', 'proiect', 'edu', null, null,
   'umbrella', null, null, null, null,
   pg_temp.demo_deadline(15), 'd0000000-0000-0000-0000-000000000007', now() - interval '35 days'),

  -- Campaign-labelled work in the remaining real Departments.
  ('youth-completed', 'Logistică Tabăra de Toamnă',
   'Transport, cazare, program.', 'logistic', 'youth', null, null,
   'task', 'local', 'direct', 'youth', null,
   pg_temp.demo_deadline(-20), 'd0000000-0000-0000-0000-000000000007', now() - interval '28 days'),
  ('fin-completed', 'Buget trimestrial',
   'Raport de buget pentru BC.', 'admin', 'fin', null, null,
   'task', 'local', 'direct', 'fin', null,
   pg_temp.demo_deadline(-5), 'd0000000-0000-0000-0000-000000000008', now() - interval '18 days'),
  ('hr-in-progress', 'Interviuri de recrutare',
   'Programare și susținere interviuri.', 'hr', 'hr', null, null,
   'task', 'local', 'direct', 'hr', null,
   pg_temp.demo_deadline(8), 'd0000000-0000-0000-0000-000000000008', now() - interval '10 days'),

  -- The Task an approved completed-work request creates: born finished, with
  -- `deadline` and `created_at` at the approval instant (#344).
  ('edu-request-task', 'Am pregătit standul OSUBB la târgul de voluntariat și am strâns formularele de înscriere.',
   'Am pregătit standul OSUBB la târgul de voluntariat și am strâns formularele de înscriere.',
   null, 'edu', null, null,
   'task', 'local', 'direct', null, null,
   now() - interval '3 days', 'd0000000-0000-0000-0000-000000000008', now() - interval '3 days'),

  -- Subtasks. Their Origin is inherited from the Umbrella and immutable
  -- afterwards (`private.validate_task_hierarchy`, #315).
  ('edu-subtask-done', 'Rezervarea sălilor pentru cursuri',
   'Rezervări la FSEGA pentru tot semestrul.', 'logistic', 'edu', null, null,
   'task', 'local', 'direct', null, 'edu-umbrella',
   pg_temp.demo_deadline(-18), 'd0000000-0000-0000-0000-000000000007', now() - interval '34 days'),
  ('edu-subtask-progress', 'Promovarea cursurilor în campus',
   'Afișe și postări pentru cursurile deschise.', 'promo', 'edu', null, null,
   'task', 'local', 'direct', null, 'edu-umbrella',
   pg_temp.demo_deadline(7), 'd0000000-0000-0000-0000-000000000007', now() - interval '34 days'),
  ('edu-subtask-cancelled', 'Colaborare cu asociațiile studențești',
   'Curs comun cu o asociație parteneră.', 'extern', 'edu', null, null,
   'task', 'local', 'direct', null, 'edu-umbrella',
   pg_temp.demo_deadline(-5), 'd0000000-0000-0000-0000-000000000007', now() - interval '34 days');

insert into tasks
  (title, description, type, dept_id, team_id, project_id, kind, audience,
   assignment_mode, campaign_id, status, deadline, created_by, created_at,
   queue_opened_at)
select fixture.title, fixture.description, fixture.type,
       fixture.dept_id, fixture.team_id, project.id,
       fixture.kind, fixture.audience, fixture.assignment_mode,
       pg_temp.demo_campaign_id(fixture.campaign_dept),
       'todo'::public.task_status, fixture.deadline, fixture.created_by,
       fixture.created_at,
       case when fixture.assignment_mode = 'public' then fixture.created_at end
  from demo_task_seed fixture
  left join projects project
    on project.name = fixture.project_name
   and project.created_by = 'd0000000-0000-0000-0000-000000000007'
 where fixture.parent_key is null
 order by fixture.created_at, fixture.key;

-- Titles are unique among the Tasks inserted so far, which is what lets the
-- key map be built from them. The duplicate further down deliberately shares
-- the title of its source (that is what `duplicate_task` writes), so it is
-- mapped from its own INSERT instead.
drop table if exists pg_temp.demo_task;
create temp table demo_task (key text primary key, id bigint not null unique);

insert into demo_task (key, id)
select fixture.key, task.id
  from demo_task_seed fixture
  join tasks task on task.title = fixture.title
  join profiles creator on creator.id = task.created_by
 where fixture.parent_key is null
   and creator.email like '%@demo.osubb';

create or replace function pg_temp.demo_task_id(p_key text)
returns bigint
language sql
stable
as $$ select id from pg_temp.demo_task where key = p_key $$;

insert into tasks
  (title, description, type, dept_id, team_id, kind, audience,
   assignment_mode, status, deadline, created_by, created_at, parent_task_id)
select fixture.title, fixture.description, fixture.type,
       fixture.dept_id, fixture.team_id, fixture.kind, fixture.audience,
       fixture.assignment_mode, 'todo'::public.task_status, fixture.deadline,
       fixture.created_by, fixture.created_at,
       pg_temp.demo_task_id(fixture.parent_key)
  from demo_task_seed fixture
 where fixture.parent_key is not null
 order by fixture.key;

insert into demo_task (key, id)
select fixture.key, task.id
  from demo_task_seed fixture
  join tasks task on task.title = fixture.title
  join profiles creator on creator.id = task.created_by
 where fixture.parent_key is not null
   and creator.email like '%@demo.osubb';

-- The duplicate. `duplicate_task` (#343) copies title, description, Origin,
-- audience, assignment mode and a still-active Campaign, takes a fresh
-- deadline, resets the status to `todo` and drops the Executor — so the clone
-- carries the source's title verbatim and `duplicated_from_task_id` is the
-- only thing that tells the two apart. `type` is null on the clone: no
-- command in the wave writes `tasks.type` at all, and `duplicate_task`'s own
-- column list does not carry it over.
with cloned as (
  insert into tasks
    (title, description, type, dept_id, team_id, campaign_id, audience,
     assignment_mode, kind, status, deadline, created_by, created_at,
     duplicated_from_task_id)
  select source.title, source.description, null::text, source.dept_id,
         source.team_id, source.campaign_id, source.audience,
         source.assignment_mode, 'task', 'todo'::public.task_status,
         pg_temp.demo_deadline(6), 'd0000000-0000-0000-0000-000000000007',
         now() - interval '7 days', source.id
    from tasks source
   where source.id = pg_temp.demo_task_id('pr-unfulfilled')
  returning id
)
insert into demo_task (key, id) select 'pr-duplicate', id from cloned;

-- ---------------- Stage 2: each Task's final lifecycle state ----------------
-- One statement per Task, each self-consistent: a terminal public Task closes
-- its Queue in the same UPDATE that makes it terminal, a completed or
-- unfulfilled Task gets its Difficulty and Rating in the same statement as its
-- status, and `cancel_reason` arrives with `cancelled`.
update tasks set status = 'in_progress', started_at = now() - interval '7 days'
 where id = pg_temp.demo_task_id('edu-in-progress');

update tasks set status = 'in_progress', started_at = now() - interval '5 days'
 where id = pg_temp.demo_task_id('edu-public-queue');

update tasks
   set status                  = 'in_review',
       started_at              = now() - interval '12 days',
       returned_to_progress_at = now() - interval '5 days',
       review_round            = 1,
       submitted_at            = now() - interval '2 days'
 where id = pg_temp.demo_task_id('project-in-review');

update tasks
   set status       = 'completed',
       started_at   = now() - interval '18 days',
       submitted_at = now() - interval '5 days',
       completed_at = now() - interval '4 days',
       difficulty   = 5,
       rating       = 4
 where id = pg_temp.demo_task_id('it-completed');

-- Completed late: `completed_at` is a full four days past the deadline.
update tasks
   set status         = 'completed',
       started_at     = now() - interval '25 days',
       submitted_at   = now() - interval '9 days',
       completed_at   = now() - interval '8 days',
       queue_closed_at = now() - interval '8 days',
       difficulty     = 2,
       rating         = 3
 where id = pg_temp.demo_task_id('edu-completed-late');

update tasks
   set status         = 'unfulfilled',
       started_at     = now() - interval '22 days',
       unfulfilled_at = now() - interval '8 days',
       difficulty     = 2,
       rating         = 1
 where id = pg_temp.demo_task_id('pr-unfulfilled');

-- Reopened: `reopen_task` nulls `submitted_at`, so the one on the row is the
-- SECOND submission and `completed_at` the second completion.
update tasks
   set status       = 'completed',
       started_at   = now() - interval '38 days',
       submitted_at = now() - interval '6 days',
       completed_at = now() - interval '5 days',
       difficulty   = 4,
       rating       = 5
 where id = pg_temp.demo_task_id('edu-reopened');

update tasks
   set status          = 'cancelled',
       started_at      = now() - interval '12 days',
       cancelled_at    = now() - interval '1 day',
       queue_closed_at = now() - interval '1 day',
       cancel_reason   = 'Evenimentul a fost anulat de organizatori.'
 where id = pg_temp.demo_task_id('team-cancelled');

update tasks
   set status       = 'completed',
       started_at   = now() - interval '33 days',
       submitted_at = now() - interval '20 days',
       completed_at = now() - interval '19 days',
       difficulty   = 3,
       rating       = 4
 where id = pg_temp.demo_task_id('edu-subtask-done');

update tasks set status = 'in_progress', started_at = now() - interval '30 days'
 where id = pg_temp.demo_task_id('edu-subtask-progress');

update tasks
   set status        = 'cancelled',
       cancelled_at  = now() - interval '15 days',
       cancel_reason = 'Asociația parteneră s-a retras din colaborare.'
 where id = pg_temp.demo_task_id('edu-subtask-cancelled');

update tasks
   set status       = 'completed',
       started_at   = now() - interval '27 days',
       submitted_at = now() - interval '21 days',
       completed_at = now() - interval '20 days',
       difficulty   = 5,
       rating       = 5
 where id = pg_temp.demo_task_id('youth-completed');

update tasks
   set status       = 'completed',
       started_at   = now() - interval '16 days',
       submitted_at = now() - interval '6 days',
       completed_at = now() - interval '5 days',
       difficulty   = 4,
       rating       = 4
 where id = pg_temp.demo_task_id('fin-completed');

update tasks set status = 'in_progress', started_at = now() - interval '8 days'
 where id = pg_temp.demo_task_id('hr-in-progress');

-- Approved completed-work: no `started_at`, no `submitted_at` — the work was
-- done outside the Tracker and the Task is created already finished.
update tasks
   set status       = 'completed',
       completed_at = now() - interval '3 days',
       difficulty   = 2,
       rating       = 3
 where id = pg_temp.demo_task_id('edu-request-task');

-- ---------------- Assignment history ----------------
-- One row per Assignment the commands would have opened. `ended_at` is taken
-- from the Task's own lifecycle timestamp wherever the Assignment ended with
-- it — `private.end_task_assignment` uses the same `now()` as the status
-- write, so the two are equal to the microsecond — and is given explicitly
-- only for the first Assignment of the reopened Task, which ended at a
-- completion the reopen later undid.
drop table if exists pg_temp.demo_assignment_seed;
create temp table demo_assignment_seed (
  key         text primary key,
  task_key    text not null,
  member_id   uuid not null,
  assigned_at timestamptz not null,
  assigned_by uuid,
  ended_at    timestamptz,
  end_reason  text,
  end_note    text
);

insert into demo_assignment_seed
select fixture.key, fixture.task_key, fixture.member_id, fixture.assigned_at,
       fixture.assigned_by,
       coalesce(fixture.ended_at,
                case fixture.end_reason
                  when 'completed'  then task.completed_at
                  when 'failed'     then task.unfulfilled_at
                  when 'cancelled'  then task.cancelled_at
                end),
       fixture.end_reason, fixture.end_note
  from (values
    -- key, task_key, member, assigned_at, assigned_by, ended_at, end_reason, end_note
    ('edu-in-progress', 'edu-in-progress', 'd0000000-0000-0000-0000-000000000002'::uuid,
     now() - interval '9 days', 'd0000000-0000-0000-0000-000000000007'::uuid,
     null::timestamptz, null::text, null::text),
    ('edu-public-queue', 'edu-public-queue', 'd0000000-0000-0000-0000-000000000002',
     now() - interval '5 days', 'd0000000-0000-0000-0000-000000000002', null, null, null),
    ('project-in-review', 'project-in-review', 'd0000000-0000-0000-0000-000000000002',
     now() - interval '14 days', 'd0000000-0000-0000-0000-000000000005', null, null, null),
    ('it-completed', 'it-completed', 'd0000000-0000-0000-0000-000000000008',
     now() - interval '20 days', 'd0000000-0000-0000-0000-000000000006', null, 'completed', null),
    ('edu-completed-late', 'edu-completed-late', 'd0000000-0000-0000-0000-000000000001',
     now() - interval '28 days', 'd0000000-0000-0000-0000-000000000001', null, 'completed', null),
    ('pr-unfulfilled', 'pr-unfulfilled', 'd0000000-0000-0000-0000-000000000003',
     now() - interval '25 days', 'd0000000-0000-0000-0000-000000000007', null, 'failed', null),
    ('edu-reopened-1', 'edu-reopened', 'd0000000-0000-0000-0000-000000000002',
     now() - interval '40 days', 'd0000000-0000-0000-0000-000000000007',
     now() - interval '24 days', 'completed', null),
    ('edu-reopened-2', 'edu-reopened', 'd0000000-0000-0000-0000-000000000002',
     now() - interval '12 days', 'd0000000-0000-0000-0000-000000000007', null, 'completed', null),
    ('team-cancelled', 'team-cancelled', 'd0000000-0000-0000-0000-000000000004',
     now() - interval '13 days', 'd0000000-0000-0000-0000-000000000007', null, 'cancelled',
     'Evenimentul a fost anulat de organizatori.'),
    ('edu-subtask-done', 'edu-subtask-done', 'd0000000-0000-0000-0000-000000000001',
     now() - interval '34 days', 'd0000000-0000-0000-0000-000000000007', null, 'completed', null),
    ('edu-subtask-progress', 'edu-subtask-progress', 'd0000000-0000-0000-0000-000000000002',
     now() - interval '34 days', 'd0000000-0000-0000-0000-000000000007', null, null, null),
    ('youth-completed', 'youth-completed', 'd0000000-0000-0000-0000-000000000004',
     now() - interval '28 days', 'd0000000-0000-0000-0000-000000000007', null, 'completed', null),
    ('fin-completed', 'fin-completed', 'd0000000-0000-0000-0000-000000000007',
     now() - interval '18 days', 'd0000000-0000-0000-0000-000000000008', null, 'completed', null),
    ('hr-in-progress', 'hr-in-progress', 'd0000000-0000-0000-0000-000000000005',
     now() - interval '10 days', 'd0000000-0000-0000-0000-000000000008', null, null, null),
    ('edu-request-task', 'edu-request-task', 'd0000000-0000-0000-0000-000000000001',
     now() - interval '3 days', 'd0000000-0000-0000-0000-000000000008', null, 'completed', null)
  ) as fixture (key, task_key, member_id, assigned_at, assigned_by, ended_at,
                end_reason, end_note)
  join tasks task on task.id = pg_temp.demo_task_id(fixture.task_key);

insert into task_assignments
  (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason, end_note)
select pg_temp.demo_task_id(fixture.task_key), fixture.member_id,
       fixture.assigned_at, fixture.assigned_by, fixture.ended_at,
       fixture.end_reason, fixture.end_note
  from demo_assignment_seed fixture
 order by fixture.assigned_at, fixture.key;

drop table if exists pg_temp.demo_assignment;
create temp table demo_assignment as
select fixture.key, assignment.id
  from demo_assignment_seed fixture
  join task_assignments assignment
    on assignment.task_id = pg_temp.demo_task_id(fixture.task_key)
   and assignment.member_id = fixture.member_id
   and assignment.assigned_at = fixture.assigned_at;

create or replace function pg_temp.demo_assignment_id(p_key text)
returns bigint
language sql
stable
as $$ select id from pg_temp.demo_assignment where key = p_key $$;

-- ---------------- Candidate Queues ----------------
-- `task_candidates_decision_shape_ck` is what each status here has to satisfy:
-- `pending` carries no decision at all, `selected` names the manager who chose
-- and the Assignment that followed, and `closed` carries a decision time with
-- a decider only when a person closed the queue — an automatic close at
-- Evaluation time leaves `decided_by` null (`private.close_task_queue`).
-- No Member is both the active Executor and a pending Candidate of the same
-- Task; nothing in the command set may produce that shape.
insert into task_candidates
  (task_id, member_id, status, joined_at, decided_at, decided_by, assignment_id)
select pg_temp.demo_task_id(fixture.task_key), fixture.member_id, fixture.status,
       fixture.joined_at, fixture.decided_at, fixture.decided_by,
       case when fixture.assignment_key is null
            then null else pg_temp.demo_assignment_id(fixture.assignment_key) end
  from (values
    -- Two Members queued behind a first-come Executor.
    ('edu-public-queue', 'd0000000-0000-0000-0000-000000000001'::uuid, 'pending',
     now() - interval '4 days', null::timestamptz, null::uuid, null::text),
    ('edu-public-queue', 'd0000000-0000-0000-0000-000000000005', 'pending',
     now() - interval '3 days', null, null, null),
    -- hr-open-queue carries no Candidate at all (#296 fix round 1): no
    -- command leaves a pending Candidature with no Executor, so it stays a
    -- second empty queue rather than "one step on" from pr-open-queue.
    -- Closed automatically when the Evaluation made the Task terminal:
    -- decided_at, no decider.
    ('edu-completed-late', 'd0000000-0000-0000-0000-000000000002', 'closed',
     now() - interval '26 days', now() - interval '8 days', null, null),
    -- Chosen by the manager, who left the rest of the queue open…
    ('team-cancelled', 'd0000000-0000-0000-0000-000000000004', 'selected',
     now() - interval '14 days', now() - interval '13 days',
     'd0000000-0000-0000-0000-000000000007', 'team-cancelled'),
    -- …until the cancellation closed it, this time with the canceller named.
    ('team-cancelled', 'd0000000-0000-0000-0000-000000000003', 'closed',
     now() - interval '13 days 12 hours', now() - interval '1 day',
     'd0000000-0000-0000-0000-000000000007', null)
  ) as fixture (task_key, member_id, status, joined_at, decided_at, decided_by,
                assignment_key);

-- ---------------- Evaluations ----------------
-- `source = 'command'` for every one of them: #345 retired the legacy write
-- paths and #317's trigger refuses `legacy_migration` outright, so the demo no
-- longer carries a multi-credit Task. Each Evaluation names the Assignment it
-- credits, and the evaluator is someone `private.can_evaluate_task` would have
-- accepted — BC/Moderator for a Department, the local BCE of Diverse for the
-- Department Team `it`.
--
-- The reopened Task's first Evaluation is inserted already reversed. The
-- reversal trio is the only UPDATE `private.guard_task_evaluation_change`
-- permits, and writing it at INSERT time keeps this file from needing that
-- exception at all.
insert into task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating,
   points, note, evaluated_at, reversed_at, reversed_by, reversal_reason)
select pg_temp.demo_task_id(fixture.task_key),
       pg_temp.demo_assignment_id(fixture.assignment_key),
       'command', fixture.evaluated_by, fixture.outcome,
       fixture.difficulty, fixture.rating,
       fixture.difficulty * rating_mult(fixture.rating),
       fixture.note, fixture.evaluated_at,
       fixture.reversed_at, fixture.reversed_by, fixture.reversal_reason
  from (values
    ('it-completed', 'it-completed', 'd0000000-0000-0000-0000-000000000006'::uuid,
     'completed', 5, 4, 'Migrare curată, cu teste automate și fără downtime.',
     now() - interval '4 days', null::timestamptz, null::uuid, null::text),
    ('edu-completed-late', 'edu-completed-late', 'd0000000-0000-0000-0000-000000000007',
     'completed', 2, 3, 'Materiale bune, predate cu întârziere față de deadline.',
     now() - interval '8 days', null, null, null),
    ('pr-unfulfilled', 'pr-unfulfilled', 'd0000000-0000-0000-0000-000000000007',
     'unfulfilled', 2, 1, 'Pozele nu au fost livrate până la termen.',
     now() - interval '8 days', null, null, null),
    ('edu-reopened', 'edu-reopened-1', 'd0000000-0000-0000-0000-000000000007',
     'completed', 4, 4, 'Workshop bun, materialele de sprijin lipsesc.',
     now() - interval '24 days', now() - interval '12 days',
     'd0000000-0000-0000-0000-000000000007',
     'Au apărut materialele complete; reluăm evaluarea.'),
    ('edu-reopened', 'edu-reopened-2', 'd0000000-0000-0000-0000-000000000007',
     'completed', 4, 5, 'Materialele complete schimbă nota: workshop exemplar.',
     now() - interval '5 days', null, null, null),
    ('edu-subtask-done', 'edu-subtask-done', 'd0000000-0000-0000-0000-000000000007',
     'completed', 3, 4, 'Toate sălile rezervate pentru întreg semestrul.',
     now() - interval '19 days', null, null, null),
    ('youth-completed', 'youth-completed', 'd0000000-0000-0000-0000-000000000007',
     'completed', 5, 5, 'Tabără organizată impecabil, de la transport la program.',
     now() - interval '20 days', null, null, null),
    ('fin-completed', 'fin-completed', 'd0000000-0000-0000-0000-000000000008',
     'completed', 4, 4, 'Raport complet, cu toate capitolele de buget acoperite.',
     now() - interval '5 days', null, null, null),
    ('edu-request-task', 'edu-request-task', 'd0000000-0000-0000-0000-000000000008',
     'completed', 2, 3, 'Muncă reală, confirmată de coordonatorul standului.',
     now() - interval '3 days', null, null, null)
  ) as fixture (task_key, assignment_key, evaluated_by, outcome, difficulty,
                rating, note, evaluated_at, reversed_at, reversed_by,
                reversal_reason);

create or replace function pg_temp.demo_evaluation_id(p_assignment_key text)
returns bigint
language sql
stable
as $$
  select evaluation.id
    from public.task_evaluations as evaluation
   where evaluation.assignment_id = pg_temp.demo_assignment_id(p_assignment_key)
$$;

-- ---------------- The ledger ----------------
-- One `task` row per Evaluation, crediting that Evaluation's own Assignment
-- member, and one `task_reversal` row for the Evaluation the reopen undid.
-- `awarded_by` stays null: the Evaluation names the evaluator now.
insert into points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
select assignment.member_id, evaluation.points, 'task', evaluation.task_id,
       evaluation.id, evaluation.evaluated_at
  from task_evaluations evaluation
  join task_assignments assignment on assignment.id = evaluation.assignment_id
  join tasks task on task.id = evaluation.task_id
  join profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb'
 order by evaluation.id;

insert into points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
select assignment.member_id, -evaluation.points, 'task_reversal', evaluation.task_id,
       evaluation.id, evaluation.reversed_at
  from task_evaluations evaluation
  join task_assignments assignment on assignment.id = evaluation.assignment_id
  join tasks task on task.id = evaluation.task_id
  join profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb'
   and evaluation.reversed_at is not null
 order by evaluation.id;

-- A BC sanction is separate from task points and is signed by its author.
insert into points_ledger (member_id, delta, reason, awarded_by, note) values
  ('d0000000-0000-0000-0000-000000000003', -5, 'sanction',
   'd0000000-0000-0000-0000-000000000007', 'Întârziere repetată la ședințe.');

-- ---------------- Deciding the completed-work requests ----------------
-- Approved: the requester's Task exists and the request points at it. Only
-- BC/Moderator can decide an edu request (no BCE sits in a delivery
-- Department) or an Independent Team one (ADR-0007 gives an Independent Team's
-- evaluation to BC/Moderator, never to its members).
update completed_work_requests
   set status        = 'approved',
       decided_by    = 'd0000000-0000-0000-0000-000000000008',
       decided_at    = now() - interval '3 days',
       decision_note = 'Muncă reală, confirmată de coordonatorul standului.',
       task_id       = pg_temp.demo_task_id('edu-request-task')
 where requester_id = 'd0000000-0000-0000-0000-000000000001'
   and dept_id = 'edu';

update completed_work_requests
   set status        = 'rejected',
       decided_by    = 'd0000000-0000-0000-0000-000000000007',
       decided_at    = now() - interval '4 days',
       decision_note = 'Munca aceasta face deja parte dintr-un task evaluat.'
 where requester_id = 'd0000000-0000-0000-0000-000000000004'
   and team_id = 't-logistica';

-- ---------------- Activity timeline ----------------
-- `private.log_task_activity` is the only writer of this table in production,
-- and `task_activity_reject_change` makes it append-only. These rows carry the
-- kinds, actors and `details` keys that helper would have written, including
-- the rule that decides `assignment_id`: it is stamped on rows about the
-- Executor's own work (executor_assigned, candidate_selected, started,
-- submitted, returned_to_progress, evaluated, unfulfilled, reopened) and left
-- null on Task- and queue-level rows (created, interest_expressed, cancelled,
-- duplicated, subtask_completed) — `task_activity_read`'s own-assignment
-- branch depends on it.
insert into task_activity
  (task_id, kind, actor_id, assignment_id, from_status, to_status, note, details, occurred_at)
select pg_temp.demo_task_id(fixture.task_key), fixture.kind, fixture.actor_id,
       case when fixture.assignment_key is null
            then null else pg_temp.demo_assignment_id(fixture.assignment_key) end,
       fixture.from_status::public.task_status,
       fixture.to_status::public.task_status,
       fixture.note, fixture.details, now() - fixture.ago
  from (values
    -- ---- edu-in-progress: direct, in progress
    ('edu-in-progress', 'created', 'd0000000-0000-0000-0000-000000000007'::uuid, null::text,
     null::text, 'todo'::text, null::text,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('edu'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '9 days'),
    ('edu-in-progress', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'edu-in-progress',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '9 days' - interval '2 seconds'),
    ('edu-in-progress', 'started', 'd0000000-0000-0000-0000-000000000002', 'edu-in-progress',
     'todo', 'in_progress', null, '{}'::jsonb, interval '7 days'),

    -- ---- pr-open-queue: public, open, no Candidate and no Executor
    ('pr-open-queue', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'org', 'assignment_mode', 'public',
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '2 days'),

    -- ---- hr-open-queue: public, open, second empty queue (no Candidate)
    ('hr-open-queue', 'created', 'd0000000-0000-0000-0000-000000000008', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'org', 'assignment_mode', 'public',
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '4 days'),

    -- ---- edu-public-queue: first-come Executor, two Members queued behind
    ('edu-public-queue', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'public',
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '6 days'),
    ('edu-public-queue', 'executor_assigned', 'd0000000-0000-0000-0000-000000000002', 'edu-public-queue',
     null, null, null,
     jsonb_build_object('via', 'first_come', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '5 days'),
    ('edu-public-queue', 'started', 'd0000000-0000-0000-0000-000000000002', 'edu-public-queue',
     'todo', 'in_progress', null, '{}'::jsonb, interval '5 days' - interval '2 seconds'),
    ('edu-public-queue', 'interest_expressed', 'd0000000-0000-0000-0000-000000000001', null,
     null, null, null,
     jsonb_build_object('position', 1,
                        'candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('edu-public-queue')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000001')),
     interval '4 days'),
    ('edu-public-queue', 'interest_expressed', 'd0000000-0000-0000-0000-000000000005', null,
     null, null, null,
     jsonb_build_object('position', 2,
                        'candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('edu-public-queue')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000005')),
     interval '3 days'),

    -- ---- project-in-review: submitted, returned once, submitted again
    ('project-in-review', 'created', 'd0000000-0000-0000-0000-000000000005', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', null, 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '14 days'),
    ('project-in-review', 'executor_assigned', 'd0000000-0000-0000-0000-000000000005', 'project-in-review',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '14 days' - interval '2 seconds'),
    ('project-in-review', 'started', 'd0000000-0000-0000-0000-000000000002', 'project-in-review',
     'todo', 'in_progress', null, '{}'::jsonb, interval '12 days'),
    ('project-in-review', 'submitted', 'd0000000-0000-0000-0000-000000000002', 'project-in-review',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '7 days'),
    ('project-in-review', 'returned_to_progress', 'd0000000-0000-0000-0000-000000000005', 'project-in-review',
     'in_review', 'in_progress', 'Adaugă sumele confirmate și persoana de contact pentru fiecare partener.',
     jsonb_build_object('review_round', 1), interval '5 days'),
    ('project-in-review', 'submitted', 'd0000000-0000-0000-0000-000000000002', 'project-in-review',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '2 days'),

    -- ---- it-completed: Department Team work, completed before the deadline
    ('it-completed', 'created', 'd0000000-0000-0000-0000-000000000006', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', null, 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000008'),
     interval '20 days'),
    ('it-completed', 'executor_assigned', 'd0000000-0000-0000-0000-000000000006', 'it-completed',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000008'),
     interval '20 days' - interval '2 seconds'),
    ('it-completed', 'started', 'd0000000-0000-0000-0000-000000000008', 'it-completed',
     'todo', 'in_progress', null, '{}'::jsonb, interval '18 days'),
    ('it-completed', 'submitted', 'd0000000-0000-0000-0000-000000000008', 'it-completed',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '5 days'),
    ('it-completed', 'evaluated', 'd0000000-0000-0000-0000-000000000006', 'it-completed',
     'in_review', 'completed', 'Migrare curată, cu teste automate și fără downtime.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('it-completed'),
                        'difficulty', 5, 'rating', 4, 'points', 5 * rating_mult(4)),
     interval '4 days'),

    -- ---- edu-completed-late: first-come Executor, one Candidate closed with the Evaluation
    ('edu-completed-late', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'public',
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '30 days'),
    ('edu-completed-late', 'executor_assigned', 'd0000000-0000-0000-0000-000000000001', 'edu-completed-late',
     null, null, null,
     jsonb_build_object('via', 'first_come', 'member_id', 'd0000000-0000-0000-0000-000000000001'),
     interval '28 days'),
    ('edu-completed-late', 'interest_expressed', 'd0000000-0000-0000-0000-000000000002', null,
     null, null, null,
     jsonb_build_object('position', 1,
                        'candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('edu-completed-late')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000002')),
     interval '26 days'),
    ('edu-completed-late', 'started', 'd0000000-0000-0000-0000-000000000001', 'edu-completed-late',
     'todo', 'in_progress', null, '{}'::jsonb, interval '25 days'),
    ('edu-completed-late', 'submitted', 'd0000000-0000-0000-0000-000000000001', 'edu-completed-late',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '9 days'),
    ('edu-completed-late', 'evaluated', 'd0000000-0000-0000-0000-000000000007', 'edu-completed-late',
     'in_review', 'completed', 'Materiale bune, predate cu întârziere față de deadline.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-completed-late'),
                        'difficulty', 2, 'rating', 3, 'points', 2 * rating_mult(3)),
     interval '8 days'),

    -- ---- pr-unfulfilled: the penalty, and the source of the duplicate
    ('pr-unfulfilled', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('pr'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000003'),
     interval '25 days'),
    ('pr-unfulfilled', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'pr-unfulfilled',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000003'),
     interval '25 days' - interval '2 seconds'),
    ('pr-unfulfilled', 'started', 'd0000000-0000-0000-0000-000000000003', 'pr-unfulfilled',
     'todo', 'in_progress', null, '{}'::jsonb, interval '22 days'),
    ('pr-unfulfilled', 'unfulfilled', 'd0000000-0000-0000-0000-000000000007', 'pr-unfulfilled',
     'in_progress', 'unfulfilled', 'Pozele nu au fost livrate până la termen.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('pr-unfulfilled'),
                        'difficulty', 2, 'rating', 1, 'points', 2 * rating_mult(1)),
     interval '8 days'),
    ('pr-unfulfilled', 'duplicated', 'd0000000-0000-0000-0000-000000000007', null,
     null, null, null,
     jsonb_build_object('clone_task_id', pg_temp.demo_task_id('pr-duplicate')),
     interval '7 days'),

    -- ---- edu-reopened: evaluated, reopened, re-evaluated
    ('edu-reopened', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('edu'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '40 days'),
    ('edu-reopened', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'edu-reopened-1',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '40 days' - interval '2 seconds'),
    ('edu-reopened', 'started', 'd0000000-0000-0000-0000-000000000002', 'edu-reopened-1',
     'todo', 'in_progress', null, '{}'::jsonb, interval '38 days'),
    ('edu-reopened', 'submitted', 'd0000000-0000-0000-0000-000000000002', 'edu-reopened-1',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '26 days'),
    ('edu-reopened', 'evaluated', 'd0000000-0000-0000-0000-000000000007', 'edu-reopened-1',
     'in_review', 'completed', 'Workshop bun, materialele de sprijin lipsesc.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-reopened-1'),
                        'difficulty', 4, 'rating', 4, 'points', 4 * rating_mult(4)),
     interval '24 days'),
    -- private.open_task_assignment (via = 'reopen') writes its
    -- executor_assigned row unconditionally -- only the notification is
    -- suppressed for a reopen -- and reopen_task_impl calls it BEFORE
    -- logging its own `reopened` row, so this occurs a moment earlier.
    ('edu-reopened', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'edu-reopened-2',
     null, null, null,
     jsonb_build_object('via', 'reopen', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '12 days' + interval '2 seconds'),
    ('edu-reopened', 'reopened', 'd0000000-0000-0000-0000-000000000007', 'edu-reopened-2',
     'completed', 'in_progress', 'Au apărut materialele complete; reluăm evaluarea.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-reopened-1'),
                        'reversal_ledger_id', (select ledger.id from points_ledger ledger
                                                where ledger.reason = 'task_reversal'
                                                  and ledger.evaluation_id = pg_temp.demo_evaluation_id('edu-reopened-1')),
                        'new_assignment_id', pg_temp.demo_assignment_id('edu-reopened-2')),
     interval '12 days'),
    ('edu-reopened', 'submitted', 'd0000000-0000-0000-0000-000000000002', 'edu-reopened-2',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '6 days'),
    ('edu-reopened', 'evaluated', 'd0000000-0000-0000-0000-000000000007', 'edu-reopened-2',
     'in_review', 'completed', 'Materialele complete schimbă nota: workshop exemplar.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-reopened-2'),
                        'difficulty', 4, 'rating', 5, 'points', 4 * rating_mult(5)),
     interval '5 days'),

    -- ---- team-cancelled: Independent Team, selected from the queue, then cancelled
    ('team-cancelled', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'org', 'assignment_mode', 'public',
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '15 days'),
    ('team-cancelled', 'interest_expressed', 'd0000000-0000-0000-0000-000000000004', null,
     null, null, null,
     jsonb_build_object('position', 1,
                        'candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('team-cancelled')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000004')),
     interval '14 days'),
    ('team-cancelled', 'interest_expressed', 'd0000000-0000-0000-0000-000000000003', null,
     null, null, null,
     jsonb_build_object('position', 2,
                        'candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('team-cancelled')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000003')),
     interval '13 days 12 hours'),
    ('team-cancelled', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'team-cancelled',
     null, null, null,
     jsonb_build_object('via', 'select', 'member_id', 'd0000000-0000-0000-0000-000000000004'),
     interval '13 days'),
    ('team-cancelled', 'candidate_selected', 'd0000000-0000-0000-0000-000000000007', 'team-cancelled',
     null, null, null,
     jsonb_build_object('candidate_id', (select candidate.id from task_candidates candidate
                                          where candidate.task_id = pg_temp.demo_task_id('team-cancelled')
                                            and candidate.member_id = 'd0000000-0000-0000-0000-000000000004'),
                        'replaced_assignment_id', null, 'closed_remaining', false,
                        'closed_candidates', 0),
     interval '13 days' - interval '2 seconds'),
    ('team-cancelled', 'started', 'd0000000-0000-0000-0000-000000000004', 'team-cancelled',
     'todo', 'in_progress', null, '{}'::jsonb, interval '12 days'),
    ('team-cancelled', 'cancelled', 'd0000000-0000-0000-0000-000000000007', null,
     'in_progress', 'cancelled', 'Evenimentul a fost anulat de organizatori.',
     jsonb_build_object('ended_assignment_id', pg_temp.demo_assignment_id('team-cancelled'),
                        'closed_candidates', 1),
     interval '1 day'),

    -- ---- edu-umbrella: two Subtasks became terminal under it
    ('edu-umbrella', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'umbrella', 'audience', null, 'assignment_mode', null,
                        'campaign_id', null, 'parent_task_id', null, 'executor_id', null),
     interval '35 days'),
    ('edu-umbrella', 'subtask_completed', 'd0000000-0000-0000-0000-000000000007', null,
     null, null, null,
     jsonb_build_object('subtask_id', pg_temp.demo_task_id('edu-subtask-done'),
                        'outcome', 'completed', 'terminal_count', 1, 'subtask_count', 3),
     interval '19 days'),
    ('edu-umbrella', 'subtask_completed', 'd0000000-0000-0000-0000-000000000007', null,
     null, null, null,
     jsonb_build_object('subtask_id', pg_temp.demo_task_id('edu-subtask-cancelled'),
                        'outcome', 'cancelled', 'terminal_count', 2, 'subtask_count', 3),
     interval '15 days'),

    -- ---- the three Subtasks
    ('edu-subtask-done', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', null, 'parent_task_id', pg_temp.demo_task_id('edu-umbrella'),
                        'executor_id', 'd0000000-0000-0000-0000-000000000001'),
     interval '34 days'),
    ('edu-subtask-done', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'edu-subtask-done',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000001'),
     interval '34 days' - interval '2 seconds'),
    ('edu-subtask-done', 'started', 'd0000000-0000-0000-0000-000000000001', 'edu-subtask-done',
     'todo', 'in_progress', null, '{}'::jsonb, interval '33 days'),
    ('edu-subtask-done', 'submitted', 'd0000000-0000-0000-0000-000000000001', 'edu-subtask-done',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '20 days'),
    ('edu-subtask-done', 'evaluated', 'd0000000-0000-0000-0000-000000000007', 'edu-subtask-done',
     'in_review', 'completed', 'Toate sălile rezervate pentru întreg semestrul.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-subtask-done'),
                        'difficulty', 3, 'rating', 4, 'points', 3 * rating_mult(4)),
     interval '19 days'),

    ('edu-subtask-progress', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', null, 'parent_task_id', pg_temp.demo_task_id('edu-umbrella'),
                        'executor_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '34 days'),
    ('edu-subtask-progress', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'edu-subtask-progress',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000002'),
     interval '34 days' - interval '2 seconds'),
    ('edu-subtask-progress', 'started', 'd0000000-0000-0000-0000-000000000002', 'edu-subtask-progress',
     'todo', 'in_progress', null, '{}'::jsonb, interval '30 days'),

    ('edu-subtask-cancelled', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', null, 'parent_task_id', pg_temp.demo_task_id('edu-umbrella'),
                        'executor_id', null),
     interval '34 days'),
    ('edu-subtask-cancelled', 'cancelled', 'd0000000-0000-0000-0000-000000000007', null,
     'todo', 'cancelled', 'Asociația parteneră s-a retras din colaborare.',
     jsonb_build_object('ended_assignment_id', null, 'closed_candidates', 0),
     interval '15 days'),

    -- ---- pr-duplicate: the clone keeps the source's title
    ('pr-duplicate', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('duplicated_from_task_id', pg_temp.demo_task_id('pr-unfulfilled')),
     interval '7 days'),

    -- ---- campaign-labelled work in the other real Departments
    ('youth-completed', 'created', 'd0000000-0000-0000-0000-000000000007', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('youth'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000004'),
     interval '28 days'),
    ('youth-completed', 'executor_assigned', 'd0000000-0000-0000-0000-000000000007', 'youth-completed',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000004'),
     interval '28 days' - interval '2 seconds'),
    ('youth-completed', 'started', 'd0000000-0000-0000-0000-000000000004', 'youth-completed',
     'todo', 'in_progress', null, '{}'::jsonb, interval '27 days'),
    ('youth-completed', 'submitted', 'd0000000-0000-0000-0000-000000000004', 'youth-completed',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '21 days'),
    ('youth-completed', 'evaluated', 'd0000000-0000-0000-0000-000000000007', 'youth-completed',
     'in_review', 'completed', 'Tabără organizată impecabil, de la transport la program.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('youth-completed'),
                        'difficulty', 5, 'rating', 5, 'points', 5 * rating_mult(5)),
     interval '20 days'),

    ('fin-completed', 'created', 'd0000000-0000-0000-0000-000000000008', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('fin'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000007'),
     interval '18 days'),
    ('fin-completed', 'executor_assigned', 'd0000000-0000-0000-0000-000000000008', 'fin-completed',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000007'),
     interval '18 days' - interval '2 seconds'),
    ('fin-completed', 'started', 'd0000000-0000-0000-0000-000000000007', 'fin-completed',
     'todo', 'in_progress', null, '{}'::jsonb, interval '16 days'),
    ('fin-completed', 'submitted', 'd0000000-0000-0000-0000-000000000007', 'fin-completed',
     'in_progress', 'in_review', null, '{}'::jsonb, interval '6 days'),
    ('fin-completed', 'evaluated', 'd0000000-0000-0000-0000-000000000008', 'fin-completed',
     'in_review', 'completed', 'Raport complet, cu toate capitolele de buget acoperite.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('fin-completed'),
                        'difficulty', 4, 'rating', 4, 'points', 4 * rating_mult(4)),
     interval '5 days'),

    ('hr-in-progress', 'created', 'd0000000-0000-0000-0000-000000000008', null,
     null, 'todo', null,
     jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                        'campaign_id', pg_temp.demo_campaign_id('hr'), 'parent_task_id', null,
                        'executor_id', 'd0000000-0000-0000-0000-000000000005'),
     interval '10 days'),
    ('hr-in-progress', 'executor_assigned', 'd0000000-0000-0000-0000-000000000008', 'hr-in-progress',
     null, null, null,
     jsonb_build_object('via', 'create', 'member_id', 'd0000000-0000-0000-0000-000000000005'),
     interval '10 days' - interval '2 seconds'),
    ('hr-in-progress', 'started', 'd0000000-0000-0000-0000-000000000005', 'hr-in-progress',
     'todo', 'in_progress', null, '{}'::jsonb, interval '8 days'),

    -- ---- edu-request-task: created, assigned and evaluated in one command
    ('edu-request-task', 'created', 'd0000000-0000-0000-0000-000000000008', null,
     null, 'todo', null,
     jsonb_build_object('from_request_id',
                        (select request.id from completed_work_requests request
                          where request.task_id = pg_temp.demo_task_id('edu-request-task'))),
     interval '3 days'),
    ('edu-request-task', 'executor_assigned', 'd0000000-0000-0000-0000-000000000008', 'edu-request-task',
     null, null, null,
     jsonb_build_object('via', 'request_approval', 'member_id', 'd0000000-0000-0000-0000-000000000001'),
     interval '3 days' - interval '2 seconds'),
    ('edu-request-task', 'evaluated', 'd0000000-0000-0000-0000-000000000008', 'edu-request-task',
     'todo', 'completed', 'Muncă reală, confirmată de coordonatorul standului.',
     jsonb_build_object('evaluation_id', pg_temp.demo_evaluation_id('edu-request-task'),
                        'difficulty', 2, 'rating', 3, 'points', 2 * rating_mult(3)),
     interval '3 days' - interval '4 seconds')
  ) as fixture (task_key, kind, actor_id, assignment_key, from_status, to_status,
                note, details, ago);

-- ==================== Calendar ====================
-- One event per scope (org/dept/team/etc.), so switching demo accounts
-- visibly changes the calendar (relevance grouping, ADR-0008) even though
-- Minimum Level — not scope membership — now decides what is readable at
-- all. The AG is the one gated Event: min_level 3 (AG / Voting Member+)
-- demonstrates a Recrut being turned away from something org-wide. Every
-- other Event, including the recruits' own Training, stays at the default
-- min_level 0 so the demo still shows a calendar recruits can read in full.
insert into events (title, type, dept_id, team_id, scope, min_level, starts_at, ends_at, location, capacity, description, created_by) values
  ('Adunarea Generală de toamnă', 'sedinta',   null,   null,       'org',  3,
   now() + interval '9 days',  now() + interval '9 days 3 hours',  'Aula Magna',        200,
   'Raport de activitate și vot.',                    'd0000000-0000-0000-0000-000000000007'),
  ('Ședință Educational',        'sedinta',   'edu',  null,       'dept', 0,
   now() + interval '2 days',  now() + interval '2 days 2 hours',  'Sala 305',           25,
   'Planificarea activităților lunii.',               'd0000000-0000-0000-0000-000000000005'),
  ('Brainstorming campanie PR',  'activitate','pr',   null,       'dept', 0,
   now() + interval '4 days',  now() + interval '4 days 2 hours',  'Sediu OSUBB',        15,
   'Idei pentru campania de iarnă.',                  'd0000000-0000-0000-0000-000000000006'),
  ('Sprint review Echipa Aplicație', 'sedinta','diverse','t-app', 'team', 0,
   now() + interval '1 day',   now() + interval '1 day 1 hour',    'Online',             10,
   'Demo intern al aplicației.',                      'd0000000-0000-0000-0000-000000000006'),
  ('Training pentru recruți',    'activitate','edu',  't-recruti','team', 0,
   now() + interval '6 days',  now() + interval '6 days 3 hours',  'Sala 210',           40,
   'Prima întâlnire cu echipa.',                      'd0000000-0000-0000-0000-000000000005'),
  ('Recrutare de toamnă — stand','recrutare', 'hr',   null,       'dept', 0,
   now() + interval '3 days',  now() + interval '3 days 6 hours',  'Campus FSEGA',      null,
   'Stand de promovare, două ture.',                  'd0000000-0000-0000-0000-000000000005'),
  ('Deadline: raport trimestrial','deadline', 'fin',  null,       'dept', 0,
   now() + interval '7 days',  null,                                null,               null,
   'Trimiterea raportului către BC.',                 'd0000000-0000-0000-0000-000000000007');

-- RSVPs, including one declined — a calendar where everyone always attends
-- does not show that the toggle has two states.
insert into event_attendance (event_id, member_id, status)
select e.id, a.member_id, a.status
  from (values
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000002'::uuid, 'going'),
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000003'::uuid, 'going'),
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000004'::uuid, 'declined'),
    ('Ședință Educational',         'd0000000-0000-0000-0000-000000000002'::uuid, 'going'),
    ('Ședință Educational',         'd0000000-0000-0000-0000-000000000001'::uuid, 'going'),
    ('Training pentru recruți',     'd0000000-0000-0000-0000-000000000001'::uuid, 'going'),
    ('Sprint review Echipa Aplicație','d0000000-0000-0000-0000-000000000006'::uuid, 'going')
  ) as a (title, member_id, status)
  join events e on e.title = a.title;

-- ==================== Announcements ====================
-- One critical + pinned (the feed's loudest state), one with a form link
-- (the v1 forms story — a Google Form, not a native engine), one scoped to a
-- single department, and ordinary ones underneath.
insert into announcements (title, body, dept_id, author, priority, category, pinned, form_label, form_url, published_at, created_by) values
  ('Ședință extraordinară BC — vineri',
   'Vineri, ora 18:00, Aula Magna. Prezența tuturor coordonatorilor este obligatorie.',
   null, 'BC', 'critical', 'organizatoric', true, null, null,
   now() - interval '1 day',  'd0000000-0000-0000-0000-000000000007'),
  ('Feedback eveniment de deschidere',
   'Spune-ne cum ți s-a părut. Durează două minute și chiar ne ajută.',
   null, 'Imagine & PR', 'important', 'feedback', false,
   'Completează formularul', 'https://forms.gle/exemplu-osubb',
   now() - interval '3 days', 'd0000000-0000-0000-0000-000000000006'),
  ('Materiale de la cursul de Excel',
   'Slide-urile și exercițiile sunt în drive-ul departamentului.',
   'edu', 'Educational', 'normal', 'resurse', false, null, null,
   now() - interval '5 days', 'd0000000-0000-0000-0000-000000000005'),
  ('Recrutarea de toamnă începe luni',
   'Standul din campus are nevoie de voluntari pentru două ture pe zi.',
   null, 'Resurse Umane', 'important', 'recrutare', true, null, null,
   now() - interval '2 days', 'd0000000-0000-0000-0000-000000000005'),
  ('Noul ghid de punctaj',
   'Dificultatea și nota se înmulțesc — detaliile sunt în aplicație, la Ghid.',
   null, 'BC', 'normal', 'organizatoric', false, null, null,
   now() - interval '8 days', 'd0000000-0000-0000-0000-000000000007');

-- A few members have already read things, so the unread badge shows a real
-- number instead of "everything" or "nothing".
insert into announcement_reads (announcement_id, member_id)
select a.id, r.member_id
  from (values
    ('Noul ghid de punctaj',              'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Noul ghid de punctaj',              'd0000000-0000-0000-0000-000000000003'::uuid),
    ('Materiale de la cursul de Excel',   'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Recrutarea de toamnă începe luni',  'd0000000-0000-0000-0000-000000000003'::uuid)
  ) as r (title, member_id)
  join announcements a on a.title = r.title;

-- ==================== Notifications ====================
-- Written here by hand only because the fan-out trigger is issue #68; once
-- that lands, announcements will produce these rows themselves.
-- Note the suppression rule at work: BC and BCE get the announcement, never
-- the task/deadline broadcasts.
insert into notifications (member_id, kind, icon, title, body, critical, read, link, created_at) values
  ('d0000000-0000-0000-0000-000000000002', 'announce', '📢', 'Ședință extraordinară BC — vineri', 'Aula Magna, ora 18:00.', true,  false, '/anunturi', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000002', 'event',    '📅', 'Ședință Educational',               'Poimâine, sala 305.',     false, true,  '/calendar', now() - interval '3 days'),
  ('d0000000-0000-0000-0000-000000000001', 'announce', '📢', 'Ședință extraordinară BC — vineri', 'Aula Magna, ora 18:00.', true,  false, '/anunturi', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000001', 'event',    '📅', 'Training pentru recruți',           'Peste 6 zile, sala 210.', false, false, '/calendar', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000003', 'system',   '⚠️', 'Ai primit o sancțiune',             'Contactează BC pentru detalii.', true, false, '/profil', now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000007', 'announce', '📢', 'Recrutarea de toamnă începe luni',  'Standul are nevoie de voluntari.', false, false, '/anunturi', now() - interval '2 days');

-- The one Task-kind notification is rebuilt from its command source rather
-- than hand-written (#296 fix round 1): `edu-in-progress` was created with an
-- Executor, so `private.create_task_impl` calls
-- `private.open_task_assignment(..., 'create')`, which sends exactly this
-- body — copied verbatim from the migration — with no dedupe_key and
-- link/task_id derived the way `private.notify` derives them.
insert into notifications (member_id, kind, icon, title, body, critical, read, link, task_id, created_at)
select 'd0000000-0000-0000-0000-000000000002'::uuid, 'task'::public.noti_kind, '✅',
       'Task nou: ' || task.title,
       'Ți-a fost atribuit acest task. Deadline: ' ||
         to_char(task.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI') || '.',
       false, false, '/tracker/' || task.id::text, task.id,
       now() - (interval '9 days' - interval '2 seconds')
  from tasks task
 where task.id = pg_temp.demo_task_id('edu-in-progress');
