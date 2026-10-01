-- promotion_candidates.test.sql -- #826 (ruling R28): the Promotion Candidate
-- list -- its shape, who reads it, public.reject_promotion_candidate, and the
-- role_history trigger that closes a candidate when the Member leaves Voluntar.
--
-- A Promotion Candidate is never promoted automatically: BC promotes by hand
-- through set_member_role (#105), whose role_history row closes the candidate
-- as `promoted`; any other way off Voluntar closes it as `superseded`. A
-- rejection holds for its run only (role_evaluation_command.test.sql shows
-- the Member coming back at a later run).
--
-- Fixtures (prefix 82610000-), written as the owner in this rolled-back
-- transaction: a Role Evaluation row and candidate rows inserted directly --
-- run_role_evaluation's own writes are role_evaluation_command.test.sql's.
--
-- Mutation guards, run 2026-09-27 as in-transaction redefinitions, each
-- turning the named assertion red:
--   * the trigger body's update removed -> "promoting a candidate through
--     set_member_role marks the row promoted";
--   * `v_to_level > v_from_level` inverted -> the same assertion and "a
--     candidate moved down to Recrut is superseded";
--   * the reject command's state check removed -> "rejecting a decided
--     candidate is promotion_candidate_decided" (the second rejection
--     silently rewrites the first one).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(40);

-- ==================== Fixtures ====================

insert into auth.users (id, email)
select ('82610000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-8261@test.local'
  from unnest(array['01', '02', '03', '04', '05', '11', '12', '13', '14', '15']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('82610000-0000-0000-0000-000000000001', 'BC 8261',         'm01-8261@test.local', 'bc',        'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000002', 'Moderator 8261',  'm02-8261@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000003', 'BCE 8261',        'm03-8261@test.local', 'bce',       'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000004', 'Activ 8261',      'm04-8261@test.local', 'activ',     'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000005', 'BC inactiv 8261', 'm05-8261@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('82610000-0000-0000-0000-000000000011', 'Cand Unu',        'm11-8261@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000012', 'Cand Doi',        'm12-8261@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000013', 'Cand Trei',       'm13-8261@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000014', 'Cand Patru',      'm14-8261@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82610000-0000-0000-0000-000000000015', 'Cand Inactiv',    'm15-8261@test.local', 'voluntar',  'inactiv', '2000-01-01');

insert into public.role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
values ('voluntar_activ', 'Evaluare 8261', '2026-01-01', '2026-06-30', '82610000-0000-0000-0000-000000000001', 20, 5);

insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
select run.id, member.id, 30, '2000-07-01', 20
  from public.role_evaluations as run,
       unnest(array['82610000-0000-0000-0000-000000000011', '82610000-0000-0000-0000-000000000012',
                    '82610000-0000-0000-0000-000000000013', '82610000-0000-0000-0000-000000000014',
                    '82610000-0000-0000-0000-000000000015']::uuid[]) as member (id)
 where run.name = 'Evaluare 8261';

create temp table fx8261 as
  select (select id from public.role_evaluations where name = 'Evaluare 8261') as run,
         (select id from public.promotion_candidates where member_id = '82610000-0000-0000-0000-000000000011') as c11,
         (select id from public.promotion_candidates where member_id = '82610000-0000-0000-0000-000000000012') as c12,
         (select id from public.promotion_candidates where member_id = '82610000-0000-0000-0000-000000000013') as c13,
         (select id from public.promotion_candidates where member_id = '82610000-0000-0000-0000-000000000014') as c14,
         (select count(*) from public.promotion_candidates) as all_rows;
grant select on fx8261 to authenticated, anon;

-- ==================== 1. Shape ====================

select has_table('public', 'promotion_candidates', 'public.promotion_candidates exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.promotion_candidates'::regclass),
  true, 'RLS is enabled on promotion_candidates');
select throws_ok(
  $$ insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
     select run, '82610000-0000-0000-0000-000000000011', 1, '2000-07-01', 20 from fx8261 $$,
  '23505', 'duplicate key value violates unique constraint "promotion_candidates_role_evaluation_id_member_id_key"',
  'a Member is listed once per Role Evaluation');
insert into public.role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
values ('voluntar_activ', 'Evaluare 8261 bis', '2026-01-01', '2026-06-30', '82610000-0000-0000-0000-000000000001', 20, 5);
select throws_ok(
  $$ insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
     select id, '82610000-0000-0000-0000-000000000011', 1, '2000-07-01', 20
       from public.role_evaluations where name = 'Evaluare 8261 bis' $$,
  '23505', 'duplicate key value violates unique constraint "promotion_candidates_open_member_uidx"',
  'a Member has at most one undecided candidate row across runs');
select throws_ok(
  $$ update public.promotion_candidates set decision = 'superseded' where id = (select c11 from fx8261) $$,
  '23514', 'new row for relation "promotion_candidates" violates check constraint "promotion_candidates_decision_shape_ck"',
  'a decision carries its instant');
select throws_ok(
  $$ update public.promotion_candidates
        set decision = 'rejected', decided_at = now(), decided_by = '82610000-0000-0000-0000-000000000001'
      where id = (select c11 from fx8261) $$,
  '23514', 'new row for relation "promotion_candidates" violates check constraint "promotion_candidates_reason_shape_ck"',
  'a rejection says why');
select throws_ok(
  $$ update public.promotion_candidates
        set decision = 'rejected', decided_at = now(), reason = 'Motiv'
      where id = (select c11 from fx8261) $$,
  '23514', 'new row for relation "promotion_candidates" violates check constraint "promotion_candidates_rejected_by_ck"',
  'a rejection names who rejected');
select throws_ok(
  $$ update public.promotion_candidates
        set decision = 'superseded', decided_at = now(), reason = 'Motiv'
      where id = (select c11 from fx8261) $$,
  '23514', 'new row for relation "promotion_candidates" violates check constraint "promotion_candidates_reason_shape_ck"',
  'only a rejection carries a reason');
select throws_ok(
  $$ update public.promotion_candidates set decision = 'accepted', decided_at = now()
      where id = (select c11 from fx8261) $$,
  '23514', 'new row for relation "promotion_candidates" violates check constraint "promotion_candidates_decision_ck"',
  'decision is promoted, rejected or superseded');

-- ==================== 2. Grants and who reads ====================

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'promotion_candidates' and grantee = 'authenticated'),
  'SELECT', 'authenticated reads promotion_candidates and writes nothing directly');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'promotion_candidates' and grantee = 'anon'),
  0::bigint, 'anon has no privilege on promotion_candidates');

