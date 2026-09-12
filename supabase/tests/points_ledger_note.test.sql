-- points_ledger_note.test.sql — #161: points_ledger.note carries the written
-- reason for a ledger entry (required for sanctions from #162 on; optional
-- otherwise) beside the immutable points delta.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000161', 'ana.ledgernote@test.local');

insert into profiles (id, full_name, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000161', 'Ana Test', 'ana.ledgernote@test.local', 'voluntar');

-- A graded Task, its Assignment and its Evaluation, so a 'task' row (the
-- shape #162 keeps note-optional for) can be inserted below. #162 requires:
-- reason in ('task','task_reversal','sanction'); (reason in
-- ('task','task_reversal')) = (task_id is not null); and sanctions need
-- delta < 0 plus a non-blank note. #317 additionally requires a task row to
-- name the Evaluation that produced it. A 'task' row with no note stays
-- legal throughout, so it — not a sanction — is what proves the column is
-- nullable.
insert into tasks (title, difficulty, rating, status, completed_at, dept_id)
  values ('ledger-note-fixture-161', 3, 4, 'completed', now(), 'edu');

insert into task_assignments (task_id, member_id, ended_at, end_reason)
  select id, 'aaaaaaaa-0000-0000-0000-000000000161', completed_at, 'completed'
    from tasks where title = 'ledger-note-fixture-161';

insert into task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'aaaaaaaa-0000-0000-0000-000000000161',
         'completed', task.difficulty, task.rating,
         task.difficulty * rating_mult(task.rating), 'note fixture evaluation'
    from tasks task
    join task_assignments assignment on assignment.task_id = task.id
   where task.title = 'ledger-note-fixture-161';

-- A pre-existing-style row with no note — the shape every 'task' row had
-- before this column existed, and still a legal row today since the column
-- is nullable (task rows need a task_id and an Evaluation, not a note).
insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
  select 'aaaaaaaa-0000-0000-0000-000000000161', evaluation.points, 'task',
         evaluation.task_id, evaluation.id
    from task_evaluations evaluation
    join tasks task on task.id = evaluation.task_id
   where task.title = 'ledger-note-fixture-161';

select is(
  (select sum(delta) from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000161'),
  6::bigint, 'baseline total before any note-bearing row exists');

-- ==================== Column shape ====================
select has_column('public', 'points_ledger', 'note', 'points_ledger has a note column');
select col_type_is('public', 'points_ledger', 'note', 'text', 'note is text');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'points_ledger' and column_name = 'note'),
  'YES', 'note is nullable (required-for-sanctions lands in #162)');

-- ==================== A sanction round-trips its note ====================
-- Negative delta + a present note, matching what #162 will require going
-- forward — written now so that task does not have to fix this fixture up.
insert into points_ledger (member_id, delta, reason, note)
  values ('aaaaaaaa-0000-0000-0000-000000000161', -2, 'sanction', 'întârziere repetată');

select is(
  (select note from points_ledger
    where member_id = 'aaaaaaaa-0000-0000-0000-000000000161' and delta = -2),
  'întârziere repetată', 'a sanction''s note round-trips exactly');

-- The row without a note (inserted above, before the column was ever used)
-- must still be there, untouched, proving note-less rows keep inserting fine.
select is(
  (select count(*) from points_ledger
    where member_id = 'aaaaaaaa-0000-0000-0000-000000000161' and note is null),
  1::bigint, 'the earlier note-less row still inserted and reads back with note null');

-- ==================== Totals are unaffected by the note column ====================
select is(
  (select sum(delta) from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000161'),
  4::bigint,
  'sum(delta) tracks only deltas — the note column changes nothing (6 - 2)');

select * from finish();
rollback;
