-- privacy_notice_version.test.sql -- #860, R58: a Privacy Notice bump by
-- migration, here the 1.3 bump.
--
-- 20261018180000_privacy_notice_1_3.sql (the 1.3 notice, ruling R58 part 3)
-- moves org_settings privacy_notice_version from 1.2 to 1.3, as
-- 20261018140000_privacy_notice_1_2.sql (R58 part 1) moved it from 1.1 to 1.2
-- and 20260929090000_privacy_notice_1_1.sql (#860) from #771's 1.0 to 1.1, in
-- the pull request that ships the text. A Member who acknowledged only 1.2 is
-- asked again: their 1.2 row no longer answers the gate's read, acknowledging
-- 1.2 is stale, acknowledging 1.3 is recorded beside the 1.2 row, and BC's
-- status read moves from 1.2 to 1.3 for them.
--
-- Mutation guard: drop the 1.3 migration (or its update) -> "the current
-- Privacy Notice version is 1.3" reads 1.2, "acknowledging 1.2 is now stale"
-- answers privacy_notice_already_acknowledged instead, and "the Member
-- acknowledges 1.3" throws privacy_notice_version_stale.
--
-- #771's own rules (the command, the policies, the status read) stay in
-- privacy_notice_acknowledgements.test.sql.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('86000000-0000-0000-0000-000000000001', 'bc860@test.local'),
  ('86000000-0000-0000-0000-000000000002', 'vol860@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('86000000-0000-0000-0000-000000000001', 'BC 860',       'bc860@test.local',  'bc',       'activ'),
  ('86000000-0000-0000-0000-000000000002', 'Voluntar 860', 'vol860@test.local', 'voluntar', 'activ');

-- The Voluntar acknowledged 1.2, the version before the bump.
insert into privacy_notice_acknowledgements (member_id, notice_version, acknowledged_at)
  values ('86000000-0000-0000-0000-000000000002', '1.2', now() - interval '2 days');

create function pg_temp.login(p_n integer) returns void language sql as $$
  select pg_temp.test_login_leadership(('86000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid);
$$;

-- ==================== 1. The version ====================

select results_eq(
  $$ select value, updated_by from org_settings where key = 'privacy_notice_version' $$,
  $$ values ('1.3'::text, null::uuid) $$,
  'the current Privacy Notice version is 1.3, moved by migration (updated_by null), matching the document''s "Versiunea 1.3"');

-- ==================== 2. A Member who acknowledged 1.2 is asked again ====================

select pg_temp.login(2);
-- The gate's read (app/src/queries/privacy.ts, fetchPrivacyGate): an
-- acknowledgement of the current version, or none.
select is(
  (select count(*) from privacy_notice_acknowledgements
    where member_id = '86000000-0000-0000-0000-000000000002'
      and notice_version = (select value from org_settings where key = 'privacy_notice_version')),
  0::bigint,
  'the gate finds no 1.3 acknowledgement for a Member who acknowledged only 1.2, so the Notice is shown again');
select throws_ok($$ select public.acknowledge_privacy_notice('1.2') $$,
  'PT409', 'privacy_notice_version_stale',
  'acknowledging 1.2 is now stale: an app still showing 1.2 cannot record it');
reset role;

select pg_temp.login(1);
create temp table status_before as select * from public.privacy_acknowledgement_status();
reset role;
select is(
  (select notice_version from status_before where member_id = '86000000-0000-0000-0000-000000000002'),
  '1.2',
  'before acknowledging 1.3, BC''s status read shows the Member''s 1.2 -- not the current version');

select pg_temp.login(2);
select is((select notice_version from public.acknowledge_privacy_notice('1.3')), '1.3',
  'the Member acknowledges 1.3');
select is(
  (select count(*) from privacy_notice_acknowledgements
    where member_id = '86000000-0000-0000-0000-000000000002'
      and notice_version = (select value from org_settings where key = 'privacy_notice_version')),
  1::bigint,
  'the gate now finds the 1.3 acknowledgement and lets the Member in');
select throws_ok($$ select public.acknowledge_privacy_notice('1.3') $$,
  'PT409', 'privacy_notice_already_acknowledged',
  'a second tap on 1.3 is privacy_notice_already_acknowledged');
reset role;

select results_eq(
  $$ select notice_version from privacy_notice_acknowledgements
      where member_id = '86000000-0000-0000-0000-000000000002' order by notice_version $$,
  $$ values ('1.2'::text), ('1.3'::text) $$,
  'the 1.2 acknowledgement stays beside the 1.3 one, as the record of what was shown');

select pg_temp.login(1);
create temp table status_after as select * from public.privacy_acknowledgement_status();
reset role;
select is(
  (select notice_version from status_after where member_id = '86000000-0000-0000-0000-000000000002'),
  '1.3',
  'after acknowledging, BC''s status read shows 1.3 for the Member');

select * from finish();
rollback;
