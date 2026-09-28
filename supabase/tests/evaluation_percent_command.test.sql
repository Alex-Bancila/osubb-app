-- evaluation_percent_command.test.sql -- #866 (ruling R30):
-- public.set_evaluation_percent(p_kind, p_percent) over
-- private.set_evaluation_percent_impl -- BC or the Moderator sets the top
-- share of one Role Evaluation kind (x, the top_percent rule's percent, for
-- voluntar_activ; y, org_settings.vote_retention_percent, for
-- adunarea_generala), every change logged in promotion_threshold_changes
-- (field percent); public.evaluation_percents(), the Praguri read; and
-- set_org_setting no longer writing y.
--
-- In order: a held-lock probe of (47, 1), first -- before this transaction
-- takes the lock or writes a row the remote session would then wait on
-- (which would make the probe pass without the advisory lock); the
-- functions and their privileges; the value, answered before the gate; the
-- gate (claimless, Voluntar, BCE, deactivated BC, anon); BC's and the
-- Moderator's writes, read back and audited; PT409 nothing_to_update; the
-- log's percent shape; the read for a Member below BC; set_org_setting's
-- refusal; a Role Evaluation of each kind after a change computing its
-- threshold from the new share.
--
-- Fixtures (prefix 86600000-), written as the owner inside this rolled-back
-- transaction. Every live active ladder holder the demo seed brings is
-- deactivated, so each run meets only this suite's Members. The Evaluation
-- Period is [today - 30, today - 1] in Bucharest days; every award is two
-- days ago, inside it.
--   A1 activ 25, A2 activ 15, A3 activ 5
--     x = 30 % of 3 -> share 1 -> computed 25; x = 100 % -> share 3 -> 5
--   G1 vot 12, G2 vot 3
--     y = 25 % of 2 -> share 1 -> computed 12; y = 100 % -> share 2 -> 3
--
-- Mutation guards (run 2026-09-28 as in-transaction redefinitions of
-- private.set_evaluation_percent_impl, reverted after), each turning the
-- named assertion red:
--   * the bounds check narrowed to null only -> "0 is invalid_percent" and
--     "101 is invalid_percent, before the gate";
--   * the level-6 gate dropped -> "a BCE cannot set a share";
--   * the promotion_rules update removed -> "a Voluntar Activ run after x
--     moved to 100 % computes 5" (it computes 25);
--   * the org_settings update removed -> "an Adunarea Generală run after y
--     moved to 100 % computes 3" (it computes 12);
--   * the audit insert removed -> "BC's change of x writes one percent row";
--   * set_org_setting_impl's vote_retention_percent refusal removed -> "set_org_setting
--     no longer changes y".
--   (The held-lock probe runs in a remote session, which sees only committed
--   code, so it was not run as a mutation: without the (47, 1) call the
--   remote change meets no held lock and completes, so the probe
--   discriminates.)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(47);

-- ==================== 1. The lock ====================

