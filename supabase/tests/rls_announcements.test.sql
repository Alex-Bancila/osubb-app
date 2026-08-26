-- rls_announcements.test.sql — Epic 3.5a policies, per-role.
-- Part of the Epic 6.1 per-role suite (#67).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ==================== Login simulation ====================
create function pg_temp.login(uid uuid, r text, lvl int, depts jsonb, tms jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid, 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', r, 'member_level', lvl,
      'dept_ids', depts, 'team_ids', tms))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ==================== Fixtures ====================
-- The demo seed fills these tables; the counts below are about this file's
-- rows. Cleared inside the transaction, which rolls back.
truncate announcements, announcement_reads cascade;

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'ana.ann@test.local'),
  ('f2000000-0000-0000-0000-0000000000f2', 'radu.resp@test.local');
insert into profiles (id, full_name, email, role) values
  ('f1000000-0000-0000-0000-0000000000f1', 'Ana Voluntar',    'ana.ann@test.local',  'voluntar'),
  ('f2000000-0000-0000-0000-0000000000f2', 'Radu Responsabil', 'radu.resp@test.local', 'responsabil');
insert into member_departments (member_id, dept_id) values
  ('f1000000-0000-0000-0000-0000000000f1', 'edu'),
  ('f2000000-0000-0000-0000-0000000000f2', 'edu');

insert into announcements (title, body, priority, pinned)
  values ('Ședință extraordinară', 'Vineri, ora 18.', 'critical', true);
insert into announcements (title, body, dept_id)
  values ('Materiale PR', 'În drive.', 'pr');

-- ==================== A voluntar: reads everything, posts nothing ====================
select pg_temp.login('f1000000-0000-0000-0000-0000000000f1', 'voluntar', 1, '["edu"]', '[]');

select is((select count(*) from announcements), 2::bigint,
  'a member reads the whole feed, including other departments'' posts');

select throws_ok(
  $$ insert into announcements (title, body) values ('Anunț neautorizat', 'Nu.') $$,
  '42501', null, 'a voluntar cannot post announcements');

update announcements set title = 'Titlu schimbat' where title = 'Materiale PR';
select is((select count(*) from announcements where title = 'Titlu schimbat'), 0::bigint,
  'a voluntar cannot edit announcements (silent no-op — no write policy matches)');

-- Read receipts: mine only.
select lives_ok(
  $$ insert into announcement_reads (announcement_id, member_id)
     select id, 'f1000000-0000-0000-0000-0000000000f1'::uuid
       from announcements where title = 'Ședință extraordinară' $$,
  'a member marks an announcement as read for themselves');

select throws_ok(
  $$ insert into announcement_reads (announcement_id, member_id)
     select id, 'f2000000-0000-0000-0000-0000000000f2'::uuid
       from announcements where title = 'Ședință extraordinară' $$,
  '42501', null, 'a member cannot mark an announcement read for someone else');

select is((select count(*) from announcement_reads), 1::bigint,
  'a member sees only their own read receipts');

reset role;

-- ==================== A responsabil: posts and edits ====================
select pg_temp.login('f2000000-0000-0000-0000-0000000000f2', 'responsabil', 4, '["edu"]', '[]');

select lives_ok(
  $$ insert into announcements (title, body, priority, created_by)
     values ('Deadline proiect', 'Marți.', 'important',
             'f2000000-0000-0000-0000-0000000000f2') $$,
  'level >= 4 posts announcements');

update announcements set pinned = true where title = 'Deadline proiect';
select is((select pinned from announcements where title = 'Deadline proiect'), true,
  'level >= 4 edits announcements');

select is((select count(*) from announcement_reads), 0::bigint,
  'read receipts stay private even at level 4');

reset role;

-- ==================== A deactivated member: real uid, no org claims ====================
-- A deactivated member can keep a valid auth uid until their JWT expires, but the
-- access-token hook removes all organisation claims. This is different from the
-- claimless block below: auth.uid() is real, so a self-only policy is insufficient.
insert into announcements (title, body)
  values ('Anunț de securitate', 'Fixture pentru politica de read receipts.');
insert into announcement_reads (announcement_id, member_id, read_at)
  select id, 'f1000000-0000-0000-0000-0000000000f1'::uuid, '2000-01-01 00:00:00+00'
    from announcements where title = 'Materiale PR';
update announcement_reads
   set read_at = '2000-01-01 00:00:00+00'
 where announcement_id = (
   select id from announcements where title = 'Ședință extraordinară'
 );

create temp table receipt_fx as
select
  (select id from announcements where title = 'Ședință extraordinară') as update_id,
  (select id from announcements where title = 'Materiale PR') as delete_id,
  (select id from announcements where title = 'Anunț de securitate') as insert_id;
grant select on receipt_fx to authenticated;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f1000000-0000-0000-0000-0000000000f1'::uuid,
  'role', 'authenticated',
  'app_metadata', '{}'::jsonb)::text, true);
set local role authenticated;

select is(auth_is_member(), false,
  'a real uid without organisation claims is not an active member');
select is((select count(*) from announcement_reads), 0::bigint,
  'a deactivated member cannot read their old receipts');
select throws_ok(
  format($$ insert into announcement_reads (announcement_id, member_id)
            values (%s, 'f1000000-0000-0000-0000-0000000000f1') $$,
         (select insert_id from receipt_fx)),
  '42501', null, 'a deactivated member cannot create a receipt');

update announcement_reads
   set read_at = '2001-01-01 00:00:00+00'
 where announcement_id = (select update_id from receipt_fx);
delete from announcement_reads
 where announcement_id = (select delete_id from receipt_fx);

reset role;

select is(
  (select read_at from announcement_reads
    where announcement_id = (select update_id from receipt_fx)),
  '2000-01-01 00:00:00+00'::timestamptz,
  'a deactivated member cannot update an old receipt');
select ok(
  exists (select 1 from announcement_reads
           where announcement_id = (select delete_id from receipt_fx)),
  'a deactivated member cannot delete an old receipt');
select ok(
  not exists (select 1 from announcement_reads
               where announcement_id = (select insert_id from receipt_fx)),
  'the denied insert leaves no receipt behind');

-- ==================== The stranger: authenticated without claims ====================
-- `reset role` keeps the previous login's JWT, so clear it explicitly —
-- otherwise these assertions run as the responsabil and pass for free.
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select is((select count(*) from announcements), 0::bigint,
  'a claimless session reads no announcements (ADR-0003 gate 2)');
select is((select count(*) from announcement_reads), 0::bigint,
  'a claimless session reads no receipts');
select throws_ok(
  $$ insert into announcements (title, body) values ('Spam', 'Nu.') $$,
  '42501', null, 'a claimless session cannot post');

reset role;

-- ==================== anon ====================
set local role anon;
select throws_ok(
  $$ select count(*) from announcements $$,
  '42501', null, 'anon has no access at all');
reset role;

select * from finish();
rollback;
