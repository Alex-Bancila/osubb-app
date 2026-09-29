-- privacy_notice_version.test.sql -- #860: the Privacy Notice 1.1 bump.
--
-- 20260929090000_privacy_notice_1_1.sql moves org_settings
-- privacy_notice_version from #771's 1.0 to 1.1, in the pull request that
-- ships the 1.1 text. A Member who acknowledged only 1.0 is asked again: their
-- 1.0 row no longer answers the gate's read, acknowledging 1.0 is stale,
-- acknowledging 1.1 is recorded beside the 1.0 row, and BC's status read moves
-- from 1.0 to 1.1 for them.
--
-- Mutation guard: drop the migration (or its update) -> "the current Privacy
-- Notice version is 1.1" reads 1.0, "acknowledging 1.0 is now stale" answers
-- privacy_notice_already_acknowledged instead, and "the Member acknowledges
-- 1.1" throws privacy_notice_version_stale.
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

-- The Voluntar acknowledged 1.0 before the bump (#771's version).
insert into privacy_notice_acknowledgements (member_id, notice_version, acknowledged_at)
  values ('86000000-0000-0000-0000-000000000002', '1.0', now() - interval '2 days');

create function pg_temp.login(p_n integer) returns void language sql as $$
  select pg_temp.test_login_leadership(('86000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid);
$$;

-- ==================== 1. The version ====================

select results_eq(
  $$ select value, updated_by from org_settings where key = 'privacy_notice_version' $$,
  $$ values ('1.1'::text, null::uuid) $$,
  'the current Privacy Notice version is 1.1, moved by migration (updated_by null), matching the document''s "Versiunea 1.1"');

-- ==================== 2. A Member who acknowledged 1.0 is asked again ====================

select pg_temp.login(2);
-- The gate's read (app/src/queries/privacy.ts, fetchPrivacyGate): an
-- acknowledgement of the current version, or none.
select is(
  (select count(*) from privacy_notice_acknowledgements
    where member_id = '86000000-0000-0000-0000-000000000002'
      and notice_version = (select value from org_settings where key = 'privacy_notice_version')),
  0::bigint,
  'the gate finds no 1.1 acknowledgement for a Member who acknowledged only 1.0, so the Notice is shown again');
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  'PT409', 'privacy_notice_version_stale',
  'acknowledging 1.0 is now stale: an app still showing 1.0 cannot record it');
reset role;

select pg_temp.login(1);
create temp table status_before as select * from public.privacy_acknowledgement_status();
reset role;
select is(
  (select notice_version from status_before where member_id = '86000000-0000-0000-0000-000000000002'),
  '1.0',
  'before acknowledging 1.1, BC''s status read shows the Member''s 1.0 -- not the current version');

select pg_temp.login(2);
select is((select notice_version from public.acknowledge_privacy_notice('1.1')), '1.1',
  'the Member acknowledges 1.1');
select is(
  (select count(*) from privacy_notice_acknowledgements
    where member_id = '86000000-0000-0000-0000-000000000002'
      and notice_version = (select value from org_settings where key = 'privacy_notice_version')),
  1::bigint,
  'the gate now finds the 1.1 acknowledgement and lets the Member in');
select throws_ok($$ select public.acknowledge_privacy_notice('1.1') $$,
  'PT409', 'privacy_notice_already_acknowledged',
  'a second tap on 1.1 is privacy_notice_already_acknowledged');
reset role;

select results_eq(
  $$ select notice_version from privacy_notice_acknowledgements
      where member_id = '86000000-0000-0000-0000-000000000002' order by notice_version $$,
  $$ values ('1.0'::text), ('1.1'::text) $$,
  'the 1.0 acknowledgement stays beside the 1.1 one, as the record of what was shown');

select pg_temp.login(1);
create temp table status_after as select * from public.privacy_acknowledgement_status();
reset role;
select is(
  (select notice_version from status_after where member_id = '86000000-0000-0000-0000-000000000002'),
  '1.1',
  'after acknowledging, BC''s status read shows 1.1 for the Member');

select * from finish();
rollback;
