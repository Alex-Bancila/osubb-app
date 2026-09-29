-- provision_joined_at.test.sql -- #933: public.provision_profile stamps
-- profiles.joined_at, so tenure counts for a Member invited through the app.
--
-- Before #933 provisioning never wrote joined_at, and a null joined_at holds
-- no tenure in either consumer: the daily Recrut -> Voluntar job
-- (private.apply_promotions over private.detect_promotions) and the Promotion
-- Candidate cohort of a Role Evaluation (private.role_evaluation_rows). This
-- suite provisions Members exactly as invite-member and csv-import do and
-- proves both consumers now see them. The backfill of existing profiles is
-- proven by supabase/tests/provision_joined_at_upgrade.test.sh, which replays
-- the migration against profiles with a null joined_at.
--
-- Fixtures (owner, rolled back):
--   I1 recrut,   provisioned with no date     -> joined today
--   I2 voluntar, provisioned with 2025-10-01  -> the given date is kept
--   I3 voluntar, provisioned with no date     -> Promotion Candidate once its
--                                               tenure is reached
--   I4 recrut,   provisioned 7 months back    -> tenured under the 6-month rule
--
-- Mutation guards (each names the assertion that turns red):
--   * the coalesce dropped from provision_profile's insert (joined_at left
--     null, the pre-#933 body) -> "a Member provisioned without a date joins
--     on the provisioning day", "a Voluntar provisioned today enters the
--     Promotion Candidate cohort once the tenure is reached" and "a Recrut
--     provisioned today is promoted by the daily job once the rule's tenure
--     is reached";
--   * coalesce(p_joined_at, ...) replaced by the bare Bucharest date ->
--     "a given join date is kept" and "a Recrut provisioned with a join date
--     past the tenure is promoted by the daily job".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function('public', 'provision_profile',
  array['uuid', 'text', 'text', 'member_role', 'bigint[]', 'uuid', 'date'],
  'provision_profile takes an optional join date');

-- ==================== Fixtures ====================

create function pg_temp.i933(n integer) returns uuid language sql immutable as $$
  select ('93300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

create temp table today933 as
  select (now() at time zone 'Europe/Bucharest')::date as on_date;
grant select on today933 to service_role;

insert into auth.users (id, email)
select pg_temp.i933(n), 'i' || n || '-933@test.local'
  from generate_series(1, 4) as n;

update public.promotion_rules set min_tenure_months = 6, enabled = true;

-- The server identity, the way invite-member and csv-import call it: by
-- name, without a join date.
set local role service_role;
select public.provision_profile(p_user_id => pg_temp.i933(1), p_full_name => 'Invitat Unu',
                                p_email => 'i1-933@test.local', p_role => 'recrut');
select public.provision_profile(p_user_id => pg_temp.i933(2), p_full_name => 'Invitat Doi',
                                p_email => 'i2-933@test.local', p_role => 'voluntar',
                                p_joined_at => date '2025-10-01');
select public.provision_profile(p_user_id => pg_temp.i933(3), p_full_name => 'Invitat Trei',
                                p_email => 'i3-933@test.local', p_role => 'voluntar');
select public.provision_profile(p_user_id => pg_temp.i933(4), p_full_name => 'Invitat Patru',
                                p_email => 'i4-933@test.local', p_role => 'recrut',
                                p_joined_at => ((select on_date from today933) - interval '7 months')::date);
reset role;

-- ==================== The join date ====================

select is((select joined_at from public.profiles where id = pg_temp.i933(1)),
          (select on_date from today933),
          'a Member provisioned without a date joins on the provisioning day (Europe/Bucharest)');
select is((select joined_at from public.profiles where id = pg_temp.i933(2)),
          date '2025-10-01',
          'a given join date is kept');

-- ==================== The Promotion Candidate cohort ====================
-- The top_percent rule's tenure is 6 months: I3 is under it today and holds
-- it on joined_at + 6 months, the shifted evaluation date.

select is(
  (select count(*) from private.role_evaluation_rows(
     'voluntar_activ', (select on_date - 30 from today933), (select on_date from today933),
     (select on_date from today933)) as ranked
    where ranked.member_id = pg_temp.i933(3)),
  0::bigint,
  'a Voluntar provisioned today is not a Promotion Candidate before the tenure');
select results_eq(
  format($$select ranked.tenure_since from private.role_evaluation_rows(
             'voluntar_activ', %L::date, %L::date, %L::date) as ranked
           where ranked.member_id = %L::uuid$$,
         (select on_date - 30 from today933), (select on_date from today933),
         (select (on_date + interval '6 months')::date from today933), pg_temp.i933(3)),
  format($$values (%L::date)$$, (select (on_date + interval '6 months')::date from today933)),
  'a Voluntar provisioned today enters the Promotion Candidate cohort once the tenure is reached');

-- ==================== The daily Recrut -> Voluntar job ====================

select private.apply_promotions();

select is((select role::text from public.profiles where id = pg_temp.i933(4)), 'voluntar',
  'a Recrut provisioned with a join date past the tenure is promoted by the daily job');
select is((select role::text from public.profiles where id = pg_temp.i933(1)), 'recrut',
  'a Recrut provisioned today is not promoted before the tenure');

-- Shift the tenure to the provisioning day itself: I1 now holds it.
update public.promotion_rules set min_tenure_months = 0 where kind = 'time';
select private.apply_promotions();

select is((select role::text from public.profiles where id = pg_temp.i933(1)), 'voluntar',
  'a Recrut provisioned today is promoted by the daily job once the rule''s tenure is reached');

select * from finish();
rollback;
