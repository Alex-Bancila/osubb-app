begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ==================== Structure ====================
select has_table('public', 'task_candidates', 'the candidate queue table exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.task_candidates'::regclass),
  'the candidate queue enables RLS at birth');

select columns_are(
  'public', 'task_candidates',
  array['id', 'task_id', 'member_id', 'status', 'joined_at', 'decided_at',
        'decided_by', 'assignment_id', 'created_at'],
  'task_candidates exposes exactly the requested fields');
select has_pk('public', 'task_candidates', 'a candidature has a primary key');
select col_type_is('public', 'task_candidates', 'id', 'bigint', 'candidature id is bigint');
select col_not_null('public', 'task_candidates', 'task_id', 'a candidature names its Task');
select fk_ok('public', 'task_candidates', 'task_id', 'public', 'tasks', 'id',
  'a candidature references its Task');
select col_not_null('public', 'task_candidates', 'member_id', 'a candidature names its Member');
select fk_ok('public', 'task_candidates', 'member_id', 'public', 'profiles', 'id',
  'a candidature references a Profile');
select col_not_null('public', 'task_candidates', 'status', 'status is required');
select col_default_is('public', 'task_candidates', 'status', 'pending',
  'a new candidature starts pending');
select col_not_null('public', 'task_candidates', 'joined_at', 'joined_at is required');
select col_has_default('public', 'task_candidates', 'joined_at', 'joined_at is server-written');
select fk_ok('public', 'task_candidates', 'decided_by', 'public', 'profiles', 'id',
  'a decision can be attributed to a Profile');
select fk_ok('public', 'task_candidates', 'assignment_id', 'public', 'task_assignments', 'id',
  'a selection can reference the resulting Assignment');
select col_not_null('public', 'task_candidates', 'created_at', 'created_at is required');
select col_has_default('public', 'task_candidates', 'created_at', 'created_at is server-written');
select has_index('public', 'task_candidates', 'task_candidates_one_pending_per_member_uidx',
  'one-pending-candidature lookup is indexed');
select has_index('public', 'task_candidates', 'task_candidates_queue_order_idx',
  'queue order lookup is indexed');
select has_index('public', 'task_candidates', 'task_candidates_member_idx',
  'Member history lookup is indexed');
