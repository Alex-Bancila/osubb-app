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

-- A task fixture so a 'task' row (the shape #162 keeps note-optional for) can
-- be inserted below. #162 will require: reason in ('task','task_reversal',
-- 'sanction'); (reason in ('task','task_reversal')) = (task_id is not null);
-- and sanctions need delta < 0 plus a non-blank note. A 'task' row with no
-- note stays legal after that migration, so it — not a sanction — is what
-- proves the column is nullable.
insert into tasks (title, difficulty, dept_id)
  values ('ledger-note-fixture-161', 3, 'edu');

-- A pre-existing-style row with no note — the shape every 'task' row had
-- before this column existed, and still a legal row today since the column
-- is nullable, and will remain legal under #162 (task rows need a task_id,
-- not a note).
insert into points_ledger (member_id, delta, reason, task_id)
  select 'aaaaaaaa-0000-0000-0000-000000000161', 6, 'task', id
    from tasks where title = 'ledger-note-fixture-161';

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
