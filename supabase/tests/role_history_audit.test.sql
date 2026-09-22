-- #50: audit ownership, immutable history, and attributed voting decisions.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(24);
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000001', 'history50-1@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000001', 'History Member 1', 'history50-1@test.local', 'voluntar', 'activ');
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000002', 'history50-2@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000002', 'History Member 2', 'history50-2@test.local', 'voluntar', 'activ');
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000003', 'history50-3@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000003', 'History Member 3', 'history50-3@test.local', 'bc', 'activ');
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000004', 'history50-4@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000004', 'History Member 4', 'history50-4@test.local', 'bce', 'activ');
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000005', 'history50-5@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000005', 'History Member 5', 'history50-5@test.local', 'moderator', 'activ');
insert into auth.users (id, email) values ('05000000-0050-0000-0000-000000000006', 'history50-6@test.local');
insert into profiles (id, full_name, email, role, status) values ('05000000-0050-0000-0000-000000000006', 'History Member 6', 'history50-6@test.local', 'bc', 'inactiv');
insert into role_history (member_id, from_role, to_role, actor_kind, changed_by, reason) values
  ('05000000-0050-0000-0000-000000000001', 'recrut', 'voluntar', 'automatic', null, 'Tenure reached'),
  ('05000000-0050-0000-0000-000000000002', 'activ', 'vot', 'human', '05000000-0050-0000-0000-000000000003', 'BC confirms adherence'),
  ('05000000-0050-0000-0000-000000000002', 'vot', 'activ', 'human', '05000000-0050-0000-0000-000000000003', 'BC confirms withdrawal');
select ok((select relrowsecurity from pg_class where oid = 'public.role_history'::regclass), 'History has RLS');
select is((select count(*) from role_history where actor_kind = 'automatic' and changed_by is null), 1::bigint, 'Automatic promotion has explicit system marker');
select is((select count(*) from role_history where to_role = 'vot' and changed_by = '05000000-0050-0000-0000-000000000003'), 1::bigint, 'BC voting confirmation names its actor exactly once');
select is((select count(*) from role_history where from_role = 'vot' and changed_by = '05000000-0050-0000-0000-000000000003'), 1::bigint, 'BC voting withdrawal names its actor exactly once');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, reason) values ('05000000-0050-0000-0000-000000000001', 'activ', 'vot', 'automatic', 'Forged automation')$$, '23514', 'voting_role_requires_bc_actor', 'Voting confirmation cannot be automatic');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, reason) values ('05000000-0050-0000-0000-000000000001', 'vot', 'activ', 'automatic', 'Forged automation')$$, '23514', 'voting_role_requires_bc_actor', 'Voting withdrawal cannot be automatic');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, changed_by, reason) values ('05000000-0050-0000-0000-000000000001', 'activ', 'vot', 'human', '05000000-0050-0000-0000-000000000004', 'Forged authority')$$, '23514', 'voting_role_requires_bc_actor', 'BCE cannot be recorded as the voting decision maker');
select throws_ok($$update role_history set reason = 'Rewritten'$$, '23514', 'role_history_immutable', 'Even trusted writers cannot rewrite history');
select throws_ok($$delete from role_history$$, '23514', 'role_history_immutable', 'Even trusted writers cannot delete history');
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000001');
select is((select count(*) from role_history), 1::bigint, 'Member visibility');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000003');
select is((select count(*) from role_history), 3::bigint, 'BC visibility');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000004');
select is((select count(*) from role_history), 0::bigint, 'BCE visibility');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000005');
select is((select count(*) from role_history), 3::bigint, 'Moderator visibility');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000006');
select is((select count(*) from role_history), 0::bigint, 'Inactive BC with stale claims visibility');
reset role;
select pg_temp.test_login('05000000-0050-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from role_history), 0::bigint, 'Claimless owner sees nothing');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000003');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, reason) values (auth.uid(), 'recrut', 'voluntar', 'automatic', 'Forged')$$, '42501', null, 'BC client cannot forge an insert');
select throws_ok($$update role_history set reason = 'Forged'$$, '42501', null, 'BC client cannot update');
select throws_ok($$delete from role_history$$, '42501', null, 'BC client cannot delete');
reset role;
select pg_temp.test_login_leadership('05000000-0050-0000-0000-000000000001');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, reason) values (auth.uid(), 'recrut', 'voluntar', 'automatic', 'Forged')$$, '42501', null, 'Member client cannot forge an insert');
select throws_ok($$update role_history set reason = 'Forged'$$, '42501', null, 'Member client cannot update');
select throws_ok($$delete from role_history$$, '42501', null, 'Member client cannot delete');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$select * from role_history$$, '42501', null, 'Anonymous cannot read history');
select throws_ok($$insert into role_history (member_id, from_role, to_role, actor_kind, reason) values ('05000000-0050-0000-0000-000000000001', 'recrut', 'voluntar', 'automatic', 'Forged')$$, '42501', null, 'Anonymous cannot insert');
select throws_ok($$delete from role_history$$, '42501', null, 'Anonymous cannot delete');
reset role;
select * from finish();
rollback;