-- An invalid-status insert can't be isolated to this check alone (any status
-- outside the four literals also makes every decision_shape_ck branch false,
-- since each branch starts "status = '<literal>'"), so assert the
-- constraint's own definition instead: a narrowed or widened literal list
-- then fails this test directly.
select is(
  (select pg_get_constraintdef(oid) from pg_catalog.pg_constraint
    where conrelid = 'public.task_candidates'::regclass
      and conname = 'task_candidates_status_ck'),
  'CHECK ((status = ANY (ARRAY[''pending''::text, ''selected''::text, ''withdrawn''::text, ''closed''::text])))',
  'status is constrained to exactly the four approved literals');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('29100000-0000-0000-0000-000000000001', 'decider-291@test.local'),
  ('29100000-0000-0000-0000-000000000002', 'pending-member-291@test.local'),
  ('29100000-0000-0000-0000-000000000003', 'pending-bad-291@test.local'),
  ('29100000-0000-0000-0000-000000000004', 'withdrawn-ok-291@test.local'),
  ('29100000-0000-0000-0000-000000000005', 'withdrawn-bad-291@test.local'),
  ('29100000-0000-0000-0000-000000000006', 'closed-ok-291@test.local'),
  ('29100000-0000-0000-0000-000000000007', 'closed-bad-291@test.local'),
  ('29100000-0000-0000-0000-000000000008', 'selected-ok-291@test.local'),
  ('29100000-0000-0000-0000-000000000009', 'selected-bad-291@test.local'),
  ('29100000-0000-0000-0000-000000000010', 'chronology-bad-291@test.local'),
  ('29100000-0000-0000-0000-000000000011', 'order-a-291@test.local'),
  ('29100000-0000-0000-0000-000000000012', 'order-b-291@test.local'),
  ('29100000-0000-0000-0000-000000000013', 'cascade-291@test.local'),
  ('29100000-0000-0000-0000-000000000014', 'selected-then-pending-291@test.local'),
  ('29100000-0000-0000-0000-000000000015', 'withdrawn-nodecider-291@test.local'),
  ('29100000-0000-0000-0000-000000000016', 'closed-by-manager-291@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('29100000-0000-0000-0000-000000000001', 'Decider 291', 'decider-291@test.local', 'vot'),
  ('29100000-0000-0000-0000-000000000002', 'Pending Member 291', 'pending-member-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000003', 'Pending Bad 291', 'pending-bad-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000004', 'Withdrawn Ok 291', 'withdrawn-ok-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000005', 'Withdrawn Bad 291', 'withdrawn-bad-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000006', 'Closed Ok 291', 'closed-ok-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000007', 'Closed Bad 291', 'closed-bad-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000008', 'Selected Ok 291', 'selected-ok-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000009', 'Selected Bad 291', 'selected-bad-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000010', 'Chronology Bad 291', 'chronology-bad-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000011', 'Order A 291', 'order-a-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000012', 'Order B 291', 'order-b-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000013', 'Cascade 291', 'cascade-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000014', 'Selected Then Pending 291', 'selected-then-pending-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000015', 'Withdrawn Nodecider 291', 'withdrawn-nodecider-291@test.local', 'voluntar'),
  ('29100000-0000-0000-0000-000000000016', 'Closed By Manager 291', 'closed-by-manager-291@test.local', 'voluntar');

-- A public-mode Task with its queue open, for realism (schema itself does not
-- restrict candidatures to public Tasks — that guard is a command invariant,
-- #330).
insert into public.tasks (title, difficulty, group_id, assignment_mode, queue_opened_at)
values ('Candidate queue fixture 291', 1, pg_temp.dept_group('edu'), 'public', now());

-- A second Task, isolated, so the deterministic-order assertion only ever
-- sees the two rows it inserts.
insert into public.tasks (title, difficulty, group_id, assignment_mode, queue_opened_at)
values ('Candidate queue order fixture 291', 1, pg_temp.dept_group('edu'), 'public', now());

-- ==================== One pending candidature per Member (Ruling A) =======
-- "Live" means pending only: task_candidates_one_pending_per_member_uidx
-- covers status = 'pending' alone, not 'selected'.
select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id)
     select id, '29100000-0000-0000-0000-000000000002'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'a Member joins the queue (pending, the default shape)');

select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id)
     select id, '29100000-0000-0000-0000-000000000002'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23505', null,
  'a Member cannot hold two pending candidatures for one Task');

-- A member once selected — whose Assignment later ended (gave up, replaced,
-- ...) — is not blocked from queuing again: a 'selected' row is permanent
-- history, not a live candidature.
insert into public.task_assignments (task_id, member_id)
select id, '29100000-0000-0000-0000-000000000014'
  from public.tasks where title = 'Candidate queue fixture 291';
update public.task_assignments
   set ended_at = now(), end_reason = 'gave_up'
 where member_id = '29100000-0000-0000-0000-000000000014';
insert into public.task_candidates
  (task_id, member_id, status, decided_at, decided_by, assignment_id)
select id, '29100000-0000-0000-0000-000000000014', 'selected', now(),
       '29100000-0000-0000-0000-000000000001',
       (select id from public.task_assignments
         where member_id = '29100000-0000-0000-0000-000000000014')
  from public.tasks where title = 'Candidate queue fixture 291';

select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id)
     select id, '29100000-0000-0000-0000-000000000014'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'a member with a selected row and an ended Assignment can queue again as pending');