select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select is((select count(*) from public.promotion_candidates), (select all_rows from fx8261),
  'BC reads every Promotion Candidate');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000002');
select is((select count(*) from public.promotion_candidates), (select all_rows from fx8261),
  'the Moderator reads every Promotion Candidate');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000011');
select is((select array_agg(member_id) from public.promotion_candidates),
  array['82610000-0000-0000-0000-000000000011'::uuid],
  'a candidate reads their own row only');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000003');
select is((select count(*) from public.promotion_candidates), 0::bigint,
  'a BCE who is not a candidate reads nothing');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000005');
select is((select count(*) from public.promotion_candidates), 0::bigint,
  'a deactivated BC''s still-valid token reads nothing');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000015');
select is((select count(*) from public.promotion_candidates), 0::bigint,
  'a deactivated candidate''s token does not read their own row either');
reset role;
select pg_temp.test_login('82610000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select is((select count(*) from public.promotion_candidates), 0::bigint,
  'a claimless session reads nothing, though its uid is a live BC');
reset role;
select pg_temp.test_clear_jwt();

-- ==================== 3. reject_promotion_candidate ====================

select function_returns('public', 'reject_promotion_candidate', array['bigint', 'text'], 'promotion_candidates',
  'public.reject_promotion_candidate(p_candidate_id, p_reason) returns the candidate row');
select is(
  (select count(*) from unnest(array['public.reject_promotion_candidate(bigint, text)',
                                     'private.reject_promotion_candidate_impl(bigint, text)']) as fn,
                        unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint, 'anon, service_role and PUBLIC execute neither the wrapper nor its _impl');

-- Step 1, before the gate: a claimless session hears PT400.
select pg_temp.test_login('82610000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.reject_promotion_candidate(%s, E' \t') $$, (select c11 from fx8261)),
  'PT400', 'invalid_rejection_reason', 'a blank reason is invalid_rejection_reason, before the gate');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, null) $$, (select c11 from fx8261)),
  'PT400', 'invalid_rejection_reason', 'a null reason is invalid_rejection_reason');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, repeat('r', 501)) $$, (select c11 from fx8261)),
  'PT400', 'reason_too_long', 'a 501-character reason is reason_too_long');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, 'Motiv') $$, (select c11 from fx8261)),
  '42501', 'promotion_candidate_manage_forbidden', 'a claimless session cannot reject, though its uid is a live BC');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, 'Motiv') $$, (select c11 from fx8261)),
  '42501', 'promotion_candidate_manage_forbidden', 'a BCE cannot reject a candidate');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000011');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, 'Motiv') $$, (select c11 from fx8261)),
  '42501', 'promotion_candidate_manage_forbidden', 'a candidate cannot reject themselves');