select extensions.dblink_connect('ep_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ep_setup', 'set lock_timeout = ''2s''');
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('ep_setup', $$
  delete from public.profiles where id = '86600000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '86600000-0000-0000-0000-0000000000f1';
  insert into auth.users (id, email) values
    ('86600000-0000-0000-0000-0000000000f1', 'race.bc.866@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('86600000-0000-0000-0000-0000000000f1', 'Race BC 866', 'race.bc.866@test.local', 'bc', 'activ');
$$);

select pg_temp.test_login_leadership('86600000-0000-0000-0000-0000000000f1');

select extensions.dblink_connect('ep_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_connect('ep_retry', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ep_lock', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('ep_retry', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('ep_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(47, 1); end $lock$;');
select extensions.dblink_exec('ep_retry', format(
  'begin; set local lock_timeout = ''250ms''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select throws_ok(
  $$ select * from extensions.dblink('ep_retry', 'select (public.set_evaluation_percent(''voluntar_activ'', 55)).id::text')
       as result (id text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a share change waits on the (47, 1) advisory lock a run_role_evaluation call or a threshold edit holds');
select extensions.dblink_exec('ep_retry', 'rollback;');
select extensions.dblink_exec('ep_lock', 'rollback;');
select extensions.dblink_disconnect('ep_retry');
select extensions.dblink_disconnect('ep_lock');

select extensions.dblink_exec('ep_setup', $$
  delete from public.profiles where id = '86600000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '86600000-0000-0000-0000-0000000000f1';
$$);
select extensions.dblink_disconnect('ep_setup');

reset role;
select pg_temp.test_clear_jwt();

-- ==================== 2. The functions and their privileges ====================

select is(
  (select t.typname from pg_proc p join pg_type t on t.oid = p.prorettype
    where p.oid = 'public.set_evaluation_percent(text, integer)'::regprocedure),
  'promotion_threshold_changes',
  'public.set_evaluation_percent(p_kind text, p_percent integer) returns the promotion_threshold_changes row it wrote');

create temp table fns866 (fn text);
insert into fns866 values
  ('public.set_evaluation_percent(text, integer)'),
  ('private.set_evaluation_percent_impl(text, integer)'),
  ('public.evaluation_percents()');

select is(
  (select count(*) from fns866, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute neither the command, its _impl nor the read');
select is(
  (select count(*) from fns866 where has_function_privilege('authenticated', fn, 'execute')),
  3::bigint,
  'authenticated executes the wrapper, its _impl (called as the caller) and the read');
select results_eq(
  $$ select prosecdef from pg_proc
      where oid in ('private.set_evaluation_percent_impl(text, integer)'::regprocedure,
                    'public.set_evaluation_percent(text, integer)'::regprocedure,
                    'public.evaluation_percents()'::regprocedure)
      order by oid::regprocedure::text $$,
  $$ values (false), (true), (false) $$,
  'the _impl is security definer; the wrapper and the read (evaluation_percents, set_evaluation_percent) are security invoker');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '86600000-%';

update public.promotion_rules set percent = 30 where kind = 'top_percent';
update public.org_settings set value = '25', updated_by = null where key = 'vote_retention_percent';
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';
update public.promotion_thresholds set threshold = 10 where kind = 'adunarea_generala';
delete from public.promotion_threshold_changes where field = 'percent';

insert into auth.users (id, email)
select ('86600000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-866@test.local'
  from unnest(array['01', '02', '03', '04', '05', '21', '22', '23', '31', '32']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('86600000-0000-0000-0000-000000000001', 'BC 866',         'm01-866@test.local', 'bc',        'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000002', 'Moderator 866',  'm02-866@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000003', 'BCE 866',        'm03-866@test.local', 'bce',       'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000004', 'Voluntar 866',   'm04-866@test.local', 'voluntar',  'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('86600000-0000-0000-0000-000000000005', 'BC inactiv 866', 'm05-866@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('86600000-0000-0000-0000-000000000021', 'Activ Unu 866',  'm21-866@test.local', 'activ',     'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000022', 'Activ Doi 866',  'm22-866@test.local', 'activ',     'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000023', 'Activ Trei 866', 'm23-866@test.local', 'activ',     'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000031', 'Vot Unu 866',    'm31-866@test.local', 'vot',       'activ',   '2000-01-01'),
  ('86600000-0000-0000-0000-000000000032', 'Vot Doi 866',    'm32-866@test.local', 'vot',       'activ',   '2000-01-01');

insert into public.groups (name, category, min_level) values ('Grup Procente 866', 'department', 0);

-- Credits p Task Points two days ago: one Task per 15 points (difficulty 5,
-- rating 5), then 5s (difficulty 5, rating 3 -> x1), then the rest -- as
-- role_evaluation_command.test.sql credits them.
create function pg_temp.credit866(p_member uuid, p_points int, p_at timestamptz default now() - interval '2 days')
returns void language plpgsql as $$
declare
  v_left int := p_points;
  v_d int;
  v_r int;
  v_task bigint;
begin
  while v_left > 0 loop
    if v_left >= 15 then v_d := 5; v_r := 5; v_left := v_left - 15;
    elsif v_left >= 5 then v_d := 5; v_r := 3; v_left := v_left - 5;
    else v_d := v_left; v_r := 3; v_left := 0;
    end if;
    insert into public.tasks
      (title, description, deadline, group_id, status, difficulty, rating,
       created_by, created_at, completed_at)
    values ('Credit #866 ' || gen_random_uuid(), 'Fixture', p_at,
            (select id from public.groups where name = 'Grup Procente 866'),
            'completed', v_d, v_r, '86600000-0000-0000-0000-000000000001',
            p_at - interval '1 day', p_at)
    returning id into v_task;
    insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
    values (v_task, p_member, p_at - interval '1 day', p_at, 'completed');
    perform pg_temp.test_credit_task(v_task, p_member, '86600000-0000-0000-0000-000000000001',
                                     p_awarded_at => p_at);
  end loop;
end $$;

select pg_temp.credit866('86600000-0000-0000-0000-000000000021', 25);
select pg_temp.credit866('86600000-0000-0000-0000-000000000022', 15);
select pg_temp.credit866('86600000-0000-0000-0000-000000000023', 5);
select pg_temp.credit866('86600000-0000-0000-0000-000000000031', 12);
select pg_temp.credit866('86600000-0000-0000-0000-000000000032', 3);

create temp table fx866 as
  select ((now() at time zone 'Europe/Bucharest')::date - 30) as d_from,
         ((now() at time zone 'Europe/Bucharest')::date - 1)  as d_to;
grant select on fx866 to authenticated;

-- ==================== 3. The value, before the gate ====================
-- A claimless session with a live BC's uid: every malformed call is PT400.

select pg_temp.test_login('86600000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.set_evaluation_percent(null, 40) $$,
  'PT400', 'invalid_role_evaluation_kind', 'a null kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select public.set_evaluation_percent('top_percent', 40) $$,
  'PT400', 'invalid_role_evaluation_kind', 'an unknown kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', null) $$,
  'PT400', 'invalid_percent', 'a null share is invalid_percent, before the gate');
select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 0) $$,
  'PT400', 'invalid_percent', '0 is invalid_percent, before the gate -- a share is at least 1 %');
select throws_ok($$ select public.set_evaluation_percent('adunarea_generala', 101) $$,
  'PT400', 'invalid_percent', '101 is invalid_percent, before the gate -- a share is at most 100 %');

-- ==================== 4. The gate ====================

select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  '42501', 'evaluation_percent_manage_forbidden',
  'a claimless session cannot set a share, though its uid is a live BC');

reset role;
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000004');
select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  '42501', 'evaluation_percent_manage_forbidden', 'a Voluntar cannot set a share');

reset role;
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000003');
select throws_ok($$ select public.set_evaluation_percent('adunarea_generala', 40) $$,
  '42501', 'evaluation_percent_manage_forbidden', 'a BCE cannot set a share');

reset role;
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000005');
select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  '42501', 'evaluation_percent_manage_forbidden', 'a deactivated BC''s token cannot set a share');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  '42501', null, 'anon cannot execute set_evaluation_percent');
reset role;

select results_eq(
  $$ select (select percent from public.promotion_rules where kind = 'top_percent'),
            (select value from public.org_settings where key = 'vote_retention_percent'),
            (select count(*) from public.promotion_threshold_changes where field = 'percent') $$,
  $$ values (30, '25'::text, 0::bigint) $$,
  'every refusal above left x at 30, y at 25 and the log without a percent row');

-- ==================== 5. BC and the Moderator write ====================

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select results_eq(
  $$ select kind, percent, changed_at, changed_by from public.evaluation_percents() $$,
  $$ values ('voluntar_activ'::text, 30, null::timestamptz, null::uuid),
            ('adunarea_generala'::text, 25, null::timestamptz, null::uuid) $$,
  'before any change, evaluation_percents() reads x 30 and y 25, voluntar_activ first, with no last change');
select lives_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  'BC sets x, the Voluntar Activ share, to 40 %');
reset role;

select is((select percent from public.promotion_rules where kind = 'top_percent'), 40,
  'BC''s change of x is the top_percent rule''s percent');
select results_eq(
  $$ select kind, field, from_value, to_value, source, changed_by, role_evaluation_id
      from public.promotion_threshold_changes where field = 'percent' order by id $$,
  $$ values ('voluntar_activ'::text, 'percent'::text, 30, 40, 'manual'::text,
             '86600000-0000-0000-0000-000000000001'::uuid, null::bigint) $$,
  'BC''s change of x writes one percent row: from 30, to 40, source manual, changed_by BC, no Role Evaluation');
select is((select threshold from public.promotion_thresholds where kind = 'voluntar_activ'), 15,
  'changing x leaves the Voluntar Activ threshold in force as it was');

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000002');
select lives_ok($$ select public.set_evaluation_percent('adunarea_generala', 50) $$,
  'the Moderator sets y, the Adunarea Generală share, to 50 %');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'vote_retention_percent' $$,
  $$ values ('50'::text, '86600000-0000-0000-0000-000000000002'::uuid) $$,
  'the Moderator''s change of y is org_settings.vote_retention_percent, updated_by the Moderator');
select results_eq(
  $$ select kind, from_value, to_value, changed_by
      from public.promotion_threshold_changes where field = 'percent' order by id desc limit 1 $$,
  $$ values ('adunarea_generala'::text, 25, 50, '86600000-0000-0000-0000-000000000002'::uuid) $$,
  'the change of y writes its own percent row: from 25, to 50, changed_by the Moderator');

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select results_eq(
  $$ select kind, percent, changed_by from public.evaluation_percents() $$,
  $$ values ('voluntar_activ'::text, 40, '86600000-0000-0000-0000-000000000001'::uuid),
            ('adunarea_generala'::text, 50, '86600000-0000-0000-0000-000000000002'::uuid) $$,
  'BC reads both shares in force and who changed each last');
select is(
  (select count(*) from public.evaluation_percents() where changed_at is null),
  0::bigint, 'each share''s last change carries its instant');

-- ==================== 6. PT409 nothing_to_update ====================

select throws_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$,
  'PT409', 'nothing_to_update', 'the share already in force is nothing_to_update');
select throws_ok($$ select public.set_evaluation_percent('adunarea_generala', 50) $$,
  'PT409', 'nothing_to_update', 'the same for y');
reset role;
select is((select count(*) from public.promotion_threshold_changes where field = 'percent'), 2::bigint,
  'a refused unchanged value writes no log row');

-- ==================== 7. The log's percent shape ====================

insert into public.role_evaluations (
  kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count
) values (
  'voluntar_activ', 'Evaluare fixture #866', '2026-01-01', '2026-01-31',
  '86600000-0000-0000-0000-000000000001', 15, null, 0
);

select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, changed_by)
     values ('voluntar_activ', 'percent', 40, 101, 'manual', '86600000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_percent_shape_ck"',
  'promotion_threshold_changes_percent_shape_ck: a share above 100 cannot be logged');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, role_evaluation_id)
     values ('voluntar_activ', 'percent', 40, 45, 'role_evaluation',
             (select id from public.role_evaluations where name = 'Evaluare fixture #866')) $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_percent_shape_ck"',
  'promotion_threshold_changes_percent_shape_ck: a Role Evaluation never changes a share');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, changed_by)
     values ('voluntar_activ', 'bogus', 40, 45, 'manual', '86600000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_field_ck"',
  'promotion_threshold_changes_field_ck: field is threshold or percent');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'promotion_threshold_changes' and column_name = 'field'),
  '''threshold''::text',
  'field defaults to threshold, so the run''s hand-over and set_promotion_threshold keep writing threshold rows');

-- ==================== 8. The read below BC ====================

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000004');
select results_eq(
  $$ select kind, percent, changed_at, changed_by from public.evaluation_percents() $$,
  $$ values ('voluntar_activ'::text, 40, null::timestamptz, null::uuid),
            ('adunarea_generala'::text, 50, null::timestamptz, null::uuid) $$,
  'a Voluntar reads both shares but not who changed them -- the log stays level >= 6');
reset role;
select pg_temp.test_login('86600000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select is(
  (select count(*) from public.evaluation_percents() where percent is not null),
  0::bigint, 'a claimless session reads no share (house rule 12)');
reset role;

-- ==================== 9. set_org_setting no longer writes y ====================

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select throws_ok($$ select public.set_org_setting('vote_retention_percent', '30') $$,
  'PT400', 'org_setting_not_settable',
  'set_org_setting no longer changes y: a valid share is refused, set_evaluation_percent is the one write path');
reset role;
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000004');
select throws_ok($$ select public.set_org_setting('vote_retention_percent', '30') $$,
  'PT400', 'org_setting_not_settable', 'the refusal is step 1, the same for a Voluntar');
reset role;
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/r30') $$,
  'set_org_setting still sets every other key');
reset role;
select is((select value from public.org_settings where key = 'vote_retention_percent'), '50',
  'y is still the Moderator''s 50');

-- ==================== 10. A run after a change uses the new share ====================
-- x = 40 % of 3 Voluntar Activ holders -> share 2 -> computed 15. Moved to
-- 100 % -> share 3 -> computed 5 (at the seeded 30 % it would be 25).

select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_evaluation_percent('voluntar_activ', 100) $$,
  'BC moves x to 100 %');
select lives_ok(
  $$ select * from public.run_role_evaluation('voluntar_activ', (select d_from from fx866),
                                             (select d_to from fx866), 'Evaluare procente VA #866') $$,
  'BC runs a Voluntar Activ Role Evaluation after the change');
select results_eq(
  $$ select share_size, cohort_size from public.role_evaluation_ranking('voluntar_activ',
       (select d_from from fx866), (select d_to from fx866)) where role = 'activ' limit 1 $$,
  $$ values (3, 3) $$,
  'the Voluntar Activ ranking reads the new x: the share is the whole cohort of 3');
reset role;
select is(
  (select threshold_computed from public.role_evaluations where name = 'Evaluare procente VA #866'),
  5, 'a Voluntar Activ run after x moved to 100 % computes 5 -- the last of the three holders, not the 25 of 30 %');
select is(
  (select threshold from public.promotion_thresholds where kind = 'voluntar_activ'), 5,
  'the computed 5 is handed over as the Voluntar Activ threshold in force');

-- y = 50 % of 2 Drept de Vot holders -> share 1 -> computed 12. Moved to
-- 100 % -> share 2 -> computed 3.
select pg_temp.test_login_leadership('86600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_evaluation_percent('adunarea_generala', 100) $$,
  'BC moves y to 100 %');
select lives_ok(
  $$ select * from public.run_role_evaluation('adunarea_generala', (select d_from from fx866),
                                             (select d_to from fx866), 'Evaluare procente AG #866') $$,
  'BC runs an Adunarea Generală Role Evaluation after the change');
reset role;
select is(
  (select threshold_computed from public.role_evaluations where name = 'Evaluare procente AG #866'),
  3, 'an Adunarea Generală run after y moved to 100 % computes 3 -- both holders are inside, not only the 12 of 50 %');

select * from finish();
rollback;