-- ==================== Rejoin after withdrawal ====================
select lives_ok(
  $$ update public.task_candidates
        set status = 'withdrawn', decided_at = now(),
            decided_by = '29100000-0000-0000-0000-000000000002'
      where member_id = '29100000-0000-0000-0000-000000000002'
        and task_id = (select id from public.tasks
                        where title = 'Candidate queue fixture 291') $$,
  'withdrawing resolves the live candidature');

select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id)
     select id, '29100000-0000-0000-0000-000000000002'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'withdrawing frees the slot for a rejoin — a fresh row, not an update');

select is(
  (select count(*) from public.task_candidates
    where member_id = '29100000-0000-0000-0000-000000000002'
      and task_id = (select id from public.tasks
                      where title = 'Candidate queue fixture 291')),
  2::bigint,
  'the withdrawn row survives as history alongside the rejoined one');

-- ==================== Decision-shape branches ====================
-- pending: reject a pending row that already carries a decision.
select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_at)
     select id, '29100000-0000-0000-0000-000000000003', 'pending', now()
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23514', null,
  'a pending candidature cannot already carry a decision');

-- withdrawn (Ruling B): a withdrawal is the member's own act, so decided_by
-- is required alongside decided_at — accept with both set, reject each
-- missing in isolation.
select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_at, decided_by)
     select id, '29100000-0000-0000-0000-000000000004', 'withdrawn', now(),
            '29100000-0000-0000-0000-000000000004'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'a withdrawn candidature records when it withdrew and who withdrew it');
select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_by)
     select id, '29100000-0000-0000-0000-000000000005', 'withdrawn',
            '29100000-0000-0000-0000-000000000005'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23514', null,
  'a withdrawn candidature must record when it withdrew');
select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_at)
     select id, '29100000-0000-0000-0000-000000000015', 'withdrawn', now()
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23514', null,
  'a withdrawn candidature must record who withdrew it');

-- closed (Ruling B): decided_at is always required; decided_by is
-- unconstrained — accept both the automatic-close shape (decided_by null)
-- and the manager-closed shape (decided_by set), reject a close missing
-- decided_at.
select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_at)
     select id, '29100000-0000-0000-0000-000000000006', 'closed', now()
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'a queue can close automatically, with no decider recorded');
select lives_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, decided_at, decided_by)
     select id, '29100000-0000-0000-0000-000000000016', 'closed', now(),
            '29100000-0000-0000-0000-000000000001'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  'a manager can close a candidature and be recorded as the decider');
select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id, status)
     select id, '29100000-0000-0000-0000-000000000007', 'closed'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23514', null,
  'a closed candidature must record when it closed');

-- selected: needs a real Assignment row (a real command would create both
-- together). Accept with decided_by + assignment_id set, reject without
-- decided_by.
insert into public.task_assignments (task_id, member_id)
select id, '29100000-0000-0000-0000-000000000008'
  from public.tasks where title = 'Candidate queue fixture 291';

select lives_ok(
  format($$ insert into public.task_candidates
              (task_id, member_id, status, decided_at, decided_by, assignment_id)
            select id, '29100000-0000-0000-0000-000000000008', 'selected', now(),
                   '29100000-0000-0000-0000-000000000001', %s
              from public.tasks where title = 'Candidate queue fixture 291' $$,
    (select id from public.task_assignments
      where member_id = '29100000-0000-0000-0000-000000000008')),
  'a selected candidature records its decider and resulting Assignment');
select throws_ok(
  format($$ insert into public.task_candidates
              (task_id, member_id, status, decided_at, decided_by, assignment_id)
            select id, '29100000-0000-0000-0000-000000000009', 'selected', now(),
                   null, %s
              from public.tasks where title = 'Candidate queue fixture 291' $$,
    (select id from public.task_assignments
      where member_id = '29100000-0000-0000-0000-000000000008')),
  '23514', null,
  'a selected candidature must record who selected it');