reset role;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000005');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, 'Motiv') $$, (select c11 from fx8261)),
  '42501', 'promotion_candidate_manage_forbidden', 'a deactivated BC''s token cannot reject');
reset role;

create temp table notif8261 as select count(*) as n from public.notifications;
grant select on notif8261 to authenticated;
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select throws_ok($$ select public.reject_promotion_candidate(-1, 'Motiv') $$,
  'PT404', 'promotion_candidate_not_found', 'an unknown candidate is promotion_candidate_not_found');
select results_eq(
  format($$ select decision, decided_by, reason, decided_at = now()
              from public.reject_promotion_candidate(%s, E'  Încă nu\t') $$, (select c11 from fx8261)),
  $$ values ('rejected', '82610000-0000-0000-0000-000000000001'::uuid, 'Încă nu', true) $$,
  'BC rejects a candidate: decision rejected, the actor, the trimmed reason, now()');
select throws_ok(format($$ select public.reject_promotion_candidate(%s, 'Din nou') $$, (select c11 from fx8261)),
  'PT409', 'promotion_candidate_decided', 'rejecting a decided candidate is promotion_candidate_decided');
reset role;
select is((select count(*) from public.notifications), (select n from notif8261),
  'a rejection sends no Notification');

-- ==================== 4. The role_history trigger ====================

update public.org_settings set value = 'https://forms.example.org/adeziune' where key = 'adherence_form_url';

select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_member_role('82610000-0000-0000-0000-000000000012', 'activ', 'Evaluarea de rol „Evaluare 8261”') $$,
  'BC promotes a candidate to Voluntar Activ in the Role panel');
reset role;
select results_eq(
  format($$ select decision, decided_by, decided_at = now(), reason
              from public.promotion_candidates where id = %s $$, (select c12 from fx8261)),
  $$ values ('promoted', '82610000-0000-0000-0000-000000000001'::uuid, true, null::text) $$,
  'promoting a candidate through set_member_role marks the row promoted, decided by the BC who changed the Role');
select is(
  (select body from public.notifications
    where member_id = '82610000-0000-0000-0000-000000000012' and title = 'Rol actualizat'),
  'Rolul tău în OSUBB este acum Voluntar Activ. Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. Completează formularul de adeziune: https://forms.example.org/adeziune',
  'the manual promotion to Voluntar Activ carries AG Eligibility and the adherence form address, read at write time');

select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_member_role('82610000-0000-0000-0000-000000000013', 'recrut') $$,
  'BC moves another candidate down to Recrut');
reset role;
select is(
  (select decision from public.promotion_candidates where id = (select c13 from fx8261)),
  'superseded', 'a candidate moved down to Recrut is superseded');

select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_member_role('82610000-0000-0000-0000-000000000011', 'activ') $$,
  'BC promotes the Member whose candidacy was rejected');
reset role;
select results_eq(
  $$ select member_id, decision from public.promotion_candidates
      where role_evaluation_id = (select run from fx8261)
        and member_id in ('82610000-0000-0000-0000-000000000011', '82610000-0000-0000-0000-000000000014')
      order by member_id $$,
  $$ values ('82610000-0000-0000-0000-000000000011'::uuid, 'rejected'),
            ('82610000-0000-0000-0000-000000000014'::uuid, null) $$,
  'a decided row is left as it was, and another Member''s open row is untouched');

-- A role_history row that does not leave Voluntar closes nothing.
select pg_temp.test_login_leadership('82610000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_member_role('82610000-0000-0000-0000-000000000004', 'vot') $$,
  'BC grants Drept de Vot to a Voluntar Activ');
reset role;
select is(
  (select decision from public.promotion_candidates where id = (select c14 from fx8261)),
  null, 'a role change that does not leave Voluntar closes no candidate');

select * from finish();
rollback;