-- ==================== Chronology ====================
select throws_ok(
  $$ insert into public.task_candidates (task_id, member_id, status, joined_at, decided_at)
     select id, '29100000-0000-0000-0000-000000000010', 'withdrawn', now(), now() - interval '1 hour'
       from public.tasks where title = 'Candidate queue fixture 291' $$,
  '23514', null,
  'a candidature cannot be decided before it joined');

-- ==================== Deterministic queue order ====================
insert into public.task_candidates (task_id, member_id, joined_at)
select id, '29100000-0000-0000-0000-000000000011', '2026-09-11 12:00:00+00'
  from public.tasks where title = 'Candidate queue order fixture 291';
insert into public.task_candidates (task_id, member_id, joined_at)
select id, '29100000-0000-0000-0000-000000000012', '2026-09-11 12:00:00+00'
  from public.tasks where title = 'Candidate queue order fixture 291';

select is(
  (select array_agg(member_id order by joined_at, id)
     from public.task_candidates
    where task_id = (select id from public.tasks
                      where title = 'Candidate queue order fixture 291')),
  array['29100000-0000-0000-0000-000000000011'::uuid,
        '29100000-0000-0000-0000-000000000012'::uuid],
  'two candidates sharing joined_at still order deterministically by id');

-- ==================== Cascade ====================
insert into public.task_candidates (task_id, member_id)
select id, '29100000-0000-0000-0000-000000000013'
  from public.tasks where title = 'Candidate queue fixture 291';

delete from public.profiles where id = '29100000-0000-0000-0000-000000000013';

select is(
  (select count(*) from public.task_candidates
    where member_id = '29100000-0000-0000-0000-000000000013'),
  0::bigint,
  'deleting a Member cascades their candidatures');

-- ==================== Grants: commands, not clients, write this table ====================
-- #319 added task_candidates_read and a SELECT grant; write grants stay
-- absent below (commands land in #330/#333).
select is((select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'task_candidates'), 1::bigint,
  'the candidate queue carries exactly the #319 read policy');
select is(has_table_privilege('authenticated', 'public.task_candidates', 'SELECT'), true,
  'authenticated holds SELECT on the candidate queue now that task_candidates_read exists (#319)');
select is(has_table_privilege('authenticated', 'public.task_candidates', 'INSERT'), false,
  'authenticated cannot join the queue directly (commands land in #330/#333)');
select is(has_table_privilege('authenticated', 'public.task_candidates', 'UPDATE'), false,
  'authenticated cannot resolve a candidature directly');
select is(has_table_privilege('authenticated', 'public.task_candidates', 'DELETE'), false,
  'authenticated cannot delete a candidature directly');
select is(has_table_privilege('authenticated', 'public.task_candidates', 'TRUNCATE'), false,
  'authenticated cannot truncate the candidate queue');
select is(has_sequence_privilege('authenticated', 'public.task_candidates_id_seq', 'USAGE'), false,
  'authenticated cannot allocate candidature ids');

select is(has_table_privilege('service_role', 'public.task_candidates', 'SELECT'), true,
  'service_role can read the candidate queue directly ahead of #319 (no server job writes it)');
select is(has_table_privilege('service_role', 'public.task_candidates', 'INSERT'), false,
  'service_role cannot insert directly — #330/#333''s commands run as the table owner, not service_role');
select is(has_table_privilege('service_role', 'public.task_candidates', 'UPDATE'), false,
  'service_role cannot update the candidate queue directly');
select is(has_table_privilege('service_role', 'public.task_candidates', 'DELETE'), false,
  'service_role cannot delete from the candidate queue directly');
select is(has_table_privilege('service_role', 'public.task_candidates', 'TRUNCATE'), false,
  'service_role cannot truncate the candidate queue');
select is(has_sequence_privilege('service_role', 'public.task_candidates_id_seq', 'usage'), false,
  'service_role never allocates a candidature id — it only ever reads (SELECT-only)');

select * from finish();
rollback;
